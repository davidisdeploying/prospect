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

const LEDGER_PAGE_SIZE = 8;
const ACTION_STAGES = FUNNEL_STAGES.filter((stage) => stage.key !== 'Staked');

function metaFor(claim) {
  const parts = [];
  if (claim.comp) parts.push(claim.comp);
  if (claim.location) parts.push(claim.location);
  return parts.length ? parts.join(' · ') : null;
}

function formatClaimDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.replace(' ', 'T') + (text.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function GhostBadge({ days, onClick }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      title={`Quiet ${days} days in Staked (≥ ${GHOST_QUIET_DAYS}-day threshold) — plain gloss: no response since applying`}
      className="claim-ghost-badge"
    >
      <ClockIcon /> No response · review
    </button>
  );
}

function StageMoveSelect({ claim, onMove, onTailings, compact = false }) {
  return (
    <Select
      aria-label={`Move ${claim.role || 'claim'} to a different stage`}
      value={claim.stage}
      onChange={(event) => {
        const toStage = event.target.value;
        if (toStage === 'Tailings') {
          onTailings(claim);
        } else {
          onMove(claim.claim_id, toStage, { transition_cause: 'manual' });
        }
      }}
      options={ALL_STAGES.map((stage) => ({ value: stage.key, label: `${stage.key} · ${stage.gloss}` }))}
      style={compact
        ? { fontSize: 11.5, padding: '7px 26px 7px 9px' }
        : { fontSize: 11.5, padding: '6px 26px 6px 8px' }}
    />
  );
}

function Column({ stage, claims, colIndex, onMove, onTailings, onOpenClaim, paydirtIds }) {
  return (
    <section className="claim-map-column">
      <div className="column-head" style={{ '--col-index': colIndex }}>
        <StageColumnHead name={stage.key} count={claims.length} gloss={stage.gloss} />
      </div>
      <div className="cards">
        {claims.map((claim, rowIndex) => {
          const isPaydirt = !!paydirtIds && paydirtIds.has(claim.claim_id);
          const card = (
            <ClaimCard
              className="card"
              data-claim-id={claim.claim_id}
              style={{ viewTransitionName: `claim-${claim.claim_id}`, '--col-index': colIndex, '--row-index': rowIndex }}
              role={claim.role || 'Untitled role'}
              company={claim.company}
              meta={metaFor(claim)}
              onClick={() => onOpenClaim(claim.claim_id)}
            >
              <div className="claim-card-stage" onClick={(event) => event.stopPropagation()}>
                <StageMoveSelect claim={claim} onMove={onMove} onTailings={onTailings} />
              </div>
            </ClaimCard>
          );
          return (
            <div key={claim.claim_id} className={isPaydirt ? 'paydirt-wrap' : undefined}>
              {card}
              {isPaydirt && <PaydirtMark />}
              {isPaydirt && <span className="paydirt-ring" />}
            </div>
          );
        })}
        {claims.length === 0 && <div className="claim-column-empty">No claims here</div>}
      </div>
    </section>
  );
}

function LedgerRow({ claim, rowIndex, dateLabel, onMove, onTailings, onGhostTailings, onOpenClaim }) {
  const ghost = claim.stage === 'Staked' && isGhostCandidate(claim);
  const value = dateLabel === 'Applied'
    ? (claim.applied_at || claim.stage_entered_at || claim.created_at)
    : (claim.stage_entered_at || claim.updated_at);
  const date = formatClaimDate(value);
  const meta = metaFor(claim);
  return (
    <article
      className={`claim-ledger-row card${ghost ? ' claim-ledger-row--quiet' : ''}`}
      data-claim-id={claim.claim_id}
      style={{ viewTransitionName: `claim-${claim.claim_id}`, '--row-index': rowIndex, '--col-index': 0 }}
    >
      <button type="button" className="claim-ledger-open" onClick={() => onOpenClaim(claim.claim_id)}>
        <span className="claim-ledger-role">{claim.role || 'Untitled role'}</span>
        <span className="claim-ledger-company">{claim.company || 'Company not recorded'}</span>
        <span className="claim-ledger-meta">
          {date ? `${dateLabel} ${date}` : dateLabel}
          {meta ? ` · ${meta}` : ''}
        </span>
      </button>
      <div className="claim-ledger-actions">
        <StageMoveSelect claim={claim} onMove={onMove} onTailings={onTailings} compact />
        {ghost && <GhostBadge days={quietDays(claim.stage_entered_at)} onClick={() => onGhostTailings(claim)} />}
      </div>
    </article>
  );
}

function LedgerPager({ page, pages, total, onPage, label }) {
  if (pages <= 1) return null;
  const first = page * LEDGER_PAGE_SIZE + 1;
  const last = Math.min(total, first + LEDGER_PAGE_SIZE - 1);
  return (
    <nav className="claim-ledger-pager" aria-label={label}>
      <span>{first}–{last} of {total}</span>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0}>Previous</button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page + 1 === pages}>Next</button>
      </div>
    </nav>
  );
}

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
  const [appliedPage, setAppliedPage] = React.useState(0);
  const [tailingsPage, setTailingsPage] = React.useState(0);
  const [tailingsOpen, setTailingsOpen] = React.useState(false);
  const showEntrance = useSurveyedOnce();

  const byStage = {};
  ALL_STAGES.forEach((stage) => { byStage[stage.key] = []; });
  claims.forEach((claim) => { (byStage[claim.stage] || byStage.Showings).push(claim); });

  const appliedClaims = byStage.Staked;
  const tailingsClaims = byStage[TAILINGS_STAGE.key];
  const appliedPages = Math.max(1, Math.ceil(appliedClaims.length / LEDGER_PAGE_SIZE));
  const tailingsPages = Math.max(1, Math.ceil(tailingsClaims.length / LEDGER_PAGE_SIZE));
  const visibleApplied = appliedClaims.slice(appliedPage * LEDGER_PAGE_SIZE, (appliedPage + 1) * LEDGER_PAGE_SIZE);
  const visibleTailings = tailingsClaims.slice(tailingsPage * LEDGER_PAGE_SIZE, (tailingsPage + 1) * LEDGER_PAGE_SIZE);

  React.useEffect(() => { setAppliedPage((page) => Math.min(page, appliedPages - 1)); }, [appliedPages]);
  React.useEffect(() => { setTailingsPage((page) => Math.min(page, tailingsPages - 1)); }, [tailingsPages]);

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

  function openTailings(claim) { setTailingsTarget(claim); setTailingsGhost(false); }
  function openGhostTailings(claim) { setTailingsTarget(claim); setTailingsGhost(true); }
  function closeTailings() { setTailingsTarget(null); setTailingsGhost(false); }

  async function confirmTailings({ outcome_reason, note, transition_cause }) {
    await onMove(tailingsTarget.claim_id, 'Tailings', { outcome_reason, note, transition_cause });
    closeTailings();
  }

  return (
    <div className={`claim-map-scroll${showEntrance ? ' survey-cascade' : ''}`}>
      <div className="claim-stage-strip" aria-label="Application pipeline summary">
        {ALL_STAGES.map((stage) => (
          <div key={stage.key} className="claim-stage-summary">
            <div><span>{stage.key}</span><strong>{byStage[stage.key].length}</strong></div>
            <small>{stage.gloss}</small>
          </div>
        ))}
      </div>

      <div className="claim-map-board">
        <section className="claim-map-section claim-action-section" aria-labelledby="action-stages-heading">
          <div className="claim-map-section-head">
            <div>
              <p className="claim-map-kicker">Action stages</p>
              <h2 id="action-stages-heading">What can move now</h2>
            </div>
            <p>Saved roles, interviews, and offers stay in view. Applied roles wait in the ledger below.</p>
          </div>
          <div className="claim-map-funnel">
            {ACTION_STAGES.map((stage, colIndex) => (
              <Column
                key={stage.key}
                stage={stage}
                claims={byStage[stage.key]}
                colIndex={colIndex}
                onMove={onMove}
                onTailings={openTailings}
                onOpenClaim={onOpenClaim}
                paydirtIds={paydirtIds}
              />
            ))}
          </div>
        </section>

        <section className="claim-map-section claim-applied-section" aria-labelledby="applied-ledger-heading">
          <div className="claim-map-section-head">
            <div>
              <p className="claim-map-kicker">Staked · applied</p>
              <h2 id="applied-ledger-heading">Waiting on employers</h2>
            </div>
            <p>Newest first · {appliedClaims.length} total. The ledger shows eight applications at a time as your history grows.</p>
          </div>
          {visibleApplied.length > 0 ? (
            <div className="claim-ledger">
              {visibleApplied.map((claim, rowIndex) => (
                <LedgerRow
                  key={claim.claim_id}
                  claim={claim}
                  rowIndex={rowIndex}
                  dateLabel="Applied"
                  onMove={onMove}
                  onTailings={openTailings}
                  onGhostTailings={openGhostTailings}
                  onOpenClaim={onOpenClaim}
                />
              ))}
            </div>
          ) : <div className="claim-ledger-empty">No applied claims are waiting.</div>}
          <LedgerPager page={appliedPage} pages={appliedPages} total={appliedClaims.length} onPage={setAppliedPage} label="Applied application pages" />
        </section>

        <section className="claim-map-section claim-archive-section" aria-labelledby="tailings-heading">
          <button
            type="button"
            className="claim-archive-toggle"
            aria-expanded={tailingsOpen}
            aria-controls="tailings-ledger"
            onClick={() => setTailingsOpen((open) => !open)}
          >
            <span><span className="claim-map-kicker">Tailings · closed</span><strong id="tailings-heading">Closed applications</strong></span>
            <span>{tailingsClaims.length} total · {tailingsOpen ? 'Hide' : 'View'}</span>
          </button>
          {tailingsOpen && (
            <div id="tailings-ledger" className="claim-archive-content">
              {visibleTailings.length > 0 ? (
                <div className="claim-ledger">
                  {visibleTailings.map((claim, rowIndex) => (
                    <LedgerRow
                      key={claim.claim_id}
                      claim={claim}
                      rowIndex={rowIndex}
                      dateLabel="Closed"
                      onMove={onMove}
                      onTailings={openTailings}
                      onGhostTailings={openGhostTailings}
                      onOpenClaim={onOpenClaim}
                    />
                  ))}
                </div>
              ) : <div className="claim-ledger-empty">Nothing in the tailings pond yet.</div>}
              <LedgerPager page={tailingsPage} pages={tailingsPages} total={tailingsClaims.length} onPage={setTailingsPage} label="Closed application pages" />
            </div>
          )}
        </section>
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
