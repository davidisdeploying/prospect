import React from 'react';
import { Wordmark } from '@ds/components/brand/Wordmark.jsx';
import { Button } from '@ds/components/core/Button.jsx';
import { Tooltip } from '@ds/components/feedback/Tooltip.jsx';
import { NAV_ITEMS, NAV_ICON_SHAPES, TOPBAR_ICON_SHAPES, activeNavPath } from '../../shared/nav.mjs';
import './app-shell.css';

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Renders a NAV_ICON_SHAPES[icon] entry (plain {tag, attrs} data shared with server/shell.js) as
// an inline currentColor SVG — no icon font, no emoji.
function NavIcon({ icon, size = 22 }) {
  const shapes = NAV_ICON_SHAPES[icon] || [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shapes.map((shape, i) => React.createElement(shape.tag, { key: i, ...shape.attrs }))}
    </svg>
  );
}

function PageSeal({ icon }) {
  const shapes = TOPBAR_ICON_SHAPES[icon] || TOPBAR_ICON_SHAPES.map;
  const renderShapes = (items) => items.map((shape, i) => (
    React.createElement(shape.tag, { key: i, ...shape.attrs })
  ));
  return (
    <svg className="prospect-page-seal" viewBox="0 0 32 32" aria-hidden="true">
      <circle className="prospect-page-seal-outer" cx="16" cy="16" r="14" />
      <circle className="prospect-page-seal-inner" cx="16" cy="16" r="11.5" />
      <g className="prospect-page-seal-base" transform="translate(4 4)">{renderShapes(shapes.base)}</g>
      <g className="prospect-page-seal-accent" transform="translate(4 4)">{renderShapes(shapes.accent)}</g>
    </svg>
  );
}

// Compact sticky top app bar (§PWA shell v2) — present only on the SPA's own route ("/"), since
// the four server-rendered pages render their own equivalent via server/shell.js#renderTopBar.
// The plus opens the Stake dialog directly (we're already mounted); server pages instead
// deep-link to /?stake=1, which App.jsx parses on initial mount.
function CompactTopBar({ activeItem, onStake }) {
  return (
    <header className="prospect-topbar">
      <PageSeal icon={activeItem?.icon ?? 'map'} />
      <span className="prospect-topbar-title">{activeItem?.mobileLabel ?? 'Prospect'}</span>
      <button type="button" className="prospect-topbar-stake" onClick={onStake} aria-label="Stake a claim">
        <PlusIcon />
      </button>
    </header>
  );
}

// Fixed, persistent bottom tab bar (§PWA shell v2) — five icon+text tabs, verdigris (not gold)
// active state, aria-current for the active page.
function CompactTabBar({ activePath }) {
  return (
    <nav className="prospect-tabbar" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const isActive = item.path === activePath;
        return (
          <a key={item.path} href={item.path} className={`prospect-tab${isActive ? ' is-active' : ''}`} aria-current={isActive ? 'page' : undefined}>
            <NavIcon icon={item.icon} />
            <span className="prospect-tab-label">{item.mobileLabel}</span>
          </a>
        );
      })}
    </nav>
  );
}

export function AppShell({ onStake, children }) {
  const pathWithQuery = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
  const activePath = activeNavPath(pathWithQuery) ?? '/';
  const activeItem = NAV_ITEMS.find((item) => item.path === activePath);

  return (
    <div className="prospect-shell" style={{ display: 'grid', gridTemplateColumns: '272px 1fr', minHeight: '100vh' }}>
      <CompactTopBar activeItem={activeItem} onStake={onStake} />
      <aside className="prospect-sidebar" style={{ borderRight: '1px solid var(--line)', background: 'var(--slate-850)', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Wordmark className="prospect-wordmark" size={21} />
        <Tooltip label="Add a job" side="bottom">
          <Button className="prospect-stake-button" variant="quiet" size="sm" onClick={onStake} style={{ width: '100%' }} iconLeft={<PlusIcon />}>
            Stake a claim
          </Button>
        </Tooltip>
        <nav className="prospect-nav" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.path === activePath;
            return (
              <a key={item.path} href={item.path} className="nav-item" style={{
                display: 'flex', flexDirection: 'column', lineHeight: 1.15, textDecoration: 'none',
                gap: 3, padding: '9px 11px', borderRadius: 'var(--r-md)',
                border: '1px solid var(--line)', background: isActive ? 'var(--surface-raised)' : 'var(--surface-card)',
              }}>
                <span className={`nav-indicator${isActive ? ' is-active' : ''}`} style={isActive ? { viewTransitionName: 'nav-active-indicator' } : undefined} aria-hidden="true" />
                <span className="nav-title" style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{item.desktopTitle}</span>
                <span className="nav-subtitle" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{item.gloss}</span>
              </a>
            );
          })}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="prospect-sidebar-footer" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>self-hosted · local-first</span>
        </div>
      </aside>
      <main className="prospect-field" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
      <CompactTabBar activePath={activePath} />
    </div>
  );
}

export function ViewHeader({ eyebrow, title, sub, right }) {
  return (
    <header className="prospect-view-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, padding: '24px 30px 18px', borderBottom: '1px solid var(--line)' }}>
      <div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{eyebrow}</span>
        <h1 style={{ fontFamily: 'var(--font-slab)', fontWeight: 700, fontSize: 28, color: 'var(--text-strong)', marginTop: 8, letterSpacing: '-.01em' }}>{title}</h1>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 5 }}>{sub}</div>}
      </div>
      {right}
    </header>
  );
}
