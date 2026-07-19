import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Firebase Web-Config ist kein Geheimnis (siehe Firebase-Doku) — Zugriffsschutz
// erfolgt über die Realtime Database Security Rules, nicht durch Geheimhaltung
// dieser Werte. Ersetze die Platzhalter nach dem Anlegen deines Firebase-Projekts.
const firebaseConfig = {
  apiKey: "AIzaSyDNGGeptGQ0DmPyH80Jaazp-poRwJgr0ac",
  authDomain: "wg-plan-a8a4d.firebaseapp.com",
  databaseURL: "https://wg-plan-a8a4d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wg-plan-a8a4d",
  storageBucket: "wg-plan-a8a4d.firebasestorage.app",
  messagingSenderId: "327458996781",
  appId: "1:327458996781:web:06ec823ba8bcbff4902ea4",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
