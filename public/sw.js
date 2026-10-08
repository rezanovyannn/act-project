/*
 * Service worker Pembukuan (ROADMAP Fase 9, Catatan Keputusan 70 & 73).
 * - Halaman: selalu dari jaringan; bila offline tampil /offline.html.
 * - Aset statis Next (/_next/static, nama ber-hash) & ikon: cache-first agar cepat dibuka.
 * - Data (Supabase, permintaan lintas origin, selain GET) tidak pernah disentuh/di-cache.
 */
const CACHE = "pembukuan-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i++) {
    if (!PRECACHE.includes(new URL(keys[i].url).pathname)) await cache.delete(keys[i]);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  }
});
