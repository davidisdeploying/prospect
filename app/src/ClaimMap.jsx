import React from 'react';
import { ClaimCard } from '@ds/components/data/ClaimCard.jsx';
import { StageColumnHead } from '@ds/components/data/StageColumnHead.jsx';
import { EmptyState } from '@ds/components/data/EmptyState.jsx';
import { Select } from '@ds/components/forms/Select.jsx';
import { Button } from '@ds/components/core/Button.jsx';
import { ALL_STAGES, FUNNEL_STAGES, TAILINGS_STAGE } from './stages.js';
import { TailingsDialog } from './TailingsDialog.jsx';
import { GHOST_QUIET_DAYS, quietDays, isGhostCandidate } from './ghost.js';
import { PaydirtMark } from './PaydirtMark.jsx';

function metaFor(claim) {
  const parts = [];
  if (claim.comp) parts.push(claim.comp);
  if (claim.location) parts.push(claim.location);
  return parts.length ? parts.join(' · ') : null;
}

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// Recolored off gold (David, M6): a quiet nudge toward Tailings, not a
// failure and not the view's gold-motion moment — galena/muted family,
// same recipe as Badge.jsx's 'neutral' tone, never gold, never alarming
// iron-oxide/danger.
function GhostBadge({ days, onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`Quiet ${days} days in Staked (≥ ${GHOST_QUIET_DAYS}-day threshold) — plain gloss: no response since applying`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
        padding: '4px 9px', borderRadius: 'var(--r-pill)',
        border: '1px solid var(--galena-dim)', background: 'var(--surface-raised)',
        color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5,
        letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
      }}
    >
      <ClockIcon /> Tailings (ghosted)
    </button>
  );
}

function StageMoveSelect({ claim, onMove, onTailings }) {
  return (
    <Select
      aria-label={`Move ${claim.role || 'claim'} to a different stage`}
      value={claim.stage}
      onChange={(e) => {
        const toStage = e.target.value;
        if (toStage === 'Tailings') {
          onTailings(claim);
        } else {
          onMove(claim.claim_id, toStage, { transition_cause: 'manual' });
        }
      }}
      options={ALL_STAGES.map((s) => ({ value: s.key, label: `${s.key} · ${s.gloss}` }))}
      style={{ fontSize: 11.5, padding: '6px 26px 6px 8px' }}
    />
  );
}

function Column({ stage, claims, colIndex, onMove, onTailings, onGhostTailings, onOpenClaim, paydirtIds }) {
  return (
    <div style={{
      background: 'var(--bg-sunken)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)', padding: 12, alignSelf: 'start',
      boxShadow: 'var(--shadow-panel)',
      // §8: skip offscreen column work. Estimate only (typical rendered
      // column ~220px wide × a handful of cards) — `auto` remembers the
      // real size after first layout, this is just the pre-layout floor.
      contentVisibility: 'auto',
      containIntrinsicSize: 'auto 220px auto 420px',
    }}>
      <div className="column-head" style={{ padding: '2px 2px 12px', '--col-index': colIndex }}>
        <StageColumnHead name={stage.key} count={claims.length} gloss={stage.gloss} />
      </div>
      <div className="cards" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {claims.map((c, rowIndex) => {
          const ghost = stage.key === 'Staked' && isGhostCandidate(c);
          const isPaydirt = !!paydirtIds && paydirtIds.has(c.claim_id);
          const card = (
            <ClaimCard
              className={ghost ? 'card ghost-dust' : 'card'}
              data-claim-id={c.claim_id}
              style={{ viewTransitionName: `claim-${c.claim_id}`, '--col-index': colIndex, '--row-index': rowIndex }}
              role={c.role || 'Untitled role'}
              company={c.company}
              meta={metaFor(c)}
              onClick={() => onOpenClaim(c.claim_id)}
            >
              <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                <StageMoveSelect claim={c} onMove={onMove} onTailings={onTailings} />
              </div>
              {ghost && (
                <div className="settle-in" onClick={(e) => e.stopPropagation()}>
                  <GhostBadge days={quietDays(c.stage_entered_at)} onClick={() => onGhostTailings(c)} />
                </div>
              )}
            </ClaimCard>
          );
          // §3.6 Paydirt: the resting ring + mark live on a wrapper, not on
          // ClaimCard's own root — ClaimCard's hover handlers imperatively
          // overwrite their own root's boxShadow (ClaimCard.jsx), which
          // would clobber a resting gold shadow set there on first hover.
          // The wrapper is ALWAYS a <div> (never swapped with a Fragment) so
          // React never sees a type change at this position and never
          // remounts ClaimCard when isPaydirt flips true — a Fragment/div
          // swap here measurably shifted sibling cards for one frame (a
          // real, if small, CLS hit caught in verification) even though
          // nothing was visually supposed to move.
          return (
            <div key={c.claim_id} className={isPaydirt ? 'paydirt-wrap' : undefined}>
              {card}
              {isPaydirt && <PaydirtMark />}
              {isPaydirt && <span className="paydirt-ring" />}
            </div>
          );
        })}
        {claims.length === 0 && (
          <div style={{ height: 36, border: '1px dashed var(--galena-dim)', borderRadius: 'var(--r-md)', opacity: 0.5 }} />
        )}
      </div>
    </div>
  );
}

// §3.1 board entrance — once per session. Lazy-init reads the flag before
// first paint; the effect sets it right after so this exact mount is the
// last one to see `showEntrance === true` for the rest of the tab's session
// (a later `/` load is a fresh cross-document navigation, so this runs
// again, finds the flag set, and stays false — no replay).
function useSurveyedOnce() {
  const [showEntrance] = React.useState(
    () => typeof window !== 'undefined' && !window.sessionStorage.getItem('prospect.surveyed')
  );
  React.useEffect(() => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem('prospect.surveyed', '1');
  }, []);
  return showEntrance;
}

export function ClaimMap({ claims, loading, onMove, onStake, onOpenClaim, paydirtIds }) {
  const [tailingsTarget, setTailingsTarget] = React.useState(null);
  const [tailingsGhost, setTailingsGhost] = React.useState(false);
  const showEntrance = useSurveyedOnce();

  if (!loading && claims.length === 0) {
    return (
      <div style={{ padding: '20px 30px 40px' }}>
        <EmptyState
          title="Stake your first claim"
          line="Survey the field, then stake the ones worth your time."
          action={<Button variant="gold" onClick={onStake}>Stake a claim</Button>}
        />
      </div>
    );
  }

  const byStage = {};
  ALL_STAGES.forEach((s) => { byStage[s.key] = []; });
  claims.forEach((c) => { (byStage[c.stage] || byStage.Showings).push(c); });

  function openTailings(claim) { setTailingsTarget(claim); setTailingsGhost(false); }
  function openGhostTailings(claim) { setTailingsTarget(claim); setTailingsGhost(true); }
  function closeTailings() { setTailingsTarget(null); setTailingsGhost(false); }

  async function confirmTailings({ outcome_reason, note, transition_cause }) {
    await onMove(tailingsTarget.claim_id, 'Tailings', { outcome_reason, note, transition_cause });
    closeTailings();
  }

  return (
    <div className={`claim-map-scroll${showEntrance ? ' survey-cascade' : ''}`} style={{ padding: '20px 30px 40px', overflowX: 'auto' }}>
      <div className="claim-map-board" style={{ display: 'flex', gap: 22, minWidth: 1300 }}>
        <div className="claim-map-funnel" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(210px, 1fr))', gap: 14, flex: 1 }}>
          {FUNNEL_STAGES.map((s, colIndex) => (
            <Column key={s.key} stage={s} claims={byStage[s.key]} colIndex={colIndex} onMove={onMove} onTailings={openTailings} onGhostTailings={openGhostTailings} onOpenClaim={onOpenClaim} paydirtIds={paydirtIds} />
          ))}
        </div>
        <div className="claim-map-divider" style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
        <div className="claim-map-tailings" style={{ width: 230 }}>
          <Column stage={TAILINGS_STAGE} claims={byStage[TAILINGS_STAGE.key]} colIndex={FUNNEL_STAGES.length} onMove={onMove} onTailings={openTailings} onGhostTailings={openGhostTailings} onOpenClaim={onOpenClaim} paydirtIds={paydirtIds} />
        </div>
      </div>
      <TailingsDialog
        open={!!tailingsTarget}
        onClose={closeTailings}
        onConfirm={confirmTailings}
        ghostOrigin={tailingsGhost}
        initialReason={tailingsGhost ? 'ghosted' : ''}
      />
    </div>
  );
}
