export function renderPwaHeadTags({ title }) {
  return `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1B2327">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Prospect">
<title>${title}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style id="prospect-pwa-safe-area">
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
}
/* §PWA shell v2: top/bottom insets are owned by the compact top bar and bottom tab bar
   (server/shell.js SHELL_STYLE) once they're present, not by a blanket body padding that would
   double up with them. Left/right have no dedicated chrome, so body keeps owning those. */
body {
  padding-right: var(--sar);
  padding-left: var(--sal);
}
</style>
<script src="/pwa-register.js" defer></script>
`.trim();
}
