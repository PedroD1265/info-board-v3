import { onAuth, signInGoogle, signOutUser, handleAuthRedirect } from "./firebase.js";
import { auth, storage } from "./firebase.js";

import {
  ref,
  uploadBytesResumable,
  getMetadata,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import {
  SLOT_DEFS,
  defaultManifest,
  readManifest,
  writeManifest,
} from "./manifest.js";

const ADMIN_EMAIL = "pedelvi@gmail.com";

// UI
const authState = document.getElementById("authState");
const authEmail = document.getElementById("authEmail");
const btnLogin  = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");

const adminPanel = document.getElementById("adminPanel");
const authDenied = document.getElementById("authDenied");

const slotSelect = document.getElementById("slotSelect");
const fileInput = document.getElementById("fileInput");
const fileHint = document.getElementById("fileHint");

const durationSelect = document.getElementById("durationSelect");
const useVideoDuration = document.getElementById("useVideoDuration");

const btnUpload = document.getElementById("btnUpload");
const btnToggle = document.getElementById("btnToggle");
const btnDelete = document.getElementById("btnDelete");
const btnCreateManifest = document.getElementById("btnCreateManifest");

const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

const slotList = document.getElementById("slotList");

let manifest = null;

// ---- helpers ----
function isAdminUser(user){
  return !!user?.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function setProgress(pct, text=""){
  progressBar.style.width = `${pct}%`;
  progressText.textContent = text;
}

function bytesToMB(n){ return (n / (1024*1024)).toFixed(2); }

function findSlot(id){
  return manifest?.slots?.find(s => s.id === id) || null;
}

function extFromFile(file){
  const t = (file.type || "").toLowerCase();

  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";

  if (t === "video/mp4") return "mp4";
  if (t === "video/webm") return "webm";

  return null;
}

function kindFromSlotId(id){
  return id.includes("video") ? "video" : "image";
}

function fillSelectors(){
  slotSelect.innerHTML = "";
  for (const s of SLOT_DEFS){
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.id} (${s.kind})`;
    slotSelect.appendChild(opt);
  }

  durationSelect.innerHTML = "";
  for (let i=1;i<=20;i++){
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i} segundos`;
    durationSelect.appendChild(opt);
  }
  durationSelect.value = "10";
}

function renderSlots(){
  slotList.innerHTML = "";

  for (const def of SLOT_DEFS){
    const s = findSlot(def.id) || { id:def.id, kind:def.kind, enabled:false };

    const card = document.createElement("div");
    card.className = "slotItem";

    const pill = s.enabled ? `<span class="pill on">ON</span>` : `<span class="pill off">OFF</span>`;
    const path = s.path || "—";
    const size = s.size ? `${bytesToMB(s.size)} MB` : "—";

    const dur = s.kind === "video"
      ? (s.useVideoDuration ? "duración real" : `${Math.round((s.durationMs||10000)/1000)}s`)
      : `${Math.round((s.durationMs||10000)/1000)}s`;

    card.innerHTML = `
      <h4>${s.id} ${pill}</h4>
      <div class="metaLine">Tipo: ${s.kind}</div>
      <div class="metaLine">Path: ${path}</div>
      <div class="metaLine">Tamaño: ${size}</div>
      <div class="metaLine">Duración: ${dur}</div>
      <div class="metaLine">Actualizado: ${s.updatedAt || "—"}</div>
    `;
    slotList.appendChild(card);
  }
}

async function loadManifest(){
  // Si falla la lectura, usamos defaultManifest() SOLO para que la UI no reviente,
  // pero seguimos mostrando el botón de crear manifest.
  try{
    manifest = await readManifest();
    btnCreateManifest.style.display = "none";
  }catch(e){
    manifest = null;
    btnCreateManifest.style.display = "inline-block";
  }

  if (!manifest){
    manifest = defaultManifest();
  }

  // asegura que existan todos los slots (merge)
  const map = new Map((manifest.slots||[]).map(s => [s.id, s]));
  manifest.slots = SLOT_DEFS.map(def => map.get(def.id) || ({
    id:def.id,
    kind:def.kind,
    enabled:false,
    path:null,
    contentType:null,
    size:null,
    durationMs: 10000,
    useVideoDuration: def.kind === "video",
    cacheBuster:null,
    updatedAt:null
  }));

  renderSlots();
  syncUIFromSelected();
}

function syncUIFromSelected(){
  const id = slotSelect.value;
  const slot = findSlot(id);
  const kind = kindFromSlotId(id);

  // file input types
  fileInput.value = "";
  if (kind === "image"){
    fileInput.accept = "image/jpeg,image/png,image/webp";
    fileHint.textContent = "Imágenes recomendadas: JPG (máx 50MB según rules).";
  } else {
    fileInput.accept = "video/mp4,video/webm";
    fileHint.textContent = "Videos recomendados: MP4 H.264/AAC (máx 50MB según rules).";
  }

  // duración
  const seconds = Math.round(((slot?.durationMs ?? 10000) / 1000));
  durationSelect.value = String(Math.min(20, Math.max(1, seconds)));
  useVideoDuration.checked = !!slot?.useVideoDuration;

  // checkbox solo video
  useVideoDuration.disabled = (kind !== "video");
}

async function ensureLoggedAdmin(){
  const user = auth.currentUser;
  if (!user) throw new Error("Debes iniciar sesión.");
  if (!isAdminUser(user)) throw new Error("Tu cuenta no es admin de este proyecto.");
  return user;
}

function updateManifestMeta(){
  manifest.updatedAt = new Date().toISOString();
  manifest.version = (manifest.version || 1);
}

async function createManifestInStorage(){
  await ensureLoggedAdmin();
  const m = defaultManifest();
  await writeManifest(m);
  await loadManifest();
  setProgress(0, "Manifest creado en carousel/manifest.json");
}

async function uploadToSlot(){
  await ensureLoggedAdmin();

  const id = slotSelect.value;
  const kind = kindFromSlotId(id);
  const file = fileInput.files?.[0];

  if (!file) throw new Error("Selecciona un archivo.");
  if (file.size > 50 * 1024 * 1024) throw new Error("Archivo demasiado grande (máx 50MB por rules).");

  const ext = extFromFile(file);
  if (!ext) throw new Error(`Formato no soportado: ${file.type || "desconocido"}`);

  if (kind === "image" && !file.type.startsWith("image/")) throw new Error("Este slot es solo imagen.");
  if (kind === "video" && !file.type.startsWith("video/")) throw new Error("Este slot es solo video.");

  const path = `carousel/${id}.${ext}`;

  const durationSec = parseInt(durationSelect.value, 10);
  const useReal = (kind === "video") ? !!useVideoDuration.checked : false;

  // cache: 1 día + buster por generation
  const metadata = {
    contentType: file.type,
    cacheControl: "public, max-age=31536000, immutable"
  };

  setProgress(0, `Subiendo ${id}… (${bytesToMB(file.size)} MB)`);

  const task = uploadBytesResumable(ref(storage, path), file, metadata);

  await new Promise((resolve, reject) => {
    task.on("state_changed",
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        setProgress(pct, `Subiendo ${id}: ${pct.toFixed(0)}%`);
      },
      (err) => reject(err),
      () => resolve(true)
    );
  });

  const meta = await getMetadata(ref(storage, path));
  const cacheBuster = meta.generation || String(Date.now());

  // actualiza manifest
  const slot = findSlot(id);
  slot.kind = kind;
  slot.enabled = true;
  slot.path = path;
  slot.contentType = file.type;
  slot.size = file.size;
  slot.durationMs = durationSec * 1000;
  slot.useVideoDuration = useReal;
  slot.cacheBuster = cacheBuster;
  slot.updatedAt = new Date().toISOString();

  updateManifestMeta();
  await writeManifest(manifest);

  setProgress(100, `OK: ${id} actualizado. Manifest actualizado.`);
  await loadManifest();
}

async function toggleSlot(){
  await ensureLoggedAdmin();
  const id = slotSelect.value;
  const slot = findSlot(id);
  if (!slot) return;

  slot.enabled = !slot.enabled;
  updateManifestMeta();
  await writeManifest(manifest);

  setProgress(0, `${id} ahora está ${slot.enabled ? "ON" : "OFF"}`);
  await loadManifest();
}

async function deleteSlotFile(){
  await ensureLoggedAdmin();

  const slotId = slotSelect.value;
  const slot = findSlot(slotId);

  if (!slot || !slot.path) {
    setProgress(0, "Este slot no tiene archivo para borrar.");
    return;
  }

  // seguridad extra: nunca borrar manifest
  if (slot.path.endsWith("manifest.json")) {
    setProgress(0, "Bloqueado: no se borra manifest.");
    return;
  }

  setProgress(10, `Borrando ${slotId}…`);

  // ✅ borrar objeto
  await deleteObject(ref(storage, slot.path));

  // ✅ limpiar slot + actualizar manifest
  slot.enabled = false;
  slot.path = null;
  slot.contentType = null;
  slot.size = null;
  slot.cacheBuster = null;
  slot.updatedAt = new Date().toISOString();

  updateManifestMeta();
  await writeManifest(manifest);

  setProgress(100, `${slotId} borrado. Manifest actualizado.`);
  await loadManifest();
}

// ---- auth wiring ----
btnLogin.addEventListener("click", async () => {
  authDenied.style.display = "none";
  setProgress(0, "");
  try{
    await signInGoogle();
  }catch(e){
    authDenied.textContent = "Error login: " + (e?.message || e);
    authDenied.style.display = "block";
  }
});

btnLogout.addEventListener("click", async () => {
  await signOutUser();
});

// ---- UI wiring ----
slotSelect.addEventListener("change", syncUIFromSelected);

btnUpload.addEventListener("click", async () => {
  try{ await uploadToSlot(); }
  catch(e){ setProgress(0, "Error: " + (e?.message || e)); }
});

btnToggle.addEventListener("click", async () => {
  try{ await toggleSlot(); }
  catch(e){ setProgress(0, "Error: " + (e?.message || e)); }
});

btnDelete.addEventListener("click", async () => {
  try{ await deleteSlotFile(); }
  catch(e){ setProgress(0, "Error: " + (e?.message || e)); }
});

btnCreateManifest.addEventListener("click", async () => {
  try{ await createManifestInStorage(); }
  catch(e){ setProgress(0, "Error: " + (e?.message || e)); }
});

// ---- bootstrap ----
fillSelectors();

await handleAuthRedirect();

onAuth(async (user) => {
  if (!user){
    authState.textContent = "No autenticado";
    authEmail.textContent = "";
    btnLogin.style.display = "inline-block";
    btnLogout.style.display = "none";
    adminPanel.style.display = "none";
    authDenied.style.display = "none";
    setProgress(0, "");
    return;
  }

  authState.textContent = "Autenticado";
  authEmail.textContent = user.email || "";

  btnLogin.style.display = "none";
  btnLogout.style.display = "inline-block";

  if (!isAdminUser(user)){
    adminPanel.style.display = "none";
    authDenied.textContent = "Acceso denegado: tu cuenta no es admin de este proyecto.";
    authDenied.style.display = "block";
    return;
  }

  authDenied.style.display = "none";
  adminPanel.style.display = "block";

  await loadManifest();
});
