// ====== Tankito Service Worker — v0.1 ======
// Strategia:
//   - File app (HTML/CSS/JS/icone): Cache First (veloce, offline-ready)
//   - Dati prezzi (data/latest.json): Network First (sempre freschi se possibile)
//   - Tile mappa Leaflet: Cache First (riducono il consumo dati)
const CACHE_VERSION = "tankito-v3";
const APP_CACHE = `${CACHE_VERSION}-app`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;

// File essenziali da scaricare subito quando l'utente installa l'app
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/favicon-16.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap"
];

// ===== Install: pre-cache dell'app shell =====
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })));
    }).then(() => self.skipWaiting())
  );
});

// ===== Activate: pulizia delle cache vecchie =====
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ===== Fetch: routing per tipo di risorsa =====
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Solo richieste GET
  if (event.request.method !== "GET") return;

  // 1. Dati prezzi: Network First (sempre freschi se possibile)
  if (url.pathname.endsWith("/data/latest.json")) {
    event.respondWith(networkFirst(event.request, DATA_CACHE));
    return;
  }

  // 2. Tile mappa CARTO: Cache First (alto traffico, basso aggiornamento)
  if (url.hostname.includes("basemaps.cartocdn.com")) {
    event.respondWith(cacheFirst(event.request, TILE_CACHE));
    return;
  }

  // 3. Geocoding Nominatim: Network Only (no cache, sempre fresco)
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    return; // lascia che il browser gestisca normalmente
  }

  // 4. Tutto il resto (app shell, font, leaflet): Cache First
  if (url.origin === self.location.origin || APP_SHELL.includes(event.request.url)) {
    event.respondWith(cacheFirst(event.request, APP_CACHE));
    return;
  }
});

// ===== Strategie =====

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}
