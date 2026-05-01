// ====== Tankito — v0.5 ======
// Feature: ricerca per città/indirizzo + Mi ubicación

const SNAPSHOT_URL = "data/latest.json";
const DEFAULT_CENTER = [39.4699, -0.3763]; // Valencia
const DEFAULT_ZOOM = 12;
const RADIUS_KM = 30;
const FAV_STORAGE_KEY = "tankito_favorites_v1";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const SEARCH_DEBOUNCE_MS = 350;

const FUEL_TYPES = {
  gasolina95:    { label: "Gasolina 95",      field: "Precio Gasolina 95 E5" },
  gasolina98:    { label: "Gasolina 98",      field: "Precio Gasolina 98 E5" },
  diesel:        { label: "Diésel",           field: "Precio Gasoleo A" },
  dieselPremium: { label: "Diésel Premium",   field: "Precio Gasoleo Premium" },
  glp:           { label: "GLP",              field: "Precio Gases licuados del petróleo" },
};

// Stato
let userCenter = DEFAULT_CENTER;        // posizione GPS reale dell'utente
let activeCenter = DEFAULT_CENTER;      // centro attuale (può essere quello cercato)
let nearbyStations = [];
let favoriteStations = [];
let rawStationsIndex = {};
let allStationsRaw = [];                // tutte le stazioni grezze (per ricalcoli rapidi)
let markersLayer = null;
let searchMarker = null;                // marker blu sulla posizione cercata
let selectedFuel = "gasolina95";
let currentView = "map";
let searchDebounceTimer = null;

// DOM
const statusEl = document.getElementById("status");
const fuelSelector = document.getElementById("fuel-selector");
const btnMap = document.getElementById("btn-map");
const btnList = document.getElementById("btn-list");
const btnFav = document.getElementById("btn-fav");
const favCountEl = document.getElementById("fav-count");
const listView = document.getElementById("list-view");
const mapEl = document.getElementById("map");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const btnLocate = document.getElementById("btn-locate");

// Mappa
const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 19,
}).addTo(map);

// ---- Favoriti ----
function getFavoriteIds() {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveFavoriteIds(ids) { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(ids)); }
function isFavorite(id) { return getFavoriteIds().includes(id); }
function toggleFavorite(id) {
  const ids = getFavoriteIds();
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1);
  else ids.push(id);
  saveFavoriteIds(ids);
  refreshFavorites();
  updateFavCount();
}
function refreshFavorites() {
  const ids = getFavoriteIds();
  favoriteStations = ids.map((id) => rawStationsIndex[id]).filter((s) => s !== undefined);
}
function updateFavCount() { favCountEl.textContent = getFavoriteIds().length; }

// ---- Geolocalizzazione iniziale ----
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCenter = [pos.coords.latitude, pos.coords.longitude];
      activeCenter = userCenter;
      map.setView(userCenter, DEFAULT_ZOOM);
      loadStations();
    },
    () => loadStations(),
    { timeout: 5000 }
  );
} else {
  loadStations();
}

// ---- Utilità ----
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function parseNum(str) {
  if (!str || typeof str !== "string") return null;
  const n = parseFloat(str.replace(",", "."));
  return isNaN(n) ? null : n;
}
function priceColor(price, minPrice, maxPrice) {
  if (price === null) return "#555";
  if (maxPrice === minPrice) return "#4ade80";
  const ratio = (price - minPrice) / (maxPrice - minPrice);
  if (ratio <= 0.33) return "#4ade80";
  if (ratio <= 0.66) return "#facc15";
  return "#f87171";
}
function navigationUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// ---- Caricamento dati ----
async function loadStations() {
  try {
    statusEl.textContent = "Cargando datos…";
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error("No se pudo cargar el snapshot");
    const data = await res.json();
    allStationsRaw = data.ListaEESSPrecio || [];
    recomputeNearby();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error al cargar los datos";
  }
}

// Ricalcola le stazioni vicine in base al centro attivo
function recomputeNearby() {
  const [lat, lng] = activeCenter;
  nearbyStations = [];
  rawStationsIndex = {};

  for (const s of allStationsRaw) {
    const slat = parseNum(s["Latitud"]);
    const slng = parseNum(s["Longitud (WGS84)"]);
    if (slat === null || slng === null) continue;

    const id = s["IDEESS"];
    if (!id) continue;

    const prices = {};
    for (const key in FUEL_TYPES) {
      prices[key] = parseNum(s[FUEL_TYPES[key].field]);
    }

    const station = {
      id, lat: slat, lng: slng, prices,
      name: s["Rótulo"] || "Estación",
      address: s["Dirección"] || "",
    };

    rawStationsIndex[id] = station;

    const d = distanceKm(lat, lng, slat, slng);
    if (d <= RADIUS_KM) {
      nearbyStations.push({ ...station, distance: d });
    }
  }

  refreshFavorites();
  updateFavCount();
  renderAll();
}

// ---- Rendering (immutato dalla v0.4) ----
function stationsForCurrentView() {
  if (currentView === "fav") {
    const [lat, lng] = activeCenter;
    return favoriteStations.map((s) => ({
      ...s, distance: distanceKm(lat, lng, s.lat, s.lng),
    }));
  }
  return nearbyStations;
}

function renderAll() {
  const fuelKey = selectedFuel;
  const source = stationsForCurrentView();
  const withFuel = source.filter((s) => s.prices[fuelKey] !== null);

  if (currentView === "fav") {
    statusEl.textContent = `${favoriteStations.length} favoritos · ${FUEL_TYPES[fuelKey].label}`;
  } else {
    statusEl.textContent = `${withFuel.length} gasolineras · ${FUEL_TYPES[fuelKey].label}`;
  }

  if (currentView === "fav" && favoriteStations.length === 0) {
    if (markersLayer) map.removeLayer(markersLayer);
    listView.innerHTML = `
      <div class="empty-favs">
        <span class="emoji">⭐</span>
        Todavía no tienes favoritos.<br>
        Pulsa la estrella en cualquier gasolinera para añadirla aquí.
      </div>`;
    return;
  }

  if (withFuel.length === 0) {
    if (markersLayer) map.removeLayer(markersLayer);
    listView.innerHTML = `<p style="text-align:center;color:#8b95a7;padding:40px 16px;">Ninguna gasolinera ofrece ${FUEL_TYPES[fuelKey].label} en este momento.</p>`;
    return;
  }

  const prices = withFuel.map((s) => s.prices[fuelKey]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  renderMap(withFuel, minPrice, maxPrice, fuelKey);
  renderList(withFuel, fuelKey);
}

function buildPopupHtml(s, fuelKey) {
  const priceRows = Object.keys(FUEL_TYPES).map((k) => {
    const p = s.prices[k];
    if (p === null) return "";
    const isActive = k === fuelKey;
    return `<div class="price-row ${isActive ? "active" : ""}">
      <span>${FUEL_TYPES[k].label}</span>
      <span class="price-value">${p.toFixed(3)} €/L</span>
    </div>`;
  }).join("");

  const navUrl = navigationUrl(s.lat, s.lng);
  const favActive = isFavorite(s.id);

  return `
    <div class="station-popup" data-station-id="${s.id}">
      <div class="popup-header">
        <h3>${s.name}</h3>
