// ====== Tankito — v0.3 ======
// Feature: pin colorati, selettore carburante, vista lista, navigazione

const SNAPSHOT_URL = "data/latest.json";
const DEFAULT_CENTER = [39.4699, -0.3763]; // Valencia
const DEFAULT_ZOOM = 12;
const RADIUS_KM = 30;

const FUEL_TYPES = {
  gasolina95:    { label: "Gasolina 95",      field: "Precio Gasolina 95 E5" },
  gasolina98:    { label: "Gasolina 98",      field: "Precio Gasolina 98 E5" },
  diesel:        { label: "Diésel",           field: "Precio Gasoleo A" },
  dieselPremium: { label: "Diésel Premium",   field: "Precio Gasoleo Premium" },
  glp:           { label: "GLP",              field: "Precio Gases licuados del petróleo" },
};

let userCenter = DEFAULT_CENTER;
let allStations = [];
let markersLayer = null;
let selectedFuel = "gasolina95";

const statusEl = document.getElementById("status");
const fuelSelector = document.getElementById("fuel-selector");
const btnMap = document.getElementById("btn-map");
const btnList = document.getElementById("btn-list");
const listView = document.getElementById("list-view");
const mapEl = document.getElementById("map");

const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 19,
}).addTo(map);

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCenter = [pos.coords.latitude, pos.coords.longitude];
      map.setView(userCenter, DEFAULT_ZOOM);
      loadStations();
    },
    () => loadStations(),
    { timeout: 5000 }
  );
} else {
  loadStations();
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
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

// URL universale per navigazione: funziona su iOS, Android, desktop
function navigationUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

async function loadStations() {
  try {
    statusEl.textContent = "Cargando datos…";
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error("No se pudo cargar el snapshot");
    const data = await res.json();

    const raw = data.ListaEESSPrecio || [];
    const [userLat, userLng] = userCenter;

    allStations = [];
    for (const s of raw) {
      const lat = parseNum(s["Latitud"]);
      const lng = parseNum(s["Longitud (WGS84)"]);
      if (lat === null || lng === null) continue;
      const d = distanceKm(userLat, userLng, lat, lng);
      if (d > RADIUS_KM) continue;

      const prices = {};
      for (const key in FUEL_TYPES) {
        prices[key] = parseNum(s[FUEL_TYPES[key].field]);
      }

      allStations.push({
        lat,
        lng,
        distance: d,
        prices,
        name: s["Rótulo"] || "Estación",
        address: s["Dirección"] || "",
      });
    }

    renderAll();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error al cargar los datos";
  }
}

function renderAll() {
  const fuelKey = selectedFuel;
  const withFuel = allStations.filter((s) => s.prices[fuelKey] !== null);

  if (withFuel.length === 0) {
    statusEl.textContent = `0 gasolineras · ${FUEL_TYPES[fuelKey].label}`;
    if (markersLayer) map.removeLayer(markersLayer);
    listView.innerHTML = `<p style="text-align:center;color:#8b95a7;padding:40px 16px;">Ninguna gasolinera cercana ofrece ${FUEL_TYPES[fuelKey].label} en este momento.</p>`;
    return;
  }

  const prices = withFuel.map((s) => s.prices[fuelKey]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  statusEl.textContent = `${withFuel.length} gasolineras · ${FUEL_TYPES[fuelKey].label}`;

  renderMap(withFuel, minPrice, maxPrice, fuelKey);
  renderList(withFuel, fuelKey);
}

function renderMap(stations, minPrice, maxPrice, fuelKey) {
  if (markersLayer) map.removeLayer(markersLayer);
  markersLayer = L.layerGroup();

  for (const s of stations) {
    const price = s.prices[fuelKey];
    const color = priceColor(price, minPrice, maxPrice);

    const marker = L.circleMarker([s.lat, s.lng], {
      radius: 8,
      fillColor: color,
      color: "#0f1419",
      weight: 1.5,
      fillOpacity: 0.9,
    });

    const priceRows = Object.keys(FUEL_TYPES)
      .map((k) => {
        const p = s.prices[k];
        if (p === null) return "";
        const isActive = k === fuelKey;
        return `<div class="price-row ${isActive ? "active" : ""}">
          <span>${FUEL_TYPES[k].label}</span>
          <span class="price-value">${p.toFixed(3)} €/L</span>
        </div>`;
      })
      .join("");

    const navUrl = navigationUrl(s.lat, s.lng);

    marker.bindPopup(`
      <div class="station-popup">
        <h3>${s.name}</h3>
        <div class="address">${s.address}</div>
        <div class="prices">${priceRows}</div>
        <a class="navigate-btn" href="${navUrl}" target="_blank" rel="noopener">🧭 Cómo llegar</a>
      </div>
    `);
    markersLayer.addLayer(marker);
  }
  markersLayer.addTo(map);
}

function renderList(stations, fuelKey) {
  const sorted = [...stations].sort((a, b) => a.prices[fuelKey] - b.prices[fuelKey]);

  listView.innerHTML = sorted
    .map((s, i) => {
      const price = s.prices[fuelKey];
      const navUrl = navigationUrl(s.lat, s.lng);
      return `
        <div class="list-item">
          <div class="rank">${i + 1}</div>
          <div class="info" data-lat="${s.lat}" data-lng="${s.lng}">
            <div class="name">${s.name}</div>
            <div class="address">${s.address}</div>
            <div class="distance">${s.distance.toFixed(1)} km</div>
          </div>
          <div class="price-and-nav">
            <div class="price">${price.toFixed(3)} €/L</div>
            <a class="nav-btn" href="${navUrl}" target="_blank" rel="noopener" title="Cómo llegar">🧭</a>
          </div>
        </div>
      `;
    })
    .join("");

  // Click su info (non sul bottone nav) → apre mappa sulla stazione
  listView.querySelectorAll(".list-item .info").forEach((el) => {
    el.addEventListener("click", () => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      showMapView();
      map.setView([lat, lng], 16);
    });
  });
}

function showMapView() {
  mapEl.classList.remove("hidden");
  listView.classList.add("hidden");
  btnMap.classList.add("active");
  btnList.classList.remove("active");
  setTimeout(() => map.invalidateSize(), 50);
}

function showListView() {
  mapEl.classList.add("hidden");
  listView.classList.remove("hidden");
  btnMap.classList.remove("active");
  btnList.classList.add("active");
}

btnMap.addEventListener("click", showMapView);
btnList.addEventListener("click", showListView);

fuelSelector.addEventListener("change", (e) => {
  selectedFuel = e.target.value;
  renderAll();
});
