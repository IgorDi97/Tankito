// ====== Tankito — app.js v0.7 ======
// Novità v0.7:
//   - Cluster pin con leaflet.markercluster
//   - Disattivati a zoom >= 13 (vista quartiere/città intatta)
//   - Cluster verde→arancione→rosso per densità (palette brand)
//
// Da v0.6:
//   - Popup ricco con tutti i prezzi + carburante selezionato evidenziato
//   - Distanza utente↔stazione (Haversine) in popup, lista, favoriti

const DATA_URL = "/data/latest.json";
const FAV_KEY = "tankito_favorites_v1";
const VALENCIA = [39.4699, -0.3763];
const RADIUS_KM = 30;

const FUEL_KEYS = {
  gasolina95: "Precio Gasolina 95 E5",
  gasolina98: "Precio Gasolina 98 E5",
  diesel: "Precio Gasoleo A",
  dieselPremium: "Precio Gasoleo Premium",
  glp: "Precio Gases licuados del petróleo"
};

const FUEL_LABELS = {
  gasolina95: "Gasolina 95",
  gasolina98: "Gasolina 98",
  diesel: "Diésel",
  dieselPremium: "Diésel Premium",
  glp: "GLP"
};

const FUEL_DISPLAY_ORDER = ["gasolina95", "gasolina98", "diesel", "dieselPremium", "glp"];

// === Stato applicazione ===
let allStations = [];
let visibleStations = [];
let userLatLng = null;
let actualUserLatLng = null;
let currentFuel = "gasolina95";
let map = null;
let markersLayer = null;
let userMarker = null;
let favorites = loadFavorites();
let viewMode = "map";

// === Haversine (distanza in km tra 2 punti lat/lng) ===
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km) {
  if (km == null || isNaN(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// === Favoriti ===
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveFavorites() {
  localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  document.getElementById("fav-count").textContent = favorites.length;
}
function isFavorite(id) {
  return favorites.includes(id);
}
function toggleFavorite(id) {
  if (isFavorite(id)) {
    favorites = favorites.filter((f) => f !== id);
  } else {
    favorites.push(id);
  }
  saveFavorites();
}

// === Parsing prezzo ===
function parsePrice(str) {
  if (!str || str === "") return null;
  return parseFloat(String(str).replace(",", "."));
}

// === Estrai tutti i prezzi disponibili da una stazione ===
function extractAllPrices(station) {
  const prices = {};
  for (const fuel of FUEL_DISPLAY_ORDER) {
    const p = parsePrice(station[FUEL_KEYS[fuel]]);
    if (p) prices[fuel] = p;
  }
  return prices;
}

// === Filtro stazioni dentro raggio + ha prezzo del carburante selezionato ===
function filterStations(stations, fuel, center, radiusKm) {
  return stations
    .map((s) => {
      const price = parsePrice(s[FUEL_KEYS[fuel]]);
      const lat = parsePrice(s.Latitud);
      const lng = parsePrice(s["Longitud (WGS84)"]);
      if (!price || !lat || !lng) return null;
      const dist = distanceKm(center[0], center[1], lat, lng);
      if (dist > radiusKm) return null;
      const userDist = actualUserLatLng
        ? distanceKm(actualUserLatLng[0], actualUserLatLng[1], lat, lng)
        : dist;
      const allPrices = extractAllPrices(s);
      return { ...s, _price: price, _lat: lat, _lng: lng, _dist: dist, _userDist: userDist, _allPrices: allPrices };
    })
    .filter(Boolean);
}

// === Calcolo percentili per colorazione ===
function computeQuartiles(stations) {
  const prices = stations.map((s) => s._price).sort((a, b) => a - b);
  const n = prices.length;
  if (n === 0) return { p33: 0, p66: 0 };
  return {
    p33: prices[Math.floor(n * 0.33)],
    p66: prices[Math.floor(n * 0.66)]
  };
}

function priceColor(price, q) {
  if (price <= q.p33) return "#4ade80";
  if (price <= q.p66) return "#facc15";
  return "#f87171";
}

// === Genera HTML della tabella prezzi nel popup ===
function priceListHtml(allPrices, selectedFuel, selectedColor) {
  const rows = FUEL_DISPLAY_ORDER
    .filter((fuel) => allPrices[fuel] != null)
    .map((fuel) => {
      const isSelected = fuel === selectedFuel;
      const value = allPrices[fuel].toFixed(3);
      const color = isSelected ? selectedColor : "var(--text-tertiary)";
      const weight = isSelected ? "600" : "400";
      return `
        <div class="popup-price-row ${isSelected ? "is-selected" : ""}">
          <span class="popup-price-label" style="color:${color}; font-weight:${weight}">${FUEL_LABELS[fuel]}</span>
          <span class="popup-price-value" style="color:${color}; font-weight:${weight}">${value} €/L</span>
        </div>
      `;
    })
    .join("");
  return `<div class="popup-prices">${rows}</div>`;
}

// === Render mappa ===
function renderMap(stations) {
  if (markersLayer) markersLayer.remove();

  // === NEW v0.7: cluster intelligente ===
  markersLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 13,
    spiderfyOnMaxZoom: false,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      let size = "small";
      if (count >= 100) size = "large";
      else if (count >= 20) size = "medium";
      return L.divIcon({
        html: `<div class="cluster-inner"><span>${count}</span></div>`,
        className: `tankito-cluster tankito-cluster-${size}`,
        iconSize: L.point(40, 40)
      });
    }
  }).addTo(map);

  const q = computeQuartiles(stations);

  stations.forEach((s) => {
    const color = priceColor(s._price, q);
    const marker = L.circleMarker([s._lat, s._lng], {
      radius: 9,
      fillColor: color,
      color: "#0a0e14",
      weight: 2,
      fillOpacity: 0.95
    });

    const fav = isFavorite(s.IDEESS);
    const distText = formatDistance(s._userDist);

    const popupHtml = `
      <div class="popup">
        <div class="popup-header">
          <div class="popup-name">${s["Rótulo"] || "Gasolinera"}</div>
          <button class="popup-fav-btn ${fav ? "is-fav" : ""}" data-id="${s.IDEESS}" title="${fav ? "Quitar de favoritos" : "Guardar como favorito"}">
            ${fav ? "★" : "☆"}
          </button>
        </div>
        <div class="popup-addr">${s["Dirección"] || ""}</div>
        ${distText ? `<div class="popup-dist">📍 a ${distText} de ti</div>` : ""}
        ${priceListHtml(s._allPrices, currentFuel, color)}
        <div class="popup-actions">
          <a class="popup-link" href="https://www.google.com/maps/dir/?api=1&destination=${s._lat},${s._lng}" target="_blank" rel="noopener">🧭 Cómo llegar</a>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml);
    markersLayer.addLayer(marker);
  });

  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector(".popup-fav-btn");
    if (!btn) return;
    btn.onclick = () => {
      const id = btn.dataset.id;
      toggleFavorite(id);
      btn.classList.toggle("is-fav");
      btn.textContent = isFavorite(id) ? "★" : "☆";
      btn.title = isFavorite(id) ? "Quitar de favoritos" : "Guardar como favorito";
      if (viewMode === "fav") refreshView();
    };
  });
}

// === Render Lista ===
function renderList(stations) {
  const listEl = document.getElementById("list-view");
  if (stations.length === 0) {
    listEl.innerHTML = `<div class="empty">No hay estaciones en este filtro.</div>`;
    return;
  }
  const q = computeQuartiles(stations);
  const sorted = [...stations].sort((a, b) => a._price - b._price);

  listEl.innerHTML = sorted
    .map((s) => {
      const color = priceColor(s._price, q);
      const fav = isFavorite(s.IDEESS);
      const distText = formatDistance(s._userDist);
      return `
        <article class="station-card" data-id="${s.IDEESS}">
          <div class="card-main">
            <div class="card-name">${s["Rótulo"] || "Gasolinera"}</div>
            <div class="card-addr">${s["Dirección"] || ""}</div>
            ${distText ? `<div class="card-dist">📍 a ${distText}</div>` : ""}
          </div>
          <div class="card-side">
            <div class="card-price" style="color:${color}">${s._price.toFixed(3)}<span>€/L</span></div>
            <div class="card-actions">
              <a class="card-btn" href="https://www.google.com/maps/dir/?api=1&destination=${s._lat},${s._lng}" target="_blank" rel="noopener">🧭</a>
              <button class="card-btn fav-btn ${fav ? "is-fav" : ""}" data-id="${s.IDEESS}">${fav ? "★" : "☆"}</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  listEl.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleFavorite(id);
      btn.classList.toggle("is-fav");
      btn.textContent = isFavorite(id) ? "★" : "☆";
      if (viewMode === "fav") refreshView();
    };
  });
}

// === Render Favoriti ===
function renderFavorites() {
  const favStations = allStations
    .map((s) => {
      const price = parsePrice(s[FUEL_KEYS[currentFuel]]);
      const lat = parsePrice(s.Latitud);
      const lng = parsePrice(s["Longitud (WGS84)"]);
      if (!isFavorite(s.IDEESS)) return null;
      const userDist = actualUserLatLng && lat && lng
        ? distanceKm(actualUserLatLng[0], actualUserLatLng[1], lat, lng)
        : null;
      return { ...s, _price: price, _lat: lat, _lng: lng, _userDist: userDist };
    })
    .filter(Boolean);
  renderList(favStations);
}

// === Switch tra le 3 viste ===
function setView(mode) {
  viewMode = mode;
  document.getElementById("btn-map").classList.toggle("active", mode === "map");
  document.getElementById("btn-list").classList.toggle("active", mode === "list");
  document.getElementById("btn-fav").classList.toggle("active", mode === "fav");
  document.getElementById("map").classList.toggle("hidden", mode !== "map");
  document.getElementById("list-view").classList.toggle("hidden", mode === "map");
  document.getElementById("btn-locate").classList.toggle("hidden", mode !== "map");
  refreshView();
}

function refreshView() {
  if (viewMode === "map") {
    renderMap(visibleStations);
  } else if (viewMode === "list") {
    renderList(visibleStations);
  } else {
    renderFavorites();
  }
}

function applyFilter() {
  if (!userLatLng || allStations.length === 0) return;
  visibleStations = filterStations(allStations, currentFuel, userLatLng, RADIUS_KM);
  document.getElementById("status").textContent =
    `${visibleStations.length} gasolineras · radio ${RADIUS_KM} km`;
  refreshView();
}

// === Geolocalizzazione ===
function tryGeolocate() {
  if (!navigator.geolocation) {
    userLatLng = VALENCIA;
    actualUserLatLng = VALENCIA;
    initMapAt(VALENCIA);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      userLatLng = ll;
      actualUserLatLng = ll;
      initMapAt(ll);
    },
    () => {
      userLatLng = VALENCIA;
      actualUserLatLng = VALENCIA;
      initMapAt(VALENCIA);
    },
    { timeout: 5000 }
  );
}

function initMapAt(center) {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView(center, 13);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker(center, {
    radius: 7,
    fillColor: "#00d97e",
    color: "#0a0e14",
    weight: 3,
    fillOpacity: 1
  }).addTo(map);

  loadData();
}

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    const json = await res.json();
    allStations = json.ListaEESSPrecio || [];
    applyFilter();
  } catch (err) {
    document.getElementById("status").textContent = "Error al cargar datos";
    console.error(err);
  }
}

// === Ricerca città/indirizzo via Nominatim ===
let searchTimeout = null;
function setupSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");

  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 3) {
      results.classList.add("hidden");
      return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 350);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrapper")) {
      results.classList.add("hidden");
    }
  });
}

async function doSearch(q) {
  const results = document.getElementById("search-results");
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=es&limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.length === 0) {
      results.innerHTML = `<div class="search-empty">No hay resultados</div>`;
      results.classList.remove("hidden");
      return;
    }
    results.innerHTML = data
      .map(
        (r) => `
      <div class="search-item" data-lat="${r.lat}" data-lon="${r.lon}">
        <div class="search-name">${r.display_name.split(",")[0]}</div>
        <div class="search-addr">${r.display_name}</div>
      </div>`
      )
      .join("");
    results.classList.remove("hidden");

    results.querySelectorAll(".search-item").forEach((item) => {
      item.onclick = () => {
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        userLatLng = [lat, lon];
        if (map) {
          map.setView([lat, lon], 13);
        }
        results.classList.add("hidden");
        document.getElementById("search-input").value = "";
        applyFilter();
      };
    });
  } catch (err) {
    console.error("Search error:", err);
  }
}

function setupLocateBtn() {
  document.getElementById("btn-locate").onclick = () => {
    if (actualUserLatLng) {
      userLatLng = actualUserLatLng;
      if (map) map.setView(actualUserLatLng, 14);
      applyFilter();
    } else {
      tryGeolocate();
    }
  };
}

// === Init ===
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fav-count").textContent = favorites.length;

  document.getElementById("fuel-selector").addEventListener("change", (e) => {
    currentFuel = e.target.value;
    applyFilter();
  });

  document.getElementById("btn-map").onclick = () => setView("map");
  document.getElementById("btn-list").onclick = () => setView("list");
  document.getElementById("btn-fav").onclick = () => setView("fav");

  setupSearch();
  setupLocateBtn();
  tryGeolocate();
});
