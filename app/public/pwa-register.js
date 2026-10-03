(function () {
  "use strict";

  const isLocalhost = Boolean(
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]"
  );
  const isSecure = window.isSecureContext || isLocalhost;

  if (!("serviceWorker" in navigator) || !isSecure) {
    return;
  }

  const isStandalone = Boolean(
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showUpdateBanner(registration) {
    if (document.getElementById("prospect-pwa-update-banner")) return;
    const banner = document.createElement("div");
    banner.id = "prospect-pwa-update-banner";
    banner.setAttribute("role", "alert");
    banner.style.cssText = [
      "position: fixed",
      "bottom: calc(20px + var(--prospect-tabbar-safe, 0px))",
      "right: 20px",
      "z-index: 9999",
      "background: #212B2F",
      "color: #E7E1D3",
      "border: 1px solid #CDA349",
      "border-radius: 12px",
      "padding: 14px 18px",
      "box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4)",
      "display: flex",
      "align-items: center",
      "gap: 14px",
      "font-family: Inter, system-ui, sans-serif",
      "font-size: 13px"
    ].join(";");

    const text = document.createElement("span");
    text.textContent = "A new version of Prospect is ready.";
    banner.appendChild(text);

    const reloadBtn = document.createElement("button");
    reloadBtn.id = "pwa-update-reload-btn";
    reloadBtn.textContent = "Reload";
    reloadBtn.style.cssText = [
      "background: #4C8C78",
      "color: #FFFFFF",
      "border: none",
      "border-radius: 6px",
      "padding: 6px 12px",
      "font-size: 12px",
      "font-weight: 600",
      "cursor: pointer"
    ].join(";");

    reloadBtn.onclick = function () {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      } else {
        window.location.reload();
      }
    };
    banner.appendChild(reloadBtn);

    document.body.appendChild(banner);
  }

  function showIosGuidance() {
    const DISMISS_KEY = "prospect-pwa-ios-guidance-dismissed";
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (!isIOS || isStandalone) return;

    const banner = document.createElement("div");
    banner.id = "prospect-pwa-ios-guidance";
    banner.style.cssText = [
      "position: fixed",
      "bottom: var(--prospect-tabbar-safe, 0px)",
      "left: 0",
      "right: 0",
      "z-index: 9998",
      "background: #161E22",
      "color: #E7E1D3",
      "border-top: 1px solid #2E383C",
      "padding: 12px 16px",
      "display: flex",
      "align-items: center",
      "justify-content: space-between",
      "gap: 12px",
      "font-family: Inter, system-ui, sans-serif",
      "font-size: 13px",
      "box-shadow: 0 -4px 16px rgba(0,0,0,0.3)"
    ].join(";");

    const text = document.createElement("div");
    text.textContent = "Install Prospect: tap Share then Add to Home Screen";
    banner.appendChild(text);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Dismiss installation guidance");
    closeBtn.style.cssText = [
      "background: transparent",
      "border: none",
      "color: #9AA1A4",
      "font-size: 16px",
      "cursor: pointer",
      "padding: 4px 8px"
    ].join(";");

    closeBtn.onclick = function () {
      localStorage.setItem(DISMISS_KEY, "1");
      banner.remove();
    };
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);
  }

  window.addEventListener("load", function () {
    showIosGuidance();

    navigator.serviceWorker.register("/sw.js").then(function (registration) {
      registration.addEventListener("updatefound", function () {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.addEventListener("statechange", function () {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(registration);
            }
          });
        }
      });
    }).catch(function (err) {
      console.warn("Prospect PWA Service Worker registration failed:", err);
    });
  });
})();
