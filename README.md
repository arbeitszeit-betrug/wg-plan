# WG-Plan

Wochenputz- und Einkaufs-Rotationsplan für die WG. React + Vite, gehostet auf GitHub Pages,
geteilter Speicher über Firebase Realtime Database (Live-Sync zwischen allen Mitbewohner).

Nur der Admin-Account (E-Mail/Passwort-Login über das Schloss-Symbol) kann Personen, Räume
und Gegenstände bearbeiten. Aufgaben als erledigt markieren können alle, auch ohne Login —
genau wie den Plan ansehen, den Kalender exportieren und freie Vorschläge/Ideen einreichen.

## Link mit den Mitbewohner teilen

Live-Link: `https://arbeitszeit-betrug.github.io/wg-plan/`

Diesen Link in der WhatsApp-Gruppe anpinnen. Jeder, der ihn öffnet, sieht denselben
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
   `https://arbeitszeit-betrug.github.io/wg-plan/`. Nach ca. 1–2 Minuten ist die Änderung live
   (Fortschritt im "Actions"-Tab des Repos sichtbar).

## Firebase-Setup (einmalig)

1. [Firebase-Konsole](https://console.firebase.google.com/) öffnen, neues Projekt anlegen.
2. Im Projekt: **Build → Realtime Database → Datenbank erstellen** (Standort z.B.
   `europe-west1`), Start im **Testmodus** ist ok, Regeln werden im nächsten Schritt angepasst.
3. **Projekteinstellungen → Allgemein → Meine Apps → Web-App hinzufügen** (</> Symbol),
   Namen vergeben, registrieren. Firebase zeigt dann ein `firebaseConfig`-Objekt.
4. Die Werte aus diesem Objekt in `src/firebase.js` eintragen (ersetzt die
   `"REPLACE_ME"`-Platzhalter). Diese Werte sind laut Firebase-Doku kein Geheimnis —
   der Zugriffsschutz läuft über die Regeln aus Schritt 6, nicht über Geheimhaltung der
   Config. Sie können also ganz normal mit ins öffentliche Repo committet werden.
5. **Authentication → Get started → Sign-in method → Email/Password → aktivieren.**
   Das ist der Admin-Login: nur wer mit E-Mail+Passwort eingeloggt ist, darf Personen/
   Räume/Gegenstände bearbeiten. Mitbewohner brauchen dafür keinen Account.
6. **Authentication → Users → Add user** — eigene E-Mail-Adresse und ein selbstgewähltes
   Passwort eintragen. Das ist der einzige Admin-Zugang der App (nur du).
7. Unter **Realtime Database → Regeln** folgendes eintragen (ersetze
   `hannes.kornagel98@gmail.com` durch genau die E-Mail-Adresse aus Schritt 6):
   ```json
   {
     "rules": {
       "wg-plan-config": {
         ".read": true,
         ".write": "auth != null && auth.token.email === 'hannes.kornagel98@gmail.com'"
       },
       "wg-plan-suggestions": {
         ".read": true,
         "$suggestionId": {
           ".write": "!data.exists() || (auth != null && auth.token.email === 'hannes.kornagel98@gmail.com')"
         }
       },
       "wg-plan-status": {
         ".read": true,
         ".write": true
       },
       "wg-plan-meeting": {
         "info": {
           ".read": true,
           ".write": "auth != null && auth.token.email === 'hannes.kornagel98@gmail.com'"
         },
         "notes": {
           ".read": true,
           "$noteId": {
             ".write": "!data.exists() || (auth != null && auth.token.email === 'hannes.kornagel98@gmail.com')"
           }
         }
       },
       "$other": {
         ".read": false,
         ".write": false
       }
     }
   }
   ```
   Damit können alle lesen, Erledigt-Häkchen setzen und neue Vorschläge einreichen,
   aber nur der Admin-Account kann Personen/Räume/Gegenstände bearbeiten oder Vorschläge löschen.
8. Änderung committen und pushen (siehe oben) — danach ist alles live. Zum Bearbeiten
   auf das Schloss-Symbol oben rechts in der App klicken und mit der E-Mail/Passwort
   aus Schritt 6 einloggen (bleibt im Browser gespeichert, bis man sich abmeldet).

## GitHub Pages aktivieren (einmalig)

Im Repo unter **Settings → Pages → Source** auf **GitHub Actions** stellen (nicht
"Deploy from a branch"). Das reicht — der Workflow in
`.github/workflows/deploy.yml` übernimmt den Rest bei jedem Push auf `main`.
