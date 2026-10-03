import { NAV_ITEMS, NAV_ICON_SHAPES, TOPBAR_ICON_SHAPES, activeNavPath } from '../shared/nav.mjs';

// Shared server-rendered shell chrome (§ PWA shell v2) — the desktop sidebar, the compact top app
// bar, and the compact bottom tab bar, consumed by diggings.js, scout.js, huntReport.js, and
// claimoffice.js so a navigation change is one edit here instead of four.

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iconSvg(iconKey, { size = 22 } = {}) {
  const shapes = NAV_ICON_SHAPES[iconKey] || [];
  const inner = shapes.map(({ tag, attrs }) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return `<${tag} ${attrStr}></${tag}>`;
  }).join('');
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const PLUS_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

function pageSealSvg(iconKey) {
  const icon = TOPBAR_ICON_SHAPES[iconKey] || TOPBAR_ICON_SHAPES.map;
  const renderShapes = (shapes) => shapes.map(({ tag, attrs }) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return `<${tag} ${attrStr}></${tag}>`;
  }).join('');
  return `<svg class="prospect-page-seal" viewBox="0 0 32 32" aria-hidden="true">
    <circle class="prospect-page-seal-outer" cx="16" cy="16" r="14"></circle>
    <circle class="prospect-page-seal-inner" cx="16" cy="16" r="11.5"></circle>
    <g class="prospect-page-seal-base" transform="translate(4 4)">${renderShapes(icon.base)}</g>
    <g class="prospect-page-seal-accent" transform="translate(4 4)">${renderShapes(icon.accent)}</g>
  </svg>`;
}

// Desktop 272px sidebar — identical markup/classes to the pre-v2 per-page copies, now emitted
// once. `activePath` must already be one of NAV_ITEMS[].path (see shared/nav.mjs#activeNavPath).
export function renderSidebarNav(activePath) {
  const items = NAV_ITEMS.map((item) => {
    const isActive = item.path === activePath;
    const indicatorStyle = isActive ? ' style="view-transition-name:nav-active-indicator"' : '';
    return `
      <a href="${item.path}" class="nav-item${isActive ? ' is-active' : ''}">
        <span class="nav-indicator${isActive ? ' is-active' : ''}"${indicatorStyle} aria-hidden="true"></span>
        <span class="nav-title">${esc(item.desktopTitle)}</span>
        <span class="nav-sub">${esc(item.gloss)}</span>
      </a>`;
  }).join('');
  return `
    <aside class="report-aside">
      <a class="report-wordmark-link" href="/" aria-label="Prospect — Claim Map"><img class="report-wordmark" src="/brand/prospect-lockup.svg" alt="Prospect"></a>
      <nav class="nav">${items}</nav>
      <div class="report-foot"><a class="report-foot-link" href="/pledge">self-hosted · local-first</a></div>
    </aside>`;
}

// Compact sticky top app bar — present on all five pages, owns safe-area-inset-top. The plus
// deep-links to /?stake=1 (the SPA parses the initial `stake` param on mount, see App.jsx).
export function renderTopBar(activePath) {
  const active = NAV_ITEMS.find((i) => i.path === activePath);
  const title = active ? active.mobileLabel : 'Prospect';
  return `
    <header class="prospect-topbar">
      ${pageSealSvg(active?.icon || 'map')}
      <span class="prospect-topbar-title">${esc(title)}</span>
      <a class="prospect-topbar-stake" href="/?stake=1" aria-label="Stake a claim">${PLUS_SVG}</a>
    </header>`;
}

// Fixed, persistent bottom tab bar — present on all five pages, owns safe-area-inset-bottom.
export function renderTabBar(activePath) {
  const items = NAV_ITEMS.map((item) => {
    const isActive = item.path === activePath;
    const current = isActive ? ' aria-current="page"' : '';
    return `
      <a href="${item.path}" class="prospect-tab${isActive ? ' is-active' : ''}"${current}>
        ${iconSvg(item.icon)}
        <span class="prospect-tab-label">${esc(item.mobileLabel)}</span>
      </a>`;
  }).join('');
  return `<nav class="prospect-tabbar" aria-label="Primary">${items}</nav>`;
}

// Convenience bundle for the four SSR page modules — resolves activePath once via
// activeNavPath() and returns all three chrome fragments together.
export function renderShellChrome(path) {
  const activePath = activeNavPath(path) ?? '/';
  return {
    activePath,
    sidebarHtml: renderSidebarNav(activePath),
    topBarHtml: renderTopBar(activePath),
    tabBarHtml: renderTabBar(activePath),
  };
}

// Shared shell CSS — desktop sidebar/nav (unchanged from pre-v2) plus the compact top bar and
// bottom tab bar. Page-specific styles (tables, cards, tally tiles, ...) stay local to each
// module's own STYLE constant; only the chrome shared across all four SSR pages lives here.
//
// Motion/color tokens are duplicated by hand from design-system/tokens/*.css, same reasoning as
// the existing per-page STYLE blocks (no build step for these SSR templates) — kept in sync
// manually across shell.js, huntReport.js, claimoffice.js, diggings.js, and app/src/app-shell.css.
export const SHELL_STYLE = `
  :root {
    --wet-slate: #1B2327; --placer-gold: #CDA349; --gold: #CDA349;
    --verdigris: #4C8C78; --iron-oxide: #A14B33; --galena: #6E767B;
    --slate-900: #10171A; --slate-850: #161E22; --slate-800: #1B2327;
    --slate-750: #212B2F; --slate-700: #283338; --galena-dim: #3A4448;
    --quartz-100: #F3EFE6; --quartz-200: #E7E1D3; --quartz-400: #9AA1A4;
    --line: #2E383C; --line-strong: #3A4448;
    --bg-base: var(--slate-800); --bg-sunken: var(--slate-900);
    --surface-card: var(--slate-750); --surface-raised: var(--slate-700);
    --text-strong: var(--quartz-100); --text-body: var(--quartz-200);
    --text-muted: var(--galena); --text-faint: var(--quartz-400);
    --danger: var(--iron-oxide);
    --font-slab: 'Zilla Slab', Georgia, serif;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    background: var(--bg-base); color: var(--text-body); font-family: var(--font-sans);
    font-size: 16px; line-height: 1.55;
  }
  a { color: var(--verdigris); }
  .report-shell { display: grid; grid-template-columns: 272px 1fr; min-height: 100vh; }
  .report-aside {
    border-right: 1px solid var(--line); background: var(--slate-850);
    padding: 24px 20px; display: flex; flex-direction: column; gap: 22px;
  }
  .report-wordmark-link { display: block; align-self: center; width: 100%; max-width: 232px; }
  .report-wordmark { display: block; width: 100%; height: auto; }
  .nav { display: flex; flex-direction: column; gap: 6px; }
  .nav-item {
    position: relative; display: flex; flex-direction: column; line-height: 1.15;
    text-decoration: none; gap: 3px; padding: 9px 11px; border-radius: 9px;
    border: 1px solid var(--line); background: var(--surface-card);
  }
  .nav-item.is-active { background: var(--surface-raised); }
  .nav-title { font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--text-strong); }
  .nav-sub { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); }
  .nav-indicator {
    position: absolute; left: -1px; top: 6px; bottom: 6px; width: 3px;
    border-radius: 0 2px 2px 0; background: var(--verdigris); opacity: 0;
  }
  .nav-indicator.is-active { opacity: 1; }
  .report-foot {
    display: flex; align-items: center; gap: 10px; margin-top: auto;
    padding-top: 16px; border-top: 1px solid var(--line);
    font-family: var(--font-mono); font-size: 10px; color: var(--text-faint);
  }
  .report-foot-link { color: inherit; text-decoration: none; border-bottom: 1px solid transparent; }
  .report-foot-link:hover { color: var(--text-body); border-bottom-color: var(--line); }

  /* Compact chrome replaces the rail before tablet layouts become cramped. */
  .prospect-topbar, .prospect-tabbar { display: none; }

  @media (max-width: 960px) {
    .report-shell { display: block; }
    /* §PWA shell v2: the stacked desktop rail is removed from layout entirely on compact
       viewports (display:none), not shrunk — the compact top bar + bottom tab bar replace it. */
    .report-aside { display: none; }

    :root { --prospect-tabbar-safe: calc(60px + var(--sab, 0px)); }

    .prospect-topbar {
      display: flex; align-items: center; gap: 10px;
      position: sticky; top: 0; z-index: 40;
      padding: calc(10px + var(--sat, 0px)) 16px 10px;
      background: var(--slate-850); border-bottom: 1px solid var(--line);
    }
    .prospect-page-seal { width: 40px; height: 40px; display: block; flex-shrink: 0; fill: none; }
    .prospect-page-seal-outer { stroke: var(--text-strong); stroke-width: 1.35; }
    .prospect-page-seal-inner { stroke: var(--line-strong, var(--line)); stroke-width: 1; }
    .prospect-page-seal-base {
      stroke: var(--text-body); stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round;
    }
    .prospect-page-seal-accent {
      color: var(--placer-gold, var(--gold, #CDA349));
      stroke: var(--placer-gold, var(--gold, #CDA349));
      stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
    }
    .prospect-topbar-title {
      flex: 1; min-width: 0; font-family: var(--font-slab); font-weight: 700; font-size: 17px;
      color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .prospect-topbar-stake {
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border-radius: 10px;
      border: 1px solid var(--line); background: var(--surface-card); color: var(--text-body);
      text-decoration: none;
    }

    .prospect-tabbar {
      display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
      background: var(--slate-850); border-top: 1px solid var(--line);
      padding-bottom: var(--sab, 0px);
    }
    .prospect-tab {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; min-height: 44px; padding: 6px 4px 8px;
      text-decoration: none; color: var(--text-faint);
    }
    .prospect-tab-label { font-family: var(--font-sans); font-size: 10.5px; font-weight: 600; }
    .prospect-tab.is-active { color: var(--verdigris); }
    .prospect-topbar-stake:focus-visible, .prospect-tab:focus-visible {
      outline: 2px solid var(--verdigris); outline-offset: -2px;
    }

    .report-main { padding-bottom: var(--prospect-tabbar-safe, 60px) !important; }
  }
`;
