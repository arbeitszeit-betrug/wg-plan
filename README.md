# WG-Plan

Wochenputz- und Einkaufs-Rotationsplan für die WG. React + Vite, gehostet auf GitHub Pages,
geteilter Speicher über Firebase Realtime Database (Live-Sync zwischen allen Mitbewohner:innen).

## Link mit den Mitbewohner:innen teilen

Live-Link: `https://hanneskornagel98-dot.github.io/wg-plan/`

Diesen Link in der WhatsApp-Gruppe anpinnen. Jede:r, der/die ihn öffnet, sieht denselben
Stand und Änderungen (z.B. neue Person, neuer Raum) erscheinen bei allen automatisch, ohne
Neuladen.

## Lokal entwickeln

```bash
npm install
npm run dev
```

Für die lokale Entwicklung braucht `src/firebase.js` eine gültige Firebase-Config (siehe unten).

## Änderungen veröffentlichen

1. Code lokal ändern.
2. Committen und auf `main` pushen:
   ```bash
   git add -A
   git commit -m "Beschreibung der Änderung"
   git push
   ```
3. Fertig — GitHub Actions baut die App automatisch neu und deployed sie auf
   `https://hanneskornagel98-dot.github.io/wg-plan/`. Nach ca. 1–2 Minuten ist die Änderung live
   (Fortschritt im "Actions"-Tab des Repos sichtbar).

## Firebase-Setup (einmalig)

1. [Firebase-Konsole](https://console.firebase.google.com/) öffnen, neues Projekt anlegen.
2. Im Projekt: **Build → Realtime Database → Datenbank erstellen** (Standort z.B.
   `europe-west1`), Start im **Testmodus** ist ok, Regeln werden im nächsten Schritt angepasst.
3. Unter **Regeln** folgendes eintragen (beschränkt Lese-/Schreibzugriff auf den einen
   Pfad, den die App nutzt — kein Login nötig, aber auch kein offener Zugriff auf die
   ganze Datenbank):
   ```json
   {
     "rules": {
       "wg-plan-config": {
         ".read": true,
         ".write": true
       },
       "$other": {
         ".read": false,
         ".write": false
       }
     }
   }
   ```
4. **Projekteinstellungen → Allgemein → Meine Apps → Web-App hinzufügen** (</> Symbol),
   Namen vergeben, registrieren. Firebase zeigt dann ein `firebaseConfig`-Objekt.
5. Die Werte aus diesem Objekt in `src/firebase.js` eintragen (ersetzt die
   `"REPLACE_ME"`-Platzhalter). Diese Werte sind laut Firebase-Doku kein Geheimnis —
   der Zugriffsschutz läuft über die Regeln aus Schritt 3, nicht über Geheimhaltung der
   Config. Sie können also ganz normal mit ins öffentliche Repo committet werden.
6. Änderung committen und pushen (siehe oben) — danach ist die geteilte Speicherung live.

## GitHub Pages aktivieren (einmalig)

Im Repo unter **Settings → Pages → Source** auf **GitHub Actions** stellen (nicht
"Deploy from a branch"). Das reicht — der Workflow in
`.github/workflows/deploy.yml` übernimmt den Rest bei jedem Push auf `main`.
