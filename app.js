// ====== Tankito — v0.1 ======
// Prima versione funzionante: mappa + pin stazioni vicine

const SNAPSHOT_URL = "data/latest.json";
const DEFAULT_CENTER = [39.4699, -0.3763]; // Valencia
const DEFAULT_ZOOM = 12;
const RADIUS_KM = 30; // raggio di stazioni da mostrare

const statusEl = document.getElementById("status");

// ---- 1. Inizializza la mappa ----
const map = L.map("map", {
  zoomControl: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

// Tile dark theme di CARTO (gratis)
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 19,
  }
).addTo(map);

// ---- 2. Prova a prendere la posizione dell'utente ----
let userCenter = DEFAULT_CENTER;

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCenter = [pos.coords.latitude, pos.coords.longitude];
      map.setView(userCenter, DEFAULT_ZOOM);
      loadStations();
    },
    () => {
      // se l'utente nega, rimaniamo su Valencia
      loadStations();
    },
    { timeout: 5000 }
  );
} else {
  loadStations();
}

// ---- 3. Distanza tra due coordinate (formula Haversine) ----
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- 4. Parsing numero spagnolo "1,459" -> 1.459 ----
function parsePrice(str) {
  if (!str || typeof str !== "string") return null;
  const n = parseFloat(str.replace(",", "."));
  return isNaN(n) ? null : n;
}

// ---- 5. Carica le stazioni dallo snapshot ----
async function loadStations() {
  try {
    statusEl.textContent = "Cargando datos…";
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error("No se pudo cargar el snapshot");
    const data = await res.json();

    const allStations = data.ListaEESSPrecio || [];
    const [userLat, userLng] = userCenter;

    // Filtra solo le stazioni nel raggio
    const nearby = [];
    for (const s of allStations) {
      const lat = parsePrice(s["Latitud"]);
      const lng = parsePrice(s["Longitud (WGS84)"]);
      if (lat === null || lng === null) continue;

      const d = distanceKm(userLat, userLng, lat, lng);
      if (d <= RADIUS_KM) {
        nearby.push({ station: s, lat, lng, distance: d });
      }
    }

    // Disegna i pin
    for (const { station, lat, lng } of nearby) {
      const gasolina95 = parsePrice(station["Precio Gasolina 95 E5"]);
      const diesel = parsePrice(station["Precio Gasoleo A"]);

      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        fillColor: "#4ade80",
        color: "#0f1419",
        weight: 1.5,
        fillOpacity: 0.9,
      }).addTo(map);

      const popupHtml = `
        <div class="station-popup">
          <h3>${station["Rótulo"] || "Estación"}</h3>
          <div class="address">${station["Dirección"] || ""}</div>
          <div class="prices">
            ${
              gasolina95
                ? `<div class="price-row"><span>Gasolina 95</span><span class="price-value">${gasolina95.toFixed(3)} €/L</span></div>`
                : ""
            }
            ${
              diesel
                ? `<div class="price-row"><span>Diésel</span><span class="price-value">${diesel.toFixed(3)} €/L</span></div>`
                : ""
            }
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);
    }

    statusEl.textContent = `${nearby.length} gasolineras cerca de ti`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error al cargar los datos";
  }
}
