// Verschickt die Wochenputz-Erinnerung an alle aktivierten Geräte.
// Läuft im GitHub-Actions-Job (per Zeitplan) über die Firebase-Admin-SDK — kostenlos,
// kein Blaze nötig. Der Service-Account-Key kommt aus dem Secret FIREBASE_SA.

import admin from "firebase-admin";

const DATABASE_URL = "https://wg-plan-a8a4d-default-rtdb.europe-west1.firebasedatabase.app";
const APP_URL = "https://arbeitszeit-betrug.github.io/wg-plan/";
const MONTHLY_EXTRA_TASKS = { "Küche": ["Ofen putzen", "Balkon putzen"], "Bad": ["Handtücher/Lappen waschen"] };
const extrasForRoom = (room) => MONTHLY_EXTRA_TASKS[room] || [];
const EXTRA_TASK_INTERVAL_WEEKS = 4;

if (!process.env.FIREBASE_SA) {
  console.error("FIREBASE_SA (Service-Account-JSON) fehlt als Umgebungsvariable/Secret.");
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)),
  databaseURL: DATABASE_URL,
});
const db = admin.database();

// --- Rotationslogik (identisch zur App) ---
function currentWindowFridayDate(now = new Date()) {
  const day = now.getDay(); // 0 So ... 5 Fr, 6 Sa
  let delta;
  if (day === 5) delta = 0;
  else if (day === 6) delta = -1;
  else if (day === 0) delta = -2;
  else delta = 5 - day;
  const f = new Date(now);
  f.setHours(0, 0, 0, 0);
  f.setDate(f.getDate() + delta);
  return f;
}
function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}
function weeksBetween(fromISO, toDate) {
  const from = new Date(fromISO + "T00:00:00");
  return Math.round((toDate - from) / (7 * 24 * 60 * 60 * 1000));
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDDMM(d) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

async function main() {
  const [cfgSnap, tokSnap] = await Promise.all([
    db.ref("wg-plan-config").get(),
    db.ref("wg-plan-push/tokens").get(),
  ]);
  const config = cfgSnap.val();
  const tokensObj = tokSnap.val() || {};
  const valid = Object.entries(tokensObj)
    .map(([key, v]) => ({ key, token: v && v.token }))
    .filter((x) => x.token);

  if (!config || valid.length === 0) {
    console.log(`Nichts zu senden (config: ${!!config}, tokens: ${valid.length}).`);
    return;
  }

  const people = config.people || [];
  const rooms = config.rooms || [];
  const anchorFriday = config.anchorFriday;
  const away = config.away || [];
  const twoPersonAnchor = config.twoPersonAnchor || anchorFriday;
  const extraTaskAnchor = config.extraTaskAnchor || anchorFriday;
  const presentPeople = people.filter((p) => !away.includes(p));

  const fri = currentWindowFridayDate();
  const friISO = isoDate(fri);
  const effWeekIndex = weeksBetween(anchorFriday, fri);
  const isExtraWeek = (((weeksBetween(extraTaskAnchor, fri) % EXTRA_TASK_INTERVAL_WEEKS) + EXTRA_TASK_INTERVAL_WEEKS) % EXTRA_TASK_INTERVAL_WEEKS) === 0;
  const twoPersonMode = presentPeople.length === 2 && rooms.includes("Küche") && rooms.includes("Bad") && rooms.includes("Flur");

  let assignments;
  if (twoPersonMode) {
    const twoRot = weeksBetween(twoPersonAnchor, fri);
    const badIdx = ((twoRot % 2) + 2) % 2;
    assignments = presentPeople.map((person, i) => {
      const rl = i === badIdx ? ["Bad", "Flur"] : ["Küche"];
      const extra = isExtraWeek ? rl.flatMap((r) => extrasForRoom(r)) : [];
      return { person, rooms: rl, extra };
    });
  } else {
    const n = rooms.length;
    assignments = presentPeople.map((person, p) => {
      const roomIdx = ((((p - effWeekIndex) % n) + n) % n);
      const room = rooms[roomIdx];
      const extra = isExtraWeek ? extrasForRoom(room) : [];
      return { person, rooms: [room], extra };
    });
  }

  const sun = addDaysISO(friISO, 2);
  const title = `🧹 Wochenputz ${fmtDDMM(fri)}–${fmtDDMM(sun)}`;
  const body = assignments
    .map((a) => `${a.person}: ${a.rooms.join(" + ")}${a.extra.length ? ` (+ ${a.extra.join(", ")})` : ""}`)
    .join("\n");

  const tokens = valid.map((x) => x.token);
  const resp = await admin.messaging().sendEachForMulticast({
    notification: { title, body },
    webpush: { fcmOptions: { link: APP_URL } },
    tokens,
  });
  console.log(`Gesendet: ${resp.successCount} ok, ${resp.failureCount} fehlgeschlagen.`);

  // Nicht mehr gültige Tokens aus der DB entfernen.
  const removals = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
        removals.push(db.ref(`wg-plan-push/tokens/${valid[i].key}`).remove());
      }
    }
  });
  await Promise.all(removals);
  if (removals.length) console.log(`${removals.length} ungültige Token entfernt.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
