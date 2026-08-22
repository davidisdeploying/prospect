// Prospect — shared navigation data (§ PWA shell v2).
//
// Single source of truth for the five top-level destinations, consumed by BOTH the Vite/React
// SPA (app/src/AppShell.jsx) and the plain-Node server renderers (server/shell.js, imported by
// diggings.js, scout.js, huntReport.js, claimoffice.js). Framework-agnostic on purpose: no JSX, no
// Node builtins — just data and pure functions, so it loads identically under Vite's ESM
// resolution and under plain `node --test`.
//
// Icon shapes are data (SVG tag + attrs), not markup, so each consumer renders them with its own
// primitives (JSX elements for React, string concatenation for server-rendered HTML) without
// duplicating the icon geometry.

export const NAV_ITEMS = [
  { path: '/diggings', desktopTitle: "The Day's Diggings", mobileLabel: 'Today', gloss: 'Queue & actions', icon: 'diggings' },
  { path: '/', desktopTitle: 'Claim Map', mobileLabel: 'Claims', gloss: 'The board', icon: 'map' },
  { path: '/scout', desktopTitle: 'Scout', mobileLabel: 'Scout', gloss: 'Daily job leads', icon: 'scout' },
  { path: '/report', desktopTitle: 'Hunt Report', mobileLabel: 'Report', gloss: 'Funnel & aging', icon: 'report' },
  { path: '/claim-office', desktopTitle: 'Claim Office', mobileLabel: 'Office', gloss: 'Companies & contacts', icon: 'office' },
];

// 24x24 viewBox line-icon shapes, stroke-based (currentColor), no fill — matches the existing
// PlusIcon()/PaydirtMark() convention in app/src. Kept as plain {tag, attrs} data so both a JSX
// renderer and a server HTML-string renderer can consume the same geometry.
export const NAV_ICON_SHAPES = {
  diggings: [
    { tag: 'rect', attrs: { x: 4, y: 4, width: 16, height: 17, rx: 2 } },
    { tag: 'path', attrs: { d: 'M4 9h16' } },
    { tag: 'path', attrs: { d: 'M8 13l2 2 4-4' } },
  ],
  map: [
    { tag: 'path', attrs: { d: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z' } },
    { tag: 'path', attrs: { d: 'M9 4v14' } },
    { tag: 'path', attrs: { d: 'M15 6v14' } },
  ],
  scout: [
    { tag: 'circle', attrs: { cx: 11, cy: 11, r: 7 } },
    { tag: 'path', attrs: { d: 'M20 20l-3.5-3.5' } },
  ],
  report: [
    { tag: 'path', attrs: { d: 'M4 20V10' } },
    { tag: 'path', attrs: { d: 'M11 20V4' } },
    { tag: 'path', attrs: { d: 'M18 20v-7' } },
    { tag: 'path', attrs: { d: 'M3 20h18' } },
  ],
  office: [
    { tag: 'rect', attrs: { x: 4, y: 8, width: 16, height: 12, rx: 1 } },
    { tag: 'path', attrs: { d: 'M9 8V6a3 3 0 0 1 6 0v2' } },
    { tag: 'path', attrs: { d: 'M4 13h16' } },
  ],
};

// Page-specific symbols for the compact top-bar "Prospect seals". The surrounding double-ring
// frame is rendered by each shell consumer; these shapes are the page's own mining-office mark.
// `accent` stays sparse so gold remains a highlight while verdigris owns navigation state.
export const TOPBAR_ICON_SHAPES = {
  diggings: {
    base: [
      { tag: 'path', attrs: { d: 'M9 6V5.5C9 3.6 10.3 2.5 12 2.5s3 1.1 3 3V6Z' } },
      { tag: 'path', attrs: { d: 'M12 6v10.5' } },
      { tag: 'path', attrs: { d: 'M10.5 16.5h3' } },
    ],
    accent: [
      { tag: 'path', attrs: { d: 'M8.5 17h7l-.9 3.1L12 22l-2.6-1.9Z', fill: 'currentColor', stroke: 'none' } },
    ],
  },
  map: {
    base: [
      { tag: 'path', attrs: { d: 'm4 7 5-2 6 2 5-2v14l-5 2-6-2-5 2Z' } },
      { tag: 'path', attrs: { d: 'M9 5v14M15 7v14' } },
    ],
    accent: [
      { tag: 'path', attrs: { d: 'M12 8v9' } },
      { tag: 'path', attrs: { d: 'm9.5 10.5 2.5-2 2.5 2-2.5 2Z' } },
    ],
  },
  scout: {
    base: [
      { tag: 'circle', attrs: { cx: 8.5, cy: 15.5, r: 3.5 } },
      { tag: 'circle', attrs: { cx: 15.5, cy: 15.5, r: 3.5 } },
      { tag: 'path', attrs: { d: 'm5.5 14 2-7h3l1.5 7 1.5-7h3l2 7' } },
      { tag: 'path', attrs: { d: 'M11.5 14h1' } },
    ],
    accent: [
      { tag: 'path', attrs: { d: 'M6.5 15.5a2 2 0 0 1 2-2' } },
      { tag: 'path', attrs: { d: 'M13.5 15.5a2 2 0 0 1 2-2' } },
    ],
  },
  report: {
    base: [
      { tag: 'path', attrs: { d: 'M9 4h6M10 4v6l-4.5 8a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 10V4' } },
    ],
    accent: [
      { tag: 'path', attrs: { d: 'M7.2 16h9.6l1.7 3a2 2 0 0 1-1.8 2H7.3a2 2 0 0 1-1.8-2Z' } },
      { tag: 'circle', attrs: { cx: 12.5, cy: 13, r: 0.8 } },
    ],
  },
  office: {
    base: [
      { tag: 'rect', attrs: { x: 4, y: 8, width: 16, height: 12, rx: 2 } },
      { tag: 'path', attrs: { d: 'M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16' } },
    ],
    accent: [
      { tag: 'rect', attrs: { x: 10.5, y: 11, width: 3, height: 4, rx: 0.7 } },
      { tag: 'path', attrs: { d: 'M11.5 17h1' } },
    ],
  },
};

// Strips a query string and/or hash off a path-ish string, always returning a leading-slash path.
export function stripNavQuery(pathWithQueryOrHash) {
  if (!pathWithQueryOrHash) return '/';
  const qIdx = pathWithQueryOrHash.indexOf('?');
  const hIdx = pathWithQueryOrHash.indexOf('#');
  let end = pathWithQueryOrHash.length;
  if (qIdx !== -1) end = Math.min(end, qIdx);
  if (hIdx !== -1) end = Math.min(end, hIdx);
  const path = pathWithQueryOrHash.slice(0, end);
  return path || '/';
}

// Resolves a pathname (optionally carrying a query string/hash, e.g. "/scout?status=new") to the
// matching NAV_ITEMS[].path, or null if it doesn't match any of the five destinations.
export function activeNavPath(pathWithQueryOrHash) {
  const pathname = stripNavQuery(pathWithQueryOrHash);
  const item = NAV_ITEMS.find((i) => i.path === pathname);
  return item ? item.path : null;
}
