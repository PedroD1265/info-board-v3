import {
  ref,
  getBytes,
  uploadBytes,
  getMetadata,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import { storage } from "./firebase.js";

export const MANIFEST_PATH = "carousel/manifest.json";

export const SLOT_DEFS = [
  { id:"01ad", kind:"image" },
  { id:"02ad", kind:"image" },
  { id:"03ad", kind:"image" },
  { id:"04ad", kind:"image" },
  { id:"05ad", kind:"image" },
  { id:"01video", kind:"video" },
  { id:"02video", kind:"video" }
];

export function defaultManifest(){
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    board: { durationMs: 30000 },
    slots: SLOT_DEFS.map(s => ({
      id: s.id,
      kind: s.kind,
      enabled: false,
      path: null,
      contentType: null,
      size: null,
      durationMs: 10000,
      useVideoDuration: s.kind === "video" ? true : false,
      cacheBuster: null,
      updatedAt: null
    }))
  };
}

export async function readManifest(){
  const mref = ref(storage, MANIFEST_PATH);
  const bytes = await getBytes(mref, 128 * 1024);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

export async function writeManifest(manifest){
  const mref = ref(storage, MANIFEST_PATH);
  const data = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  // manifest siempre “no-cache” para que el público lo vea rápido
  await uploadBytes(mref, data, {
    contentType: "application/json",
    cacheControl: "no-cache"
  });
  return true;
}

export async function getManifestMeta(){
  const mref = ref(storage, MANIFEST_PATH);
  return getMetadata(mref);
}

export async function getUrlForPath(path){
  const oref = ref(storage, path);
  return getDownloadURL(oref);
}

export async function deletePath(path){
  const oref = ref(storage, path);
  return deleteObject(oref);
}

