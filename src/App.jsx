import React, { useState, useEffect, useRef } from "react";
import { ref, onValue, set as dbSet, push, remove as dbRemove } from "firebase/database";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import { Plus, X, ChevronLeft, ChevronRight, Package, Sparkles, CalendarPlus, Lock, LogOut, Lightbulb, CheckCircle2, Circle, Users, History, Download } from "lucide-react";

const DEFAULT_PEOPLE = ["Hannes", "Mareike", "Mirko"];
const DEFAULT_ITEMS = ["Klopapier", "WC-Reiniger", "Spülmittel", "Müllbeutel"];
const DEFAULT_ROOMS = ["Küche", "Flur", "Bad"];
const CONFIG_PATH = "wg-plan-config";
const SUGGESTIONS_PATH = "wg-plan-suggestions";
const STATUS_PATH = "wg-plan-status";
const MEETING_PATH = "wg-plan-meeting";
const DEFAULT_MEETING_INFO = { date: "", time: "18:00", place: "in der WG" };
const WEEKDAY_FULL = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const HISTORY_LENGTH = 6;

// Zusatzaufgaben, die nur 1x im Monat an die Person gehen, die gerade den jeweiligen Raum hat
const MONTHLY_EXTRA_TASKS = {
  "Küche": "Ofen putzen",
  "Bad": "Handtücher/Lappen waschen",
};
const EXTRA_TASK_INTERVAL_WEEKS = 4;

// Bedarf-Stufen für den Einkauf (null = genug da). Reihenfolge = Anzeige-Reihenfolge.
const SUPPLY_NEED_LEVELS = [
  { key: "low", label: "wird knapp", bg: "#C68B2C" },
  { key: "empty", label: "leer", bg: "#A5453B" },
];

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function totalMonths(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function monthIndexFromStart(startYM, offset) {
  const [sy, sm] = startYM.split("-").map(Number);
  const total = sy * 12 + (sm - 1) + offset;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return { y, m, label: `${MONTH_NAMES[m]} ${y}` };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDDMM(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.`;
}

function fmtDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Returns the ISO date (yyyy-mm-dd) of the Friday belonging to "this window":
// if today is Fri/Sat/Sun, that window's Friday; otherwise the upcoming Friday.
function currentWindowFriday() {
  const today = new Date();
  const day = today.getDay(); // 0 Sun ... 5 Fri, 6 Sat
  let deltaToFriday;
  if (day === 5) deltaToFriday = 0;
  else if (day === 6) deltaToFriday = -1;
  else if (day === 0) deltaToFriday = -2;
  else deltaToFriday = 5 - day; // Mon..Thu
  const f = new Date(today);
  f.setDate(f.getDate() + deltaToFriday);
  const y = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, "0");
  const d = String(f.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weeksBetweenDates(fromISO, toDate) {
  const from = new Date(fromISO + "T00:00:00");
  return Math.round((toDate - from) / (7 * 24 * 60 * 60 * 1000));
}

function icsDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDateTime(d) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${icsDate(d)}T${hh}${mm}00`;
}

// events: either all-day { uid, startDate, endDateExclusive, summary, description }
// or timed { uid, startDateTime, endDateTime, summary, description }
function buildICS(events) {
  const now = new Date();
  const stamp = icsDate(now) + "T000000Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WG-Plan//DE"];
  events.forEach(ev => {
    const dtLines = ev.startDateTime
      ? [`DTSTART:${icsDateTime(ev.startDateTime)}`, `DTEND:${icsDateTime(ev.endDateTime)}`]
      : [`DTSTART;VALUE=DATE:${icsDate(ev.startDate)}`, `DTEND;VALUE=DATE:${icsDate(ev.endDateExclusive)}`];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      ...dtLines,
      `SUMMARY:${icsEscape(ev.summary)}`,
      `DESCRIPTION:${icsEscape(ev.description)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadICS(filename, events) {
  const content = buildICS(events);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function defaultConfig() {
  const anchor = currentWindowFriday();
  return {
    people: DEFAULT_PEOPLE,
    items: DEFAULT_ITEMS,
    startMonth: todayYM(),
    rooms: DEFAULT_ROOMS,
    anchorFriday: anchor,
    extraTaskAnchor: isoDate(addDays(anchor, 7)),
    away: [],
    twoPersonAnchor: anchor,
    itemUsers: {},
  };
}

const TABS = [
  { key: "cleaning", label: "Putzplan", icon: Sparkles },
  { key: "supply", label: "Einkauf", icon: Package },
  { key: "meeting", label: "WG-Gruppe", icon: Users },
];

export default function WGPlan() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("cleaning");
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [newItem, setNewItem] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [editingPeople, setEditingPeople] = useState(false);
  const [showCleaningHistory, setShowCleaningHistory] = useState(false);
  const [showSupplyHistory, setShowSupplyHistory] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Admin-Login
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const isAdmin = !!user;

  // Vorschläge
  const [suggestions, setSuggestions] = useState({});
  const [suggestionText, setSuggestionText] = useState("");

  // PWA-Installation ("Als App installieren")
  const [installEvt, setInstallEvt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try { return localStorage.getItem("wgplan-install-dismissed") === "1"; } catch { return false; }
  });

  // Erledigt-Status (pro Woche/Monat, admin-only)
  const [status, setStatus] = useState({});

  // WG-Treffen
  const [meetingInfo, setMeetingInfo] = useState(DEFAULT_MEETING_INFO);
  const [meetingNotes, setMeetingNotes] = useState({});
  const [noteText, setNoteText] = useState("");

  // Spaß: Konfetti + Feier-Banner + fliehender Frosch
  const [confetti, setConfetti] = useState([]);
  const [celebrateCleaning, setCelebrateCleaning] = useState(false);
  const [celebrateSupply, setCelebrateSupply] = useState(false);
  const prevCleaningCompleteRef = useRef(null);
  const prevSupplyCompleteRef = useRef(null);
  const [frogPos, setFrogPos] = useState(() => ({
    x: typeof window !== "undefined" ? window.innerWidth - 70 : 300,
    y: typeof window !== "undefined" ? window.innerHeight - 100 : 500,
  }));
  const [frogScared, setFrogScared] = useState(false);
  const [frogFlip, setFrogFlip] = useState(false);
  const [frogSweat, setFrogSweat] = useState(false);
  const [frogAction, setFrogAction] = useState("frog-look");

  // Live-Sync: hört auf Firebase und übernimmt Änderungen anderer Mitbewohner
  // sofort, ohne dass die Seite neu geladen werden muss.
  useEffect(() => {
    const configRef = ref(db, CONFIG_PATH);
    const unsubscribe = onValue(
      configRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const resolvedAnchorFriday = data.anchorFriday || currentWindowFriday();
          const next = {
            people: data.people || DEFAULT_PEOPLE,
            items: data.items || DEFAULT_ITEMS,
            startMonth: data.startMonth || todayYM(),
            rooms: data.rooms || DEFAULT_ROOMS,
            anchorFriday: resolvedAnchorFriday,
            extraTaskAnchor: data.extraTaskAnchor || isoDate(addDays(resolvedAnchorFriday, 7)),
            away: data.away || [],
            twoPersonAnchor: data.twoPersonAnchor || currentWindowFriday(),
            itemUsers: data.itemUsers || {},
          };
          setConfig(next);
          if (!data.extraTaskAnchor || !data.twoPersonAnchor) {
            // Best-effort-Migration fehlender Felder. Scheitert bei Nicht-Admins an den
            // Firebase-Regeln — das ist ok und darf keinen Fehler-Hinweis auslösen.
            dbSet(configRef, next).catch(() => {});
          }
        } else {
          const initial = defaultConfig();
          dbSet(configRef, initial).catch(() => setSaveError(true));
          setConfig(initial);
        }
        setLoading(false);
      },
      () => {
        setConfig(defaultConfig());
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // Install-Prompt einfangen: erlaubt später einen eigenen "Als App installieren"-Button.
  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const suggestionsRef = ref(db, SUGGESTIONS_PATH);
    const unsubscribe = onValue(suggestionsRef, (snapshot) => {
      setSuggestions(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const statusRef = ref(db, STATUS_PATH);
    const unsubscribe = onValue(statusRef, (snapshot) => {
      setStatus(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const infoRef = ref(db, `${MEETING_PATH}/info`);
    const unsubscribe = onValue(infoRef, (snapshot) => {
      const data = snapshot.val();
      setMeetingInfo({
        date: data?.date || DEFAULT_MEETING_INFO.date,
        time: data?.time || DEFAULT_MEETING_INFO.time,
        place: data?.place || DEFAULT_MEETING_INFO.place,
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const notesRef = ref(db, `${MEETING_PATH}/notes`);
    const unsubscribe = onValue(notesRef, (snapshot) => {
      setMeetingNotes(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, []);

  // Feier-Nebeneffekte (Konfetti-Regen + Auto-Ausblenden) laufen sauber in Effects,
  // ausgelöst durch celebrateCleaning/celebrateSupply — nicht während des Renderns selbst.
  useEffect(() => {
    if (!celebrateCleaning) return;
    spawnConfettiRain();
    const t = setTimeout(() => setCelebrateCleaning(false), 3500);
    return () => clearTimeout(t);
  }, [celebrateCleaning]);

  useEffect(() => {
    if (!celebrateSupply) return;
    spawnConfettiRain();
    const t = setTimeout(() => setCelebrateSupply(false), 3500);
    return () => clearTimeout(t);
  }, [celebrateSupply]);

  // Frosch: wechselt von selbst zwischen Idle-Animationen, solange er nicht gerade erschrocken wegläuft
  useEffect(() => {
    if (frogScared) return;
    const nextAction = () => {
      const options = ["frog-look", "frog-dance", "frog-peek", "frog-wiggle", "frog-tilt"];
      setFrogAction(options[Math.floor(Math.random() * options.length)]);
    };
    const id = setInterval(nextAction, 2600 + Math.random() * 1800);
    return () => clearInterval(id);
  }, [frogScared]);

  // Transition-Erkennung (unvollständig -> vollständig) in echten Effects statt während des Renderns,
  // damit kein "setState während Render"-Muster genutzt wird.
  const safeWeekKey = config
    ? isoDate(addDays(config.anchorFriday, (weeksBetweenDates(config.anchorFriday, new Date(currentWindowFriday() + "T00:00:00")) + weekOffset) * 7))
    : null;
  const safePresentPeople = config ? config.people.filter((p) => !(config.away || []).includes(p)) : [];
  const safeDoneCleaningCount = config && safeWeekKey
    ? safePresentPeople.filter((_, i) => status.cleaning?.[safeWeekKey]?.[i]).length
    : 0;
  const safePresentLen = safePresentPeople.length;

  useEffect(() => {
    const complete = safePresentLen > 0 && safeDoneCleaningCount === safePresentLen;
    if (weekOffset === 0 && prevCleaningCompleteRef.current !== null && !prevCleaningCompleteRef.current && complete) {
      setCelebrateCleaning(true);
    }
    prevCleaningCompleteRef.current = complete;
  }, [safeDoneCleaningCount, safePresentLen, weekOffset]);

  // Einkauf-Feier wird direkt beim "gekauft"-Klick ausgelöst (siehe markBought bzw. der
  // onClick in der Einkaufsliste), nicht mehr aus einem Monats-Erledigt-Zähler.

  const save = async (next) => {
    setConfig(next);
    try {
      await dbSet(ref(db, CONFIG_PATH), next);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setAuthError("");
      setShowLogin(false);
      setLoginPassword("");
    } catch (e) {
      setAuthError("Login fehlgeschlagen — E-Mail oder Passwort falsch.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleInstall = async () => {
    if (installEvt) {
      installEvt.prompt();
      try {
        const { outcome } = await installEvt.userChoice;
        if (outcome === "accepted") setInstalled(true);
      } catch {}
      setInstallEvt(null);
    } else {
      // Kein nativer Prompt verfügbar (z.B. iOS/Safari) → kurze Anleitung ein-/ausblenden.
      setShowInstallHint((v) => !v);
    }
  };

  const dismissInstall = () => {
    setInstallDismissed(true);
    try { localStorage.setItem("wgplan-install-dismissed", "1"); } catch {}
  };

  const togglePresence = (name) => {
    const cur = config.away || [];
    const nextAway = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    save({ ...config, away: nextAway });
  };

  const addSuggestion = () => {
    const v = suggestionText.trim();
    if (!v) return;
    push(ref(db, SUGGESTIONS_PATH), {
      text: v,
      createdAt: Date.now(),
    });
    setSuggestionText("");
  };

  const dismissSuggestion = (id) => {
    dbRemove(ref(db, `${SUGGESTIONS_PATH}/${id}`));
  };

  const toggleCleaningDone = (weekKey, idx, current) => {
    dbSet(ref(db, `${STATUS_PATH}/cleaning/${weekKey}/${idx}`), !current);
  };

  // Bedarf pro Gegenstand melden: null = genug da, "low" = wird knapp, "empty" = leer.
  const setNeed = (idx, level) => {
    const path = `${STATUS_PATH}/supplyNeeds/${idx}`;
    if (!level) dbRemove(ref(db, path));
    else dbSet(ref(db, path), level);
  };

  // "Gekauft" für einen einzelnen Gegenstand: Meldung löschen und den Zähler dieses
  // Gegenstands +1 → beim nächsten Bedarf ist der nächste Nutzer dran (faire Rotation pro Artikel).
  const markBought = (idx) => {
    dbRemove(ref(db, `${STATUS_PATH}/supplyNeeds/${idx}`));
    dbSet(ref(db, `${STATUS_PATH}/supplyCount/${idx}`), (status.supplyCount?.[idx] || 0) + 1);
  };

  // Admin: festlegen, wer einen Gegenstand nutzt (und damit ihn reihum kaufen muss).
  const toggleItemUser = (name, person) => {
    const current = config.itemUsers || {};
    const base = current[name] && current[name].length ? current[name] : config.people;
    const nextUsers = base.includes(person) ? base.filter((u) => u !== person) : [...base, person];
    if (nextUsers.length === 0) return; // mindestens eine Person muss den Gegenstand nutzen
    save({ ...config, itemUsers: { ...current, [name]: nextUsers } });
  };

  const CONFETTI_COLORS = ["#C68B2C", "#3E5C76", "#5A7A5C", "#A5453B", "#9A6B1F"];

  const spawnConfettiBurst = (x, y) => {
    const id = Date.now() + Math.random();
    const pieces = Array.from({ length: 14 }, (_, i) => ({
      id: `${id}-${i}`,
      dx: (Math.random() - 0.5) * 90,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.1,
    }));
    setConfetti(c => [...c, { id, x, y, pieces, rain: false }]);
    setTimeout(() => setConfetti(c => c.filter(b => b.id !== id)), 1000);
  };

  const spawnConfettiRain = () => {
    const id = Date.now() + Math.random();
    const width = typeof window !== "undefined" ? window.innerWidth : 400;
    const pieces = Array.from({ length: 36 }, (_, i) => ({
      id: `${id}-${i}`,
      x: Math.random() * width,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.6,
    }));
    setConfetti(c => [...c, { id, pieces, rain: true }]);
    setTimeout(() => setConfetti(c => c.filter(b => b.id !== id)), 2200);
  };

  const runFrogAway = () => {
    setFrogScared(true);
    setFrogSweat(true);
    setTimeout(() => setFrogSweat(false), 650);
    setTimeout(() => {
      const maxX = (typeof window !== "undefined" ? window.innerWidth : 400) - 50;
      const maxY = (typeof window !== "undefined" ? window.innerHeight : 600) - 60;
      const newX = Math.max(10, Math.random() * maxX);
      const newY = Math.max(10, Math.random() * maxY);
      setFrogFlip(newX < frogPos.x);
      setFrogPos({ x: newX, y: newY });
      setFrogScared(false);
    }, 220);
  };

  const updateMeetingField = (field, value) => {
    const next = { ...meetingInfo, [field]: value };
    setMeetingInfo(next);
    dbSet(ref(db, `${MEETING_PATH}/info`), next).catch(() => setSaveError(true));
  };

  const addMeetingNote = () => {
    const v = noteText.trim();
    if (!v) return;
    push(ref(db, `${MEETING_PATH}/notes`), {
      text: v,
      createdAt: Date.now(),
    });
    setNoteText("");
  };

  const dismissMeetingNote = (id) => {
    dbRemove(ref(db, `${MEETING_PATH}/notes/${id}`));
  };

  if (loading || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", background: "#F1ECE0", fontFamily: "'Work Sans', sans-serif", color: "#34404A" }}>
        <style>{`
          @keyframes float-package { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
          .floaty { animation: float-package 1.1s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .floaty { animation: none; } }
        `}</style>
        <Package className="floaty" size={32} color="#C68B2C" strokeWidth={2.5} />
        Lädt Plan…
      </div>
    );
  }

  const { people, items, startMonth, rooms, anchorFriday, extraTaskAnchor, away, twoPersonAnchor } = config;
  const itemUsers = config.itemUsers || {};
  const awayList = away || [];
  const presentPeople = people.filter((p) => !awayList.includes(p));

  // PWA-Installierbarkeit: Button nur zeigen, wenn nicht schon als App gestartet/installiert.
  const isStandalone = typeof window !== "undefined" && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const showInstallButton = !isStandalone && !installed && !installDismissed;

  // Welche Woche/welcher Monat als "aktuell" (Offset 0) gilt, wird aus dem echten Datum
  // bestimmt und wandert automatisch mit. Die Rotation (wer welchen Raum/Gegenstand hat)
  // bleibt weiterhin fest am gespeicherten anchorFriday/startMonth verankert.
  const weeksFromAnchor = weeksBetweenDates(anchorFriday, new Date(currentWindowFriday() + "T00:00:00"));
  const currentMonthOffset = totalMonths(todayYM()) - totalMonths(startMonth);
  const effWeekIndex = weeksFromAnchor + weekOffset;
  const effMonthOffset = currentMonthOffset + monthOffset;

  // Einkauf: bedarfsgesteuert + faire Rotation PRO Gegenstand.
  // Jeder Gegenstand hat einen Bedarf-Status (null/genug, "low"/knapp, "empty"/leer),
  // den alle setzen können. Nur Gemeldetes muss gekauft werden. Wer einen bestimmten
  // Gegenstand kaufen muss, rotiert nur unter den Nutzern dieses Gegenstands und wechselt
  // erst, wenn er tatsächlich gekauft wurde (supplyCount pro Gegenstand).
  const supplyNeeds = status.supplyNeeds || {};
  const supplyCount = status.supplyCount || {};

  const usersForItem = (name) => {
    const defined = itemUsers[name];
    const valid = defined && defined.length ? defined.filter((u) => people.includes(u)) : people;
    return valid.length ? valid : people;
  };
  const buyerForItem = (i) => {
    const pool0 = usersForItem(items[i]);
    const presentPool = pool0.filter((u) => presentPeople.includes(u));
    const pool = presentPool.length ? presentPool : pool0;
    if (!pool.length) return null;
    const c = supplyCount[i] || 0;
    return pool[((c % pool.length) + pool.length) % pool.length];
  };

  const neededItems = items
    .map((item, i) => ({ item, i, level: supplyNeeds[i] }))
    .filter((x) => x.level)
    .map((x) => ({ ...x, buyer: buyerForItem(x.i) }));

  // Nach Käufer gruppieren, damit man sieht "🛒 Hannes kauft: A, B".
  const neededByBuyer = [];
  neededItems.forEach((it) => {
    let g = neededByBuyer.find((x) => x.buyer === it.buyer);
    if (!g) { g = { buyer: it.buyer, items: [] }; neededByBuyer.push(g); }
    g.items.push(it);
  });

  // Cleaning rotation (weekly, Fri-Sun)
  const fridayDate = addDays(anchorFriday, effWeekIndex * 7);
  const sundayDate = addDays(anchorFriday, effWeekIndex * 7 + 2);
  const weekKey = isoDate(fridayDate);
  const doneCleaning = status.cleaning?.[weekKey] || {};
  const doneCleaningCount = presentPeople.filter((_, i) => doneCleaning[i]).length;
  const weekLabel = `${WEEKDAY_SHORT[5]} ${fmtDDMM(fridayDate)}–${WEEKDAY_SHORT[0]} ${fmtDDMMYYYY(sundayDate)}`;

  const isExtraTaskWeekFor = (fd) => {
    const diff = weeksBetweenDates(extraTaskAnchor, fd);
    return ((diff % EXTRA_TASK_INTERVAL_WEEKS) + EXTRA_TASK_INTERVAL_WEEKS) % EXTRA_TASK_INTERVAL_WEEKS === 0;
  };
  const isExtraTaskWeek = isExtraTaskWeekFor(fridayDate);

  // Zwei-Personen-Modus: Sind genau 2 Mitbewohner anwesend und existieren die drei
  // Standard-Räume, macht eine Person die Küche, die andere Bad + Flur (wechselt wöchentlich).
  const twoPersonMode = presentPeople.length === 2 && rooms.includes("Küche") && rooms.includes("Bad") && rooms.includes("Flur");

  // Cleaning rotation (weekly, Fri-Sun) — people stay in fixed order, rooms rotate underneath them.
  // Jede Zuweisung: { person, rooms: [...], extraTasks: [...] } (eine Person kann mehrere Räume haben).
  let cleaningAssignments;
  if (twoPersonMode) {
    const twoRot = weeksBetweenDates(twoPersonAnchor || anchorFriday, fridayDate);
    const badPersonIdx = ((twoRot % 2) + 2) % 2; // wer diese Woche Bad + Flur macht
    cleaningAssignments = presentPeople.map((person, i) => {
      const roomList = i === badPersonIdx ? ["Bad", "Flur"] : ["Küche"];
      const extraTasks = isExtraTaskWeek ? roomList.map((r) => MONTHLY_EXTRA_TASKS[r]).filter(Boolean) : [];
      return { person, rooms: roomList, extraTasks };
    });
  } else {
    const n = rooms.length;
    cleaningAssignments = presentPeople.map((person, p) => {
      const roomIdx = ((((p - effWeekIndex) % n) + n) % n);
      const room = rooms[roomIdx];
      const extraTasks = isExtraTaskWeek && MONTHLY_EXTRA_TASKS[room] ? [MONTHLY_EXTRA_TASKS[room]] : [];
      return { person, rooms: [room], extraTasks };
    });
  }

  // Verlauf: letzte HISTORY_LENGTH Wochen/Monate relativ zur echten aktuellen Woche/Monat
  const cleaningHistory = Array.from({ length: HISTORY_LENGTH }, (_, idx) => {
    const wi = weeksFromAnchor - idx;
    const fd = addDays(anchorFriday, wi * 7);
    const key = isoDate(fd);
    const doneMap = status.cleaning?.[key] || {};
    return {
      key,
      label: `${fmtDDMM(fd)}–${fmtDDMM(addDays(anchorFriday, wi * 7 + 2))}`,
      done: people.filter((_, i) => doneMap[i]).length,
      total: people.length,
    };
  });

  const addItem = () => {
    const v = newItem.trim();
    if (!v) return;
    save({ ...config, items: [...items, v] });
    setNewItem("");
  };
  const removeItem = (idx) => {
    const name = items[idx];
    const nextItemUsers = { ...(config.itemUsers || {}) };
    delete nextItemUsers[name];
    save({ ...config, items: items.filter((_, i) => i !== idx), itemUsers: nextItemUsers });
  };

  const addRoom = () => {
    const v = newRoom.trim();
    if (!v) return;
    save({ ...config, rooms: [...rooms, v] });
    setNewRoom("");
  };
  const removeRoom = (idx) => save({ ...config, rooms: rooms.filter((_, i) => i !== idx) });

  const updatePerson = (idx, val) => {
    const p = [...people];
    p[idx] = val || `Person ${idx + 1}`;
    save({ ...config, people: p });
  };
  const addPerson = () => save({ ...config, people: [...people, `Person ${people.length + 1}`] });
  const removePerson = (idx) => {
    if (people.length <= 1) return;
    save({ ...config, people: people.filter((_, i) => i !== idx) });
  };

  const exportCleaningWeek = () => {
    const desc = cleaningAssignments.map(a => `${a.person}: ${a.rooms.join(" + ")}${a.extraTasks.length ? ` (+ ${a.extraTasks.join(", ")})` : ""}`).join("\n");
    const start = fridayDate;
    const end = addDays(anchorFriday, effWeekIndex * 7 + 3); // exclusive end = Monday
    downloadICS("wochenputz.ics", [{
      uid: `putz-${icsDate(start)}@wg-plan`,
      startDate: start,
      endDateExclusive: end,
      summary: `Wochenputz: ${cleaningAssignments.map(a => `${a.person}–${a.rooms.join("/")}`).join(", ")}`,
      description: desc,
    }]);
  };

  const exportCleaningRange = (weeks = 12) => {
    const events = [];
    const n = rooms.length;
    for (let w = 0; w < weeks; w++) {
      const wi = weeksFromAnchor + w;
      const wStart = addDays(anchorFriday, wi * 7);
      const wEnd = addDays(anchorFriday, wi * 7 + 3);
      const weekIsExtra = isExtraTaskWeekFor(wStart);
      const assigns = people.map((person, p) => {
        const roomIdx = ((((p - wi) % n) + n) % n);
        const room = rooms[roomIdx];
        const extraTask = weekIsExtra ? MONTHLY_EXTRA_TASKS[room] : undefined;
        return { person, room, extraTask };
      });
      events.push({
        uid: `putz-${icsDate(wStart)}@wg-plan`,
        startDate: wStart,
        endDateExclusive: wEnd,
        summary: `Wochenputz: ${assigns.map(a => `${a.person}–${a.room}`).join(", ")}`,
        description: assigns.map(a => `${a.person}: ${a.room}${a.extraTask ? ` (+ ${a.extraTask})` : ""}`).join("\n"),
      });
    }
    downloadICS("wochenputz-12wochen.ics", events);
  };


  const cardBase = {
    background: "#FFFFFF",
    border: "1.5px solid #DDD6C4",
    borderRadius: 12,
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };

  const inputStyle = { flex: 1, padding: "12px 14px", borderRadius: 10, border: "1.5px solid #DDD6C4", background: "#FFFFFF", fontSize: 15 };

  const toggleBtnStyle = { background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B7A6D", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 };

  const suggestionList = Object.entries(suggestions).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  const noteList = Object.entries(meetingNotes).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

  const exportMeeting = () => {
    if (!meetingInfo.date) return;
    const [hh, mm] = (meetingInfo.time || "18:00").split(":").map(Number);
    const start = new Date(meetingInfo.date + "T00:00:00");
    start.setHours(hh || 0, mm || 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const descLines = [`Ort: ${meetingInfo.place}`];
    if (noteList.length > 0) {
      descLines.push("", "Anmerkungen:", ...noteList.map(([, n]) => `- ${n.text}`));
    }
    downloadICS("wg-gruppe.ics", [{
      uid: `meeting-${meetingInfo.date}@wg-plan`,
      startDateTime: start,
      endDateTime: end,
      summary: "WG-Gruppe",
      description: descLines.join("\n"),
    }]);
  };

  const doneToggleBtn = (done, onClick) => (
    <button
      onClick={(e) => {
        if (!done) spawnConfettiBurst(e.clientX, e.clientY);
        onClick();
      }}
      aria-label={done ? "als nicht erledigt markieren" : "als erledigt markieren"}
      style={{ background: "none", border: "none", cursor: "pointer", color: done ? "#5A7A5C" : "#C9BFA5", padding: 8, margin: -8, display: "flex" }}
    >
      {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
    </button>
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F1ECE0",
      fontFamily: "'Work Sans', sans-serif",
      color: "#20241F",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .stamp-btn { transition: transform 0.15s ease; }
        .stamp-btn:hover { transform: translateY(-2px); }
        .buy-btn { transition: transform 0.15s ease, background 0.15s ease, color 0.15s ease; }
        .buy-btn:hover { background: #5A7A5C; color: #FFFDF8; }
        .buy-btn:active { background: #4C684E; color: #FFFDF8; }
        .stamp-btn:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
          outline: 3px solid #C68B2C;
          outline-offset: 2px;
        }
        input, select { font-family: inherit; }
        .nav-arrow { transition: transform 0.15s ease; }
        .nav-arrow:active { transform: scale(1.4) rotate(10deg); }
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(80px) rotate(360deg); opacity: 0; }
        }
        @keyframes confetti-rain {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
        }
        .confetti-piece { position: fixed; width: 7px; height: 7px; border-radius: 2px; pointer-events: none; }
        @keyframes celebrate-in {
          0% { opacity: 0; transform: translateY(-6px) scale(0.95); }
          10% { opacity: 1; transform: translateY(0) scale(1); }
          85% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-6px) scale(0.95); }
        }
        .celebrate-banner { animation: celebrate-in 3.5s ease forwards; }
        @keyframes frog-scared {
          0%, 100% { transform: scale(1) rotate(0deg); }
          20% { transform: scale(1.4) rotate(-18deg); }
          45% { transform: scale(1.15) rotate(14deg); }
          70% { transform: scale(1.3) rotate(-10deg); }
        }
        .frog-scared { animation: frog-scared 0.22s ease; }
        @keyframes frog-look {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-20deg); }
          50% { transform: rotate(0deg); }
          75% { transform: rotate(20deg); }
        }
        .frog-look { animation: frog-look 1.8s ease-in-out; }
        @keyframes frog-dance {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          20% { transform: translateY(-7px) rotate(-10deg); }
          40% { transform: translateY(0) rotate(10deg); }
          60% { transform: translateY(-7px) rotate(-10deg); }
          80% { transform: translateY(0) rotate(10deg); }
        }
        .frog-dance { animation: frog-dance 0.7s ease-in-out 3; }
        @keyframes frog-peek {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.3); }
        }
        .frog-peek { animation: frog-peek 0.9s ease-in-out; }
        @keyframes frog-wiggle {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          25% { transform: translateX(-5px) rotate(-6deg); }
          75% { transform: translateX(5px) rotate(6deg); }
        }
        .frog-wiggle { animation: frog-wiggle 0.35s ease-in-out 3; }
        @keyframes frog-tilt {
          0%, 100% { transform: rotate(0deg) translateY(0); }
          50% { transform: rotate(12deg) translateY(-3px); }
        }
        .frog-tilt { animation: frog-tilt 1.4s ease-in-out; }
        @keyframes sweat-pop {
          0% { opacity: 0; transform: translateY(0) scale(0.6); }
          30% { opacity: 1; transform: translateY(-4px) scale(1); }
          100% { opacity: 0; transform: translateY(-16px) scale(0.8); }
        }
        .sweat-pop { animation: sweat-pop 0.65s ease-out forwards; }
        @keyframes float-package {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .floaty { animation: float-package 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .stamp-btn { transition: none; }
          .nav-arrow { transition: none; }
          .nav-arrow:active { transform: none; }
          .floaty { animation: none; }
          .confetti-piece { display: none; }
          .frog-look, .frog-dance, .frog-peek, .frog-wiggle, .frog-tilt, .frog-scared, .sweat-pop { animation: none; }
        }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Package size={22} color="#C68B2C" strokeWidth={2.5} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B7A6D", fontWeight: 600 }}>
              WG-Plan
            </span>
          </div>
          {isAdmin ? (
            <button onClick={handleLogout} aria-label="Abmelden" title="Als Admin abmelden" style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 999, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6B7A6D" }}>
              <LogOut size={14} /> Admin
            </button>
          ) : (
            <button onClick={() => setShowLogin(v => !v)} aria-label="Admin-Login" title="Admin-Login" style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 999, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", color: "#6B7A6D" }}>
              <Lock size={14} />
            </button>
          )}
        </div>
        <h1 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: "clamp(28px, 6vw, 42px)", margin: "6px 0 24px", lineHeight: 1.05 }}>
          Wer macht was?
        </h1>

        {showInstallButton && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleInstall} className="stamp-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#C68B2C", color: "#20241F", border: "none", borderRadius: 10, padding: "13px 16px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                <Download size={18} /> Als App installieren
              </button>
              <button onClick={dismissInstall} aria-label="Ausblenden" title="Ausblenden" style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "0 12px", cursor: "pointer", color: "#8A8270", display: "flex", alignItems: "center" }}>
                <X size={16} />
              </button>
            </div>
            {showInstallHint && (
              <div style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "12px 14px", marginTop: 8, fontSize: 13, color: "#6B7A6D", lineHeight: 1.55 }}>
                {isIos ? (
                  <>Tippe unten in <b>Safari</b> auf das <b>Teilen-Symbol</b> (Quadrat mit Pfeil nach oben) und dann auf <b>„Zum Home-Bildschirm"</b>.</>
                ) : (
                  <>Öffne das Browser-Menü (<b>⋮</b>) und wähle <b>„App installieren"</b> bzw. <b>„Zum Startbildschirm hinzufügen"</b>.</>
                )}
              </div>
            )}
          </div>
        )}

        {!isAdmin && showLogin && (
          <div style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 12, padding: 16, marginBottom: 24, display: "grid", gap: 8 }}>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="E-Mail"
              type="email"
              style={inputStyle}
            />
            <input
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Passwort"
              type="password"
              style={inputStyle}
            />
            <button onClick={handleLogin} className="stamp-btn" style={{ background: "#34404A", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 600 }}>
              Anmelden
            </button>
            {authError && <p style={{ color: "#A5453B", fontSize: 13, margin: 0 }}>{authError}</p>}
          </div>
        )}

        {/* Tab-Navigation */}
        <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 14, padding: 4, marginBottom: 24 }}>
          {TABS.map(t => {
            const TabIcon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: active ? "#20241F" : "none", color: active ? "#F1ECE0" : "#6B7A6D",
                  border: "none", borderRadius: 10, padding: "10px 6px", cursor: "pointer",
                  fontWeight: 600, fontSize: 13, fontFamily: "'Work Sans', sans-serif",
                }}
              >
                <TabIcon size={15} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* ===================== PUTZPLAN (weekly) ===================== */}
        {activeTab === "cleaning" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#20241F", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
              <button onClick={() => setWeekOffset(o => o - 1)} aria-label="Vorherige Woche" className="nav-arrow" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronLeft size={20} />
              </button>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16, color: "#F1ECE0" }}>
                {weekLabel}
              </span>
              <button onClick={() => setWeekOffset(o => o + 1)} aria-label="Nächste Woche" className="nav-arrow" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronRight size={20} />
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              {weekOffset !== 0 ? (
                <button onClick={() => setWeekOffset(0)} style={{ background: "none", border: "none", color: "#6B7A6D", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                  zurück zur aktuellen Woche
                </button>
              ) : <span />}
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: doneCleaningCount === presentPeople.length ? "#5A7A5C" : "#8A8270" }}>
                {doneCleaningCount}/{presentPeople.length} erledigt
              </span>
            </div>

            {awayList.length > 0 && (
              <p style={{ fontSize: 12, color: "#8A8270", margin: "0 0 12px", fontStyle: "italic" }}>
                Gerade nicht da: {awayList.join(", ")}{twoPersonMode ? " · 2-Personen-Modus: Bad-Person macht auch den Flur" : ""}
              </p>
            )}

            {celebrateCleaning && (
              <div className="celebrate-banner" style={{ textAlign: "center", background: "#5A7A5C", color: "#FFFDF8", borderRadius: 10, padding: "8px 14px", marginBottom: 16, fontWeight: 700, fontSize: 14 }}>
                🎉 Alles erledigt diese Woche!
              </div>
            )}

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {cleaningAssignments.map((a, i) => {
                const done = !!doneCleaning[i];
                const hasExtra = a.extraTasks.length > 0;
                return (
                  <div key={i} style={{ ...cardBase, opacity: done ? 0.55 : 1, alignItems: hasExtra ? "flex-start" : "center" }}>
                    <div style={{ display: "flex", alignItems: hasExtra ? "flex-start" : "center", gap: 12, minWidth: 0 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0, marginTop: hasExtra ? 2 : 0 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 16, fontWeight: 500, textDecoration: done ? "line-through" : "none" }}>{a.person}</span>
                        {a.extraTasks.map((t, k) => (
                          <span key={k} style={{ fontSize: 12, color: "#9A6B1F", fontWeight: 600 }}>+ {t}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {a.rooms.map((room, k) => (
                        <span key={k} style={{ background: "#3E5C76", color: "#FFFDF8", fontFamily: "'Archivo Black', sans-serif", fontSize: 13, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                          {room}
                        </span>
                      ))}
                      {doneToggleBtn(done, () => toggleCleaningDone(weekKey, i, done))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {rooms.map((room, i) => (
                <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 999, padding: isAdmin ? "6px 10px 6px 14px" : "6px 14px", fontSize: 13 }}>
                  {room}
                  {isAdmin && (
                    <button onClick={() => removeRoom(i)} aria-label={`${room} entfernen`} style={{ background: "none", border: "none", cursor: "pointer", color: "#8A8270", padding: 0, display: "flex" }}>
                      <X size={13} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {isAdmin && (
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <input
                  value={newRoom}
                  onChange={(e) => setNewRoom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRoom()}
                  placeholder="Neuer Raum (z.B. Balkon)"
                  style={inputStyle}
                />
                <button onClick={addRoom} className="stamp-btn" style={{ background: "#3E5C76", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <Plus size={18} />
                </button>
              </div>
            )}

            {isAdmin && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ ...toggleBtnStyle, marginBottom: 10, cursor: "default" }}>
                  <Users size={14} /> Wer ist gerade da?
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {people.map((p, i) => {
                    const isAway = awayList.includes(p);
                    return (
                      <button
                        key={i}
                        onClick={() => togglePresence(p)}
                        style={{
                          border: "1.5px solid #DDD6C4", borderRadius: 999, padding: "8px 14px", cursor: "pointer",
                          fontSize: 13, fontWeight: 600,
                          background: isAway ? "#FFFFFF" : "#5A7A5C",
                          color: isAway ? "#9A9280" : "#FFFDF8",
                          textDecoration: isAway ? "line-through" : "none",
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: 12, color: "#9A9280", margin: "8px 0 0", lineHeight: 1.5 }}>
                  Grün = anwesend. Sind nur 2 anwesend, macht die Bad-Person automatisch auch den Flur.
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              <button onClick={exportCleaningWeek} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarPlus size={15} /> Diese Woche in Kalender
              </button>
              <button onClick={() => exportCleaningRange(12)} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarPlus size={15} /> Nächste 12 Wochen
              </button>
            </div>

            <button onClick={() => setShowCleaningHistory(v => !v)} style={{ ...toggleBtnStyle, marginBottom: 10 }}>
              <History size={14} /> Verlauf {showCleaningHistory ? "▲" : "▼"}
            </button>
            {showCleaningHistory && (
              <div style={{ display: "grid", gap: 8, marginBottom: 40 }}>
                {cleaningHistory.map(h => (
                  <div key={h.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "8px 14px", fontSize: 13 }}>
                    <span>{h.label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: h.done === h.total ? "#5A7A5C" : "#8A8270" }}>{h.done}/{h.total} erledigt</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===================== EINKAUF (bedarfsgesteuert) ===================== */}
        {activeTab === "supply" && (
          <>
            <div style={{ display: "flex", gap: 10, background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
              <Lightbulb size={18} color="#C68B2C" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 13, color: "#6B7A6D", margin: 0, lineHeight: 1.5 }}>
                Jedes Produkt rotiert <b>einzeln</b> — reihum unter den Mitbewohner, die es nutzen.
                Wer als Nächstes dran ist, wechselt erst beim tatsächlichen Kauf. Meldet einfach an,
                was knapp oder leer ist.
              </p>
            </div>

            {celebrateSupply && (
              <div className="celebrate-banner" style={{ textAlign: "center", background: "#C68B2C", color: "#FFFDF8", borderRadius: 10, padding: "8px 14px", marginBottom: 16, fontWeight: 700, fontSize: 14 }}>
                🎉 Eingekauft!
              </div>
            )}

            {/* Einkaufsliste (nur Gemeldetes), gruppiert nach Käufer */}
            <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, margin: "0 0 12px" }}>
              Zu kaufen{neededItems.length > 0 ? <span style={{ color: "#A5453B" }}> ({neededItems.length})</span> : null}
            </h2>
            {neededByBuyer.length > 0 ? (
              <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
                {neededByBuyer.map((group) => (
                  <div key={group.buyer || "—"} style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#20241F", color: "#F1ECE0", padding: "10px 16px", fontWeight: 600, fontSize: 14 }}>
                      🛒 <span style={{ fontFamily: "'Archivo Black', sans-serif" }}>{group.buyer || "—"}</span> kauft:
                    </div>
                    <div style={{ display: "grid" }}>
                      {group.items.map(({ item, i, level }, k) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderTop: k === 0 ? "none" : "1px solid #EEE8DA" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <span style={{ fontSize: 16, fontWeight: 500 }}>{item}</span>
                            <span style={{ background: level === "empty" ? "#A5453B" : "#C68B2C", color: "#FFFDF8", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {level === "empty" ? "leer" : "wird knapp"}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              spawnConfettiBurst(e.clientX, e.clientY);
                              if (neededItems.length === 1) setCelebrateSupply(true);
                              markBought(i);
                            }}
                            className="stamp-btn buy-btn"
                            title="Antippen, wenn gekauft"
                            style={{ background: "#FFFFFF", color: "#5A7A5C", border: "1.5px solid #5A7A5C", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                          >
                            <Circle size={16} /> gekauft
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 14, color: "#6B7A6D", marginBottom: 28 }}>
                Gerade muss nichts gekauft werden. 🎉
              </p>
            )}

            {/* Alle Vorräte + Bedarf melden */}
            <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, margin: "0 0 4px" }}>Vorräte</h2>
            <p style={{ fontSize: 13, color: "#6B7A6D", marginBottom: 12, lineHeight: 1.5 }}>
              Tippt an, was zur Neige geht — nur das landet oben auf der Einkaufsliste.
            </p>
            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {items.map((item, i) => {
                const level = supplyNeeds[i] || null;
                const users = usersForItem(item);
                const restricted = users.length < people.length;
                return (
                  <div key={i} style={{ ...cardBase, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", rowGap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0 }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
                          {restricted && (
                            <span style={{ fontSize: 12, color: "#8A8270" }}>nutzen: {users.join(", ")}</span>
                          )}
                        </div>
                        {isAdmin && (
                          <button onClick={() => removeItem(i)} aria-label={`${item} entfernen`} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9BFA5", padding: 2, flexShrink: 0 }}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
                        {SUPPLY_NEED_LEVELS.map((lv) => {
                          const active = level === lv.key;
                          return (
                            <button
                              key={lv.key}
                              onClick={() => setNeed(i, active ? null : lv.key)}
                              aria-pressed={active}
                              style={{
                                border: `1.5px solid ${active ? lv.bg : "#DDD6C4"}`,
                                background: active ? lv.bg : "#FFFFFF",
                                color: active ? "#FFFDF8" : "#8A8270",
                                borderRadius: 999, padding: "8px 13px", cursor: "pointer",
                                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                              }}
                            >
                              {lv.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", borderTop: "1px solid #EEE8DA", paddingTop: 10 }}>
                        <span style={{ fontSize: 11, color: "#9A9280", fontWeight: 600, letterSpacing: "0.04em", marginRight: 2 }}>WER NUTZT DAS?</span>
                        {people.map((p) => {
                          const on = users.includes(p);
                          return (
                            <button
                              key={p}
                              onClick={() => toggleItemUser(item, p)}
                              aria-pressed={on}
                              style={{
                                border: `1.5px solid ${on ? "#3E5C76" : "#DDD6C4"}`,
                                background: on ? "#3E5C76" : "#FFFFFF",
                                color: on ? "#FFFDF8" : "#9A9280",
                                borderRadius: 999, padding: "5px 11px", cursor: "pointer",
                                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                              }}
                            >
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdmin && (
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder="Neuer Gegenstand (z.B. Küchenrolle)"
                  style={inputStyle}
                />
                <button onClick={addItem} className="stamp-btn" style={{ background: "#34404A", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <Plus size={18} />
                </button>
              </div>
            )}
          </>
        )}

        {/* ===================== WG-TREFFEN ===================== */}
        {activeTab === "meeting" && (
          <>
            <div style={{ background: "#20241F", borderRadius: 14, padding: 18, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 6 }}>
                  Datum
                </div>
                {isAdmin ? (
                  <input
                    type="date"
                    value={meetingInfo.date}
                    onChange={(e) => updateMeetingField("date", e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #454C40", background: "#2B2F28", color: "#F1ECE0", fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}
                  />
                ) : (
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#F1ECE0" }}>
                    {meetingInfo.date
                      ? `${WEEKDAY_FULL[new Date(meetingInfo.date + "T00:00:00").getDay()]}, ${fmtDDMMYYYY(new Date(meetingInfo.date + "T00:00:00"))}`
                      : "Noch kein Termin"}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 6 }}>
                  Uhrzeit
                </div>
                {isAdmin ? (
                  <input
                    value={meetingInfo.time}
                    onChange={(e) => updateMeetingField("time", e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #454C40", background: "#2B2F28", color: "#F1ECE0", fontSize: 16, fontFamily: "'IBM Plex Mono', monospace" }}
                  />
                ) : (
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#F1ECE0", fontFamily: "'IBM Plex Mono', monospace" }}>{meetingInfo.time} Uhr</div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 6 }}>
                  Wo?
                </div>
                {isAdmin ? (
                  <input
                    value={meetingInfo.place}
                    onChange={(e) => updateMeetingField("place", e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #454C40", background: "#2B2F28", color: "#F1ECE0", fontSize: 16 }}
                  />
                ) : (
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#F1ECE0" }}>{meetingInfo.place}</div>
                )}
              </div>
            </div>

            {meetingInfo.date ? (
              <button onClick={exportMeeting} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 24 }}>
                <CalendarPlus size={15} /> Termin in Kalender
              </button>
            ) : (
              <p style={{ fontSize: 13, color: "#9A9280", marginBottom: 24 }}>
                Sobald ein Datum eingetragen ist, kann jeder den Termin in seinen Kalender exportieren.
              </p>
            )}

            <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, margin: "0 0 12px" }}>Anmerkungen</h2>

            {noteList.length > 0 ? (
              <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                {noteList.map(([id, n]) => (
                  <div key={id} style={cardBase}>
                    <span style={{ fontSize: 15 }}>{n.text}</span>
                    {isAdmin && (
                      <button onClick={() => dismissMeetingNote(id)} aria-label="Anmerkung löschen" title="Löschen" style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#8A8270", display: "flex", flexShrink: 0 }}>
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#9A9280", marginBottom: 16 }}>Noch keine Anmerkungen.</p>
            )}

            <p style={{ fontSize: 13, color: "#6B7A6D", marginBottom: 12, lineHeight: 1.5 }}>
              Hier kann jeder notieren, was zur WG-Gruppe mitgebracht werden muss oder worüber sich
              bis dahin schon mal Gedanken gemacht werden soll.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 40, flexWrap: "wrap" }}>
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addMeetingNote()}
                placeholder="Notizen..."
                style={{ ...inputStyle, minWidth: 160 }}
              />
              <button onClick={addMeetingNote} className="stamp-btn" style={{ background: "#34404A", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
                <Plus size={18} />
              </button>
            </div>
          </>
        )}

        {/* ===================== VORSCHLÄGE ===================== */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Lightbulb size={18} color="#C68B2C" />
          <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, margin: 0 }}>Vorschläge</h2>
        </div>

        {suggestionList.length > 0 ? (
          <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            {suggestionList.map(([id, s]) => (
              <div key={id} style={cardBase}>
                <span style={{ fontSize: 15 }}>{s.text}</span>
                {isAdmin && (
                  <button onClick={() => dismissSuggestion(id)} aria-label="Vorschlag löschen" title="Löschen" style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#8A8270", display: "flex", flexShrink: 0 }}>
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "#9A9280", marginBottom: 16 }}>Noch keine Vorschläge.</p>
        )}

        <p style={{ fontSize: 13, color: "#6B7A6D", marginBottom: 12, lineHeight: 1.5 }}>
          Hier könnt ihr Vorschläge, Ideen, Funktionswünsche oder sonst was reinschreiben —
          ich schau dann, ob ich das umsetzen/integrieren kann.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 40, flexWrap: "wrap" }}>
          <input
            value={suggestionText}
            onChange={(e) => setSuggestionText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSuggestion()}
            placeholder="Dein Vorschlag..."
            style={{ ...inputStyle, minWidth: 160 }}
          />
          <button onClick={addSuggestion} className="stamp-btn" style={{ background: "#34404A", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Plus size={18} />
          </button>
        </div>

        {/* People editor — nur Admin */}
        {isAdmin && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setEditingPeople(v => !v)} style={{ ...toggleBtnStyle, marginBottom: 10 }}>
              Mitbewohner bearbeiten {editingPeople ? "▲" : "▼"}
            </button>
            {editingPeople && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {people.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <input
                      value={p}
                      onChange={(e) => updatePerson(i, e.target.value)}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1.5px solid #DDD6C4", background: "#FFFFFF", fontSize: 14 }}
                    />
                    <button onClick={() => removePerson(i)} aria-label={`${p} entfernen`} style={{ background: "none", border: "1.5px solid #DDD6C4", borderRadius: 8, cursor: "pointer", color: "#8A8270", padding: "0 10px" }}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={addPerson} style={{ background: "none", border: "1.5px dashed #B9AF97", borderRadius: 8, padding: "8px", cursor: "pointer", color: "#6B7A6D", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Plus size={14} /> Person hinzufügen
                </button>
              </div>
            )}
          </div>
        )}

        {saveError && (
          <p style={{ color: "#A5453B", fontSize: 13, marginTop: 8 }}>
            Änderungen konnten nicht gespeichert werden. Bitte nochmal versuchen.
          </p>
        )}

        <p style={{ fontSize: 12, color: "#9A9280", marginTop: 20, lineHeight: 1.6 }}>
          Die Liste wird geteilt gespeichert — öffnet jeder Mitbewohner diesen Link, sieht er denselben Stand.
          Putzplan rotiert wöchentlich (Fr–So) automatisch. Beim Einkauf meldet jeder, was zur Neige geht;
          gekauft wird nur, was gemeldet ist, und wer einkauft wechselt reihum. Über die Kalender-Buttons
          im Putzplan lädt sich jeder eine .ics-Datei herunter. Neue Gegenstände oder Räume könnt ihr über "Vorschläge" einreichen.
        </p>
      </div>

      {confetti.map(burst => (
        <React.Fragment key={burst.id}>
          {burst.pieces.map(p => (
            <span
              key={p.id}
              className="confetti-piece"
              style={burst.rain
                ? { left: p.x, top: -10, background: p.color, animation: `confetti-rain 1.6s ease-in forwards`, animationDelay: `${p.delay}s` }
                : { left: burst.x + p.dx, top: burst.y, background: p.color, animation: `confetti-fall 0.9s ease-out forwards`, animationDelay: `${p.delay}s` }
              }
            />
          ))}
        </React.Fragment>
      ))}

      <div
        style={{
          position: "fixed",
          left: frogPos.x,
          top: frogPos.y,
          transition: "left 0.45s cubic-bezier(.34,1.56,.64,1), top 0.45s cubic-bezier(.34,1.56,.64,1)",
          zIndex: 500,
        }}
      >
        {frogSweat && (
          <span className="sweat-pop" style={{ position: "absolute", top: -10, right: -6, fontSize: 15 }}>
            💦
          </span>
        )}
        <button
          onClick={runFrogAway}
          aria-label="Kleiner Frosch"
          title="Ribbit!"
          className={frogScared ? "frog-scared" : frogAction}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            fontSize: 30,
            lineHeight: 1,
            display: "inline-block",
            transform: frogFlip ? "scaleX(-1)" : "scaleX(1)",
          }}
        >
          🐸
        </button>
      </div>
    </div>
  );
}
