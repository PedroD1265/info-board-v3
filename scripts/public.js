import { readManifest, getUrlForPath } from "./manifest.js";

// ======= GOOGLE SHEETS CSV =======
const PROJECTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1O1KoL8mdSwMl-GxOLaUO_QX6HFfbsOw9ghU3lZDzOOM/gviz/tq?tqx=out:csv&gid=0";

const FLIGHTS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1O1KoL8mdSwMl-GxOLaUO_QX6HFfbsOw9ghU3lZDzOOM/gviz/tq?tqx=out:csv&gid=42084063";

const REFRESH_SECONDS = 30;
const MAX_ROWS = 7;

// ======= UI refs =======
const rowsProjects = document.getElementById("rowsProjects");
const rowsFlights = document.getElementById("rowsFlights");
const errProjects = document.getElementById("errProjects");
const errFlights = document.getElementById("errFlights");
const elLast = document.getElementById("lastUpdate");
const countProjects = document.getElementById("countProjects");
const countFlights = document.getElementById("countFlights");
document.getElementById("refreshEvery").textContent = REFRESH_SECONDS;

const boardScreen = document.getElementById("boardScreen");
const mediaScreen = document.getElementById("mediaScreen");
const mediaImg = document.getElementById("mediaImg");
const mediaVideo = document.getElementById("mediaVideo");
const mediaLoading = document.getElementById("mediaLoading");

const btnFs = document.getElementById("btnFs");

let boardRefreshTimer = null;
let playlistTimer = null;
let currentIndex = 0;

let manifestCache = null;
let manifestRaw = "";
let urlCache = new Map(); // key: path|buster -> url
let audioUnlocked = false;

// ======= Clock =======
function tickClock() {
  const d = new Date();
  document.getElementById("now").textContent = d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
setInterval(tickClock, 1000);
tickClock();

// ======= CSV helpers =======
function safe(v) {
  return (v ?? "").toString().trim();
}

function normHeader(h) {
  return safe(h)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCSV(text) {
  const rows = [];
  let row = [],
    cur = "",
    inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (cur.length || row.length) {
        row.push(cur);
        cur = "";
        if (ch === "\r" && next === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function loadCSV(url) {
  const finalUrl = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  const res = await fetch(finalUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el CSV: " + res.status);

  const text = await res.text();
  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    throw new Error(
      "Google NO devolvió CSV (devolvió HTML). Revisa permisos o 'Publicar en la web'."
    );
  }

  const data = parseCSV(text);
  if (!data.length) throw new Error("CSV vacío.");

  const headersRaw = data[0];
  const headersNorm = headersRaw.map(normHeader);
  const rows = data.slice(1).filter((r) => r.some((c) => safe(c) !== ""));
  return { headersRaw, headersNorm, rows };
}

function findIdx(headersNorm, candidates) {
  for (const c of candidates) {
    const i = headersNorm.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

function requireIdx(headersNorm, candidates, label, headersRaw) {
  const i = findIdx(headersNorm, candidates);
  if (i === -1) {
    throw new Error(
      `${label}: encabezado no encontrado.\n` +
        `Busqué: ${candidates.join(", ")}\n` +
        `Encabezados detectados: ${headersRaw.join(" | ")}`
    );
  }
  return i;
}

function lastNReversed(rows, n) {
  // "El dato más actual es la última fila"
  return rows.slice(-n).reverse();
}

function statusPill(txt) {
  const t = safe(txt).toUpperCase();
  if (t.includes("COMPLET")) return `<span class="status done">${t}</span>`;
  if (t.includes("CANCEL")) return `<span class="status cancelled">${t}</span>`;
  if (t.includes("DELAY")) return `<span class="status delayed">${t}</span>`;
  if (t.includes("ON TIME") || t.includes("ONTIME"))
    return `<span class="status ontime">${t}</span>`;
  return `<span class="status">${t || "—"}</span>`;
}

// ======= Renders =======

// PROYECTOS: INSTITUCION | PROGRAMAS | PROYECTOS | ESTADO
function renderProjects(headersNorm, headersRaw, rows) {
  errProjects.style.display = "none";
  rowsProjects.innerHTML = "";

  const iInst = requireIdx(
    headersNorm,
    ["institucion", "institution"],
    "PROYECTOS/INSTITUCION",
    headersRaw
  );
  const iProg = requireIdx(
    headersNorm,
    ["programas", "programa", "programs"],
    "PROYECTOS/PROGRAMAS",
    headersRaw
  );
  const iProy = requireIdx(
    headersNorm,
    ["proyectos", "proyecto", "projects", "project"],
    "PROYECTOS/PROYECTOS",
    headersRaw
  );
  const iEst = requireIdx(
    headersNorm,
    ["estado", "status"],
    "PROYECTOS/ESTADO",
    headersRaw
  );

  const viewRows = lastNReversed(rows, MAX_ROWS);

  for (const r of viewRows) {
    const tr = document.createElement("tr");
    const inst = safe(r[iInst]) || "—";
    const prog = safe(r[iProg]) || "—";
    const proy = safe(r[iProy]) || "—";
    tr.innerHTML = `
      <td title="${inst}">${inst}</td>
      <td title="${prog}">${prog}</td>
      <td title="${proy}">${proy}</td>
      <td>${statusPill(r[iEst])}</td>
    `;
    rowsProjects.appendChild(tr);
  }

  countProjects.textContent = String(viewRows.length);
}

// VUELOS: FECHA | AERONAVE | TIPO DE VUELO | DESTINO | HORA DE SALIDA
function renderFlights(headersNorm, headersRaw, rows) {
  errFlights.style.display = "none";
  rowsFlights.innerHTML = "";

  const iFecha = requireIdx(
    headersNorm,
    ["fecha", "date"],
    "VUELOS/FECHA",
    headersRaw
  );
  const iAero = requireIdx(
    headersNorm,
    ["aeronave", "aircraft", "airplane", "avion"],
    "VUELOS/AERONAVE",
    headersRaw
  );
  const iTipo = requireIdx(
    headersNorm,
    ["tipo_de_vuelo", "tipo_vuelo", "tipo", "flight_type"],
    "VUELOS/TIPO DE VUELO",
    headersRaw
  );
  const iDest = requireIdx(
    headersNorm,
    ["destino", "destination"],
    "VUELOS/DESTINO",
    headersRaw
  );
  const iHora = requireIdx(
    headersNorm,
    ["hora_de_salida", "hora_salida", "hora", "std", "time"],
    "VUELOS/HORA DE SALIDA",
    headersRaw
  );

  const viewRows = lastNReversed(rows, MAX_ROWS);

  for (const r of viewRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td title="${safe(r[iFecha])}">${safe(r[iFecha]) || "—"}</td>
      <td title="${safe(r[iAero])}">${safe(r[iAero]) || "—"}</td>
      <td title="${safe(r[iTipo])}">${safe(r[iTipo]) || "—"}</td>
      <td title="${safe(r[iDest])}">${safe(r[iDest]) || "—"}</td>
      <td title="${safe(r[iHora])}">${safe(r[iHora]) || "—"}</td>
    `;
    rowsFlights.appendChild(tr);
  }

  countFlights.textContent = String(viewRows.length);
}

async function loadAll() {
  // PROYECTOS
  try {
    const p = await loadCSV(PROJECTS_CSV_URL);
    renderProjects(p.headersNorm, p.headersRaw, p.rows);
  } catch (e) {
    rowsProjects.innerHTML = "";
    countProjects.textContent = "0";
    errProjects.textContent = "Error: " + (e?.message || e);
    errProjects.style.display = "block";
  }

  // VUELOS
  try {
    const f = await loadCSV(FLIGHTS_CSV_URL);
    renderFlights(f.headersNorm, f.headersRaw, f.rows);
  } catch (e) {
    rowsFlights.innerHTML = "";
    countFlights.textContent = "0";
    errFlights.textContent = "Error: " + (e?.message || e);
    errFlights.style.display = "block";
  }

  elLast.textContent = new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// ======= Fullscreen + audio unlock =======
function isFullscreen() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
}
function requestFs(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen no soportado"));
}
function exitFs() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
}
function updateFsBtn() {
  const fs = !!isFullscreen();
  document.body.classList.toggle("is-fs", fs);
  btnFs.textContent = fs ? "⤡" : "⛶";
  const label = fs ? "Salir de pantalla completa" : "Pantalla completa";
  btnFs.setAttribute("aria-label", label);
  btnFs.title = label;
}
btnFs?.addEventListener("click", async () => {
  try {
    audioUnlocked = true; // gesto de usuario
    if (!isFullscreen()) await requestFs(document.documentElement);
    else await exitFs();
    updateFsBtn();
  } catch (e) {
    // nada
  }
});
document.addEventListener("fullscreenchange", updateFsBtn);
document.addEventListener("webkitfullscreenchange", updateFsBtn);
document.addEventListener("msfullscreenchange", updateFsBtn);
updateFsBtn();

// ======= Manifest / playlist =======
function withBuster(url, buster) {
  if (!buster) return url;
  return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(buster);
}

async function resolveUrl(path, buster) {
  const key = `${path}|${buster || ""}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const url = await getUrlForPath(path);
  const finalUrl = withBuster(url, buster);
  urlCache.set(key, finalUrl);
  return finalUrl;
}

function buildPlaylist(manifest) {
  const items = [];

  // 1) Board siempre primero
  items.push({ type: "board", durationMs: 30000 });

  // 2) Slots habilitados
  const slots = Array.isArray(manifest?.slots) ? manifest.slots : [];
  for (const s of slots) {
    if (!s?.enabled || !s?.path) continue;
    items.push({
      type: "media",
      kind: s.kind,
      path: s.path,
      durationMs: s.durationMs ?? 10000,
      useVideoDuration: !!s.useVideoDuration,
      cacheBuster: s.cacheBuster || null
    });
  }

  return items;
}

async function refreshManifest() {
  try {
    const m = await readManifest();
    const raw = JSON.stringify(m);
    if (raw !== manifestRaw) {
      manifestRaw = raw;
      manifestCache = m;
      urlCache.clear();
    }
  } catch (_) {
    manifestCache = null;
  }
}

function stopBoardRefresh() {
  if (boardRefreshTimer) {
    clearInterval(boardRefreshTimer);
    boardRefreshTimer = null;
  }
}
function startBoardRefresh() {
  if (boardRefreshTimer) return;
  loadAll();
  boardRefreshTimer = setInterval(loadAll, REFRESH_SECONDS * 1000);
}

function showBoard() {
  document.body.dataset.screen = "board";
  mediaScreen.style.display = "none";
  boardScreen.style.display = "block";
  stopMedia();
  startBoardRefresh();
}

function stopMedia() {
  mediaImg.style.display = "none";
  mediaVideo.style.display = "none";
  mediaLoading.style.display = "none";

  mediaVideo.pause();
  mediaVideo.removeAttribute("src");
  mediaVideo.load();
}

async function showMedia(item) {
  document.body.dataset.screen = "media";
  stopBoardRefresh();

  boardScreen.style.display = "none";
  mediaScreen.style.display = "block";

  mediaLoading.style.display = "block";
  mediaLoading.querySelector("span").textContent = "Cargando…";

  const url = await resolveUrl(item.path, item.cacheBuster);

  if (item.kind === "image") {
    mediaVideo.style.display = "none";
    mediaImg.style.display = "block";

    await new Promise((resolve) => {
      mediaImg.onload = () => resolve(true);
      mediaImg.onerror = () => resolve(false);
      mediaImg.src = url;
    });

    mediaLoading.style.display = "none";
    scheduleNext(item.durationMs || 10000);
    return;
  }

  // video
  mediaImg.style.display = "none";
  mediaVideo.style.display = "block";

  mediaVideo.muted = false;
  mediaVideo.autoplay = true;
  mediaVideo.playsInline = true;
  mediaVideo.loop = false;
  mediaVideo.controls = false;
  mediaVideo.preload = "auto";
  mediaVideo.src = url;
  mediaVideo.load();

  await new Promise((resolve) => {
    const done = () => resolve(true);
    mediaVideo.onloadedmetadata = done;
    mediaVideo.onerror = done;
    setTimeout(done, 2500);
  });

  try {
    await mediaVideo.play();
    mediaLoading.style.display = "none";
  } catch (e) {
    try {
      mediaVideo.muted = true;
      await mediaVideo.play();
      mediaLoading.querySelector("span").textContent = audioUnlocked
        ? "Reproduciendo (audio bloqueado por el navegador)"
        : "Audio bloqueado: presiona ⛶ en la tabla";
    } catch (_) {
      mediaLoading.querySelector("span").textContent = "Error reproduciendo video";
    }
  }

  if (item.useVideoDuration) {
    const safetyMs = Math.min(
      Math.max((mediaVideo.duration || 20) * 1000 + 1500, 8000),
      180000
    );
    mediaVideo.onended = () => next();
    scheduleNext(safetyMs);
  } else {
    scheduleNext(item.durationMs || 10000);
  }
}

function scheduleNext(ms) {
  if (playlistTimer) clearTimeout(playlistTimer);
  playlistTimer = setTimeout(() => next(), ms);
}

async function next() {
  const playlist = buildPlaylist(manifestCache || { slots: [] });

  currentIndex = (currentIndex + 1) % playlist.length;
  const item = playlist[currentIndex];

  if (item.type === "board") {
    showBoard();
    scheduleNext(item.durationMs || 30000);
    return;
  }

  try {
    await showMedia(item);
  } catch (_) {
    showBoard();
    scheduleNext(30000);
  }
}

async function start() {
  showBoard();

  await refreshManifest();

  currentIndex = 0; // board
  scheduleNext(30000);

  setInterval(refreshManifest, 60000);
}

start();
