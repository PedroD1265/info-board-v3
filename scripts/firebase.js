import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyA3f-IdR6O_kl3LLeru3vNG1qFgBGJg_O0",
  authDomain: "info-board-v3.firebaseapp.com",
  projectId: "info-board-v3",
  storageBucket: "info-board-v3.firebasestorage.app",
  messagingSenderId: "70958093532",
  appId: "1:70958093532:web:750f05dc1606da3d789019"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export async function initAuthPersistence(){
  try{
    await setPersistence(auth, browserLocalPersistence);
  }catch(_){}
}

export async function signInGoogle(){
  await initAuthPersistence();

  // Intentamos popup; si el navegador lo bloquea, hacemos redirect
  try{
    return await signInWithPopup(auth, provider);
  }catch(e){
    // fallback
    await signInWithRedirect(auth, provider);
    return null;
  }
}

export async function handleAuthRedirect(){
  try{
    const res = await getRedirectResult(auth);
    return res || null;
  }catch(_){
    return null;
  }
}

export function onAuth(cb){
  return onAuthStateChanged(auth, cb);
}

export async function signOutUser(){
  return signOut(auth);
}
