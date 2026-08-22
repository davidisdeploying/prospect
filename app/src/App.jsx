import React from 'react';
import { Toast } from '@ds/components/feedback/Toast.jsx';
import { AppShell, ViewHeader } from './AppShell.jsx';
import { ClaimMap } from './ClaimMap.jsx';
import { StakeDialog } from './StakeDialog.jsx';
import { ClaimDetail } from './ClaimDetail.jsx';
import { RepostCaution } from './RepostCaution.jsx';
import { Search } from './Search.jsx';
import { getBoard, stakeClaim, moveStage, patchClaim, getClaim } from './api.js';
import { withViewTransition } from './motion/viewTransitions.js';
import { TAILINGS_STAGE } from './stages.js';

function motionMs(varName, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const ms = parseFloat(raw);
  return Number.isFinite(ms) ? ms : fallback;
}

export function parseInitialClaimId(search) {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const claimParam = params.get('claim');
  if (claimParam && /^\d+$/.test(claimParam.trim())) {
    const id = parseInt(claimParam.trim(), 10);
    return id > 0 ? id : null;
  }
  return null;
}

export function stripClaimParam(search) {
  if (!search) return '';
  const params = new URLSearchParams(search);
  if (!params.has('claim')) return search.startsWith('?') ? search : (search ? '?' + search : '');
  params.delete('claim');
  const str = params.toString();
  return str ? '?' + str : '';
}

// §PWA shell v2 compact plus: the four server-rendered pages' top-bar plus deep-links to
// /?stake=1 (they can't open the SPA's dialog directly). This pair mirrors
// parseInitialClaimId/stripClaimParam above so the SPA opens the Stake dialog on initial mount
// and, on close, removes only `stake` — never `claim` or any other query param, and never the
// hash (callers append window.location.hash back on unchanged, same as the claim-close handler).
export function parseInitialStake(search) {
  if (!search) return false;
  const params = new URLSearchParams(search);
  return params.get('stake') === '1';
}

export function stripStakeParam(search) {
  if (!search) return '';
  const params = new URLSearchParams(search);
  if (!params.has('stake')) return search.startsWith('?') ? search : (search ? '?' + search : '');
  params.delete('stake');
  const str = params.toString();
  return str ? '?' + str : '';
}

export function App() {
  const [claims, setClaims] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [staking, setStaking] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return parseInitialStake(window.location.search);
  });
  const [openClaimId, setOpenClaimId] = React.useState(() => {
    if (typeof window === 'undefined') return null;
    return parseInitialClaimId(window.location.search);
  });
  const [toast, setToast] = React.useState(null);
  const [toastPhase, setToastPhase] = React.useState('enter'); // 'enter' | 'exit'
  const [repostNotice, setRepostNotice] = React.useState(null);
  // §3.6 Paydirt: claim ids that have played the celebration this session —
  // resting-ring rendering keys off membership here (see ClaimMap.jsx). Not
  // persisted (client/CSS-only build); re-triggering is independently
  // guarded server-truthfully by isFirstStrike below, so a reload just means
  // no NEW celebration replays, not that an old ring silently returns.
  const [paydirtIds, setPaydirtIds] = React.useState(() => new Set());
  const toastIdRef = React.useRef(0);

  const refresh = React.useCallback(() => getBoard().then((data) => setClaims(data.claims)), []);

  React.useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  function flash(message, tone) {
    clearTimeout(window.__prospectToastHide);
    clearTimeout(window.__prospectToastUnmount);
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message, tone });
    setToastPhase('enter');
    // Held for 2600ms, then sinks out; the node stays mounted through the
    // sink-out transition (--dur-move) so the exit motion plays instead of
    // vanishing instantly. aria-live announces immediately on mount above —
    // only the visual exit is delayed.
    window.__prospectToastHide = setTimeout(() => {
      setToastPhase('exit');
      window.__prospectToastUnmount = setTimeout(() => setToast(null), motionMs('--dur-move', 280));
    }, 2600);
  }

  // §PWA shell v2: removes only `stake` from the URL, preserving every other query param — the
  // hash is untouched since it's re-appended from window.location.hash unchanged, not rewritten.
  function closeStakeUrlParam() {
    if (typeof window !== 'undefined' && window.location) {
      const newSearch = stripStakeParam(window.location.search);
      const newUrl = window.location.pathname + newSearch + window.location.hash;
      window.history.replaceState(null, '', newUrl);
    }
  }

  async function handleStake(payload, resumeVersionId) {
    const claim = await stakeClaim(payload);
    setStaking(false);
    closeStakeUrlParam();
    // §3.5 stake-driven: recolored off gold — the new card's gold seam
    // (stamped below, once refresh() re-renders it) is this action's one
    // gold-motion moment; a gold-toned toast at the same time would be a
    // second, colliding one.
    flash('Claim staked', 'positive');
    refresh().then(() => stampStakeSeam(claim.claim_id));
    if (claim.repost_candidate) {
      setRepostNotice({ claimId: claim.claim_id, candidate: claim.repost_candidate });
    }
    if (resumeVersionId) {
      try {
        await patchClaim(claim.claim_id, { resume_version_id: resumeVersionId });
      } catch (err) {
        flash(err.message, 'danger');
      }
    }
  }

  function findCardEl(claimId) {
    return document.querySelector(`[data-claim-id="${claimId}"]`);
  }

  // §3.5 gold seam: the board re-render triggered by refresh() may not have
  // committed/painted the new card's DOM node yet when this runs — rAF-retry
  // (a few frames) rather than assuming one microtask is enough.
  function waitForCardEl(claimId, attemptsLeft = 20) {
    return new Promise((resolve) => {
      function attempt(remaining) {
        const el = findCardEl(claimId);
        if (el || remaining <= 0) { resolve(el); return; }
        requestAnimationFrame(() => attempt(remaining - 1));
      }
      attempt(attemptsLeft);
    });
  }

  // One-shot, never again: reuses the .glint primitive verbatim (the same
  // masked-gradient sweep as the M3 column-head arrival glint). Applied as a
  // permanent class, not removed after — `.glint`'s animation is
  // iteration-count 1 + forwards, so it plays once on mount and then rests
  // at its transparent end state; it never replays because the class is
  // never toggled off and back on.
  async function stampStakeSeam(claimId) {
    const el = await waitForCardEl(claimId);
    if (el) el.classList.add('glint');
  }

  // §3.2 Tailings sink: 180ms gravity dip played on the source card before
  // the glide carries it out. Fire-and-forget delay only — no input lock.
  // Cleanup mirrors markArrived's fixed-timer pattern: scheduled up front,
  // self-contained, independent of the caller's own await chain, so the
  // attribute can't strand the card sunk/desaturated past the dip+glide
  // (G1 — was previously never cleared at all).
  async function preSink(claimId) {
    const el = findCardEl(claimId);
    if (!el) return;
    el.setAttribute('data-sinking', '');
    const sinkMs = motionMs('--dur-state', 180);
    const sceneMs = motionMs('--dur-scene', 480);
    setTimeout(() => el.removeAttribute('data-sinking'), sinkMs + sceneMs);
    await new Promise((resolve) => setTimeout(resolve, sinkMs));
  }

  // §3.2 forward-move glint: stamp the arrived card so the destination
  // column head's `:has()` selector reacts with a single gold sweep, then
  // clear the stamp so the next arrival can retrigger it.
  function markArrived(claimId) {
    const el = findCardEl(claimId);
    if (!el) return;
    el.setAttribute('data-arrived', '');
    setTimeout(() => el.removeAttribute('data-arrived'), motionMs('--dur-scene', 480));
  }

  // §3.6 Paydirt guard: "once per claim, ever." The board response has no
  // history signal (recon: GET /api/board omits stage_transitions), so this
  // reads the claim's own append-only history straight after the move —
  // truthful iff exactly one Strike-bound transition exists (the row this
  // very move just inserted). Strike is re-enterable (no forward-only rule
  // anywhere client or server side), so re-checking on every Strike-bound
  // move — never caching "already celebrated" client-side — is load-bearing,
  // not defensive. Fails closed (no celebration) on a read error; never
  // blocks or reverts the move itself.
  async function isFirstStrike(claimId) {
    try {
      const detail = await getClaim(claimId);
      const strikes = (detail.transitions || []).filter((t) => t.to_stage === 'Strike');
      return strikes.length === 1;
    } catch {
      return false;
    }
  }

  async function handleMove(claimId, toStage, opts) {
    try {
      await moveStage(claimId, toStage, opts);
      const toStrike = toStage === 'Strike';
      // Run the Paydirt guard GET alongside the next-board fetch rather than
      // after it — both are read-only and independent, so there's no reason
      // to serialize them.
      const [data, paydirt] = await Promise.all([
        getBoard(), // fetch next board BEFORE the transition — no network under the VT overlay
        toStrike ? isFirstStrike(claimId) : Promise.resolve(false),
      ]);
      const toTailings = toStage === TAILINGS_STAGE.key;
      if (toTailings) await preSink(claimId);
      await withViewTransition(() => setClaims(data.claims), { toTailings });
      if (paydirt) {
        // Paydirt IS this move's one gold-motion moment — suppress the
        // ordinary forward-move column glint (markArrived) so the two gold
        // motions don't collide on the same action. An ordinary (non-first)
        // Strike move with paydirt===false still falls through to the plain
        // glint below, unchanged from M3.
        setPaydirtIds((prev) => new Set(prev).add(claimId));
      } else if (!toTailings) {
        markArrived(claimId);
      }
    } catch (err) {
      flash(err.message, 'danger'); // 400 (e.g. Tailings w/o outcome_reason) reverts — zero glide, no VT reached
    }
  }

  const veins = claims.filter((c) => c.stage === 'Working the Vein').length;

  return (
    <AppShell onStake={() => setStaking(true)}>
      <ViewHeader
        eyebrow="The dig"
        title="The Claim Map"
        sub={`${claims.length} claims · ${veins} active veins`}
        right={
          <div className="prospect-header-tools" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="prospect-header-slogan" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
              survey wide · stake narrow · work the vein
            </div>
            <Search onOpenClaim={setOpenClaimId} />
          </div>
        }
      />
      <ClaimMap
        claims={claims}
        loading={loading}
        onMove={handleMove}
        onStake={() => setStaking(true)}
        onOpenClaim={setOpenClaimId}
        paydirtIds={paydirtIds}
      />
      <StakeDialog open={staking} onClose={() => { setStaking(false); closeStakeUrlParam(); }} onStake={handleStake} />
      <ClaimDetail claimId={openClaimId} onClose={() => {
        setOpenClaimId(null);
        refresh();
        if (typeof window !== 'undefined' && window.location) {
          const newSearch = stripClaimParam(window.location.search);
          const newUrl = window.location.pathname + newSearch + window.location.hash;
          window.history.replaceState(null, '', newUrl);
        }
      }} />
      <RepostCaution
        notice={repostNotice}
        onClose={() => setRepostNotice(null)}
        onLinked={() => { setRepostNotice(null); refresh(); }}
      />
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 'calc(28px + var(--prospect-tabbar-safe, 0px))', transform: 'translateX(-50%)', zIndex: 80 }}>
          <div key={toast.id} className={toastPhase === 'exit' ? 'sink-out' : 'settle-in'}>
            <Toast message={toast.message} tone={toast.tone} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
