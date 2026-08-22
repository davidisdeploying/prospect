/* Prospect Service Worker */

const CACHE_NAME = "prospect-v__BUILD_HASH__";

const STATIC_PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/offline.html",
  "/pwa-register.js",
  "/scout-push.js",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

const DYNAMIC_PRECACHE = __PRECACHE_ASSETS__;

const ALL_PRECACHE = Array.from(new Set([...STATIC_PRECACHE, ...DYNAMIC_PRECACHE]));

function expectedContentType(pathname) {
  if (pathname === "/manifest.webmanifest") return /^(application\/manifest\+json|application\/json)/i;
  if (pathname.endsWith(".js")) return /javascript/i;
  if (pathname.endsWith(".css")) return /text\/css/i;
  if (pathname.endsWith(".png")) return /image\/png/i;
  if (pathname.endsWith(".svg")) return /image\/svg\+xml/i;
  if (pathname.endsWith(".webp")) return /image\/webp/i;
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return /image\/jpeg/i;
  if (pathname.endsWith(".woff2")) return /font\/woff2/i;
  if (pathname.endsWith(".woff")) return /font\/woff/i;
  if (pathname === "/" || pathname === "/index.html" || pathname === "/offline.html") return /text\/html/i;
  return null;
}

async function isCacheableApplicationResponse(response, requestUrl) {
  if (!response || response.status !== 200 || response.type !== "basic" || response.redirected) {
    return false;
  }

  const responseUrl = new URL(response.url);
  if (responseUrl.origin !== self.location.origin) return false;

  const expected = expectedContentType(requestUrl.pathname);
  const contentType = response.headers.get("content-type") || "";
  if (!expected || !expected.test(contentType)) return false;

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    const text = await response.clone().text();
    return text.includes('id="root"') && text.includes("/pwa-register.js");
  }

  if (requestUrl.pathname === "/offline.html") {
    const text = await response.clone().text();
    return text.includes("Prospect") && text.includes("offline");
  }

  if (requestUrl.pathname === "/manifest.webmanifest") {
    try {
      const manifest = await response.clone().json();
      return manifest.id === "/" && manifest.name === "Prospect";
    } catch {
      return false;
    }
  }

  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ALL_PRECACHE) {
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (await isCacheableApplicationResponse(res, new URL(url, self.location.origin))) {
            await cache.put(url, res);
          }
        } catch (err) {
          // Precache failure fallback
        }
      }
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    try {
      data = { notification: { title: "Scout Notification", body: event.data ? event.data.text() : "" } };
    } catch {
      data = {};
    }
  }

  const notification = data.notification || data || {};
  const title = notification.title || "Scout lead update";
  const options = {
    body: notification.body || "Open Scout to review new leads.",
    icon: notification.icon || "/icon-192.png",
    badge: notification.badge || "/icon-192.png",
    tag: notification.tag || "scout-daily-leads",
    data: {
      navigate: notification.navigate || "/scout?status=new",
      web_push: data.web_push || 8030,
    },
  };

  if (typeof notification.app_badge === "number" && "setAppBadge" in navigator) {
    navigator.setAppBadge(notification.app_badge).catch(() => {});
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawNavigate = event.notification.data && event.notification.data.navigate;
  let targetUrl = "/scout";

  if (typeof rawNavigate === "string" && rawNavigate.startsWith("/")) {
    targetUrl = rawNavigate;
  } else if (typeof rawNavigate === "string") {
    try {
      const parsed = new URL(rawNavigate, self.location.origin);
      if (parsed.origin === self.location.origin) {
        targetUrl = parsed.pathname + parsed.search + parsed.hash;
      }
    } catch {
      targetUrl = "/scout";
    }
  }

  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.focus();
          if ("navigate" in client) {
            return client.navigate(fullTargetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(fullTargetUrl);
      }
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests are network-only
  if (request.method !== "GET") {
    return;
  }

  // 2. /api/** is network-only and must NEVER be cached
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 3. Cross-origin requests: network-only
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. Navigation requests (HTML documents): Network-first
  const isNavigation = request.mode === "navigate" ||
    (request.headers.get("accept") && request.headers.get("accept").includes("text/html"));

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const isValidResponse = await isCacheableApplicationResponse(response, url);

          if (isValidResponse) {
            const isServerRendered = ["/scout", "/report", "/claim-office", "/diggings"].some((path) =>
              url.pathname.startsWith(path)
            );

            if (!isServerRendered && (url.pathname === "/" || url.pathname === "/index.html")) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          if (url.pathname === "/" || url.pathname === "/index.html") {
            const cachedSpa = await cache.match("/index.html") || await cache.match("/");
            if (cachedSpa) return cachedSpa;
          }
          const offlineDoc = await cache.match("/offline.html");
          if (offlineDoc) return offlineDoc;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        })
    );
    return;
  }

  // 5. Hashed Vite assets (/assets/*): Cache-first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          return isCacheableApplicationResponse(response, url).then((cacheable) => {
            if (!cacheable) return response;
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          });
        });
      })
    );
    return;
  }

  // 6. Pre-cached static files: Cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then(async (response) => {
        if (await isCacheableApplicationResponse(response, url)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
