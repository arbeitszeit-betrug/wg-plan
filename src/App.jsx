import React, { useState, useEffect } from "react";
import { ref, onValue, set as dbSet, push, remove as dbRemove } from "firebase/database";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import { Plus, X, ChevronLeft, ChevronRight, Package, Sparkles, CalendarPlus, Lock, LogOut, Lightbulb, CheckCircle2, Circle, Users, History } from "lucide-react";

const DEFAULT_PEOPLE = ["Hannes", "Mareike", "Mirko"];
const DEFAULT_ITEMS = ["Klopapier", "WC-Reiniger", "Spülmittel", "Müllbeutel"];
const DEFAULT_ROOMS = ["Küche", "Flur", "Bad"];
const CONFIG_PATH = "wg-plan-config";
const SUGGESTIONS_PATH = "wg-plan-suggestions";
const STATUS_PATH = "wg-plan-status";
const MEETING_PATH = "wg-plan-meeting";
const DEFAULT_MEETING_INFO = { time: "18:00", place: "in der WG" };
const HISTORY_LENGTH = 6;

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

function icsDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// events: [{ uid, startDate (Date), endDateExclusive (Date), summary, description }]
function buildICS(events) {
  const now = new Date();
  const stamp = icsDate(now) + "T000000Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WG-Plan//DE"];
  events.forEach(ev => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.startDate)}`,
      `DTEND;VALUE=DATE:${icsDate(ev.endDateExclusive)}`,
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
  return {
    people: DEFAULT_PEOPLE,
    items: DEFAULT_ITEMS,
    startMonth: todayYM(),
    rooms: DEFAULT_ROOMS,
    anchorFriday: currentWindowFriday(),
  };
}

const TABS = [
  { key: "cleaning", label: "Putzplan", icon: Sparkles },
  { key: "supply", label: "Einkauf", icon: Package },
  { key: "meeting", label: "WG-Treffen", icon: Users },
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

  // Erledigt-Status (pro Woche/Monat, admin-only)
  const [status, setStatus] = useState({});

  // WG-Treffen
  const [meetingInfo, setMeetingInfo] = useState(DEFAULT_MEETING_INFO);
  const [meetingNotes, setMeetingNotes] = useState({});
  const [noteText, setNoteText] = useState("");

  // Live-Sync: hört auf Firebase und übernimmt Änderungen anderer Mitbewohner
  // sofort, ohne dass die Seite neu geladen werden muss.
  useEffect(() => {
    const configRef = ref(db, CONFIG_PATH);
    const unsubscribe = onValue(
      configRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setConfig({
            people: data.people || DEFAULT_PEOPLE,
            items: data.items || DEFAULT_ITEMS,
            startMonth: data.startMonth || todayYM(),
            rooms: data.rooms || DEFAULT_ROOMS,
            anchorFriday: data.anchorFriday || currentWindowFriday(),
          });
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

  const toggleSupplyDone = (monthKey, idx, current) => {
    dbSet(ref(db, `${STATUS_PATH}/supply/${monthKey}/${idx}`), !current);
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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F1ECE0", fontFamily: "'Work Sans', sans-serif", color: "#34404A" }}>
        Lädt Plan…
      </div>
    );
  }

  const { people, items, startMonth, rooms, anchorFriday } = config;

  // Supply rotation (monthly)
  const { y: supplyY, m: supplyM, label: monthLabel } = monthIndexFromStart(startMonth, monthOffset);
  const monthKey = `${supplyY}-${String(supplyM + 1).padStart(2, "0")}`;
  const supplyAssignments = items.map((item, i) => {
    const personIdx = (monthOffset + i) % people.length;
    return { item, person: people[personIdx] };
  });
  const doneSupply = status.supply?.[monthKey] || {};
  const doneSupplyCount = items.filter((_, i) => doneSupply[i]).length;

  // Cleaning rotation (weekly, Fri-Sun)
  const fridayDate = addDays(anchorFriday, weekOffset * 7);
  const sundayDate = addDays(anchorFriday, weekOffset * 7 + 2);
  const weekKey = isoDate(fridayDate);
  const doneCleaning = status.cleaning?.[weekKey] || {};
  const doneCleaningCount = people.filter((_, i) => doneCleaning[i]).length;
  const weekLabel = `${WEEKDAY_SHORT[5]} ${fmtDDMM(fridayDate)}–${WEEKDAY_SHORT[0]} ${fmtDDMMYYYY(sundayDate)}`;
  // Cleaning rotation (weekly, Fri-Sun) — people stay in fixed order, rooms rotate underneath them
  const cleaningAssignments = people.map((person, p) => {
    const n = rooms.length;
    const roomIdx = ((((p - weekOffset) % n) + n) % n);
    return { person, room: rooms[roomIdx], roomIdx };
  });

  // Verlauf: letzte HISTORY_LENGTH Wochen/Monate, unabhängig von der aktuell angezeigten Woche/Monat
  const cleaningHistory = Array.from({ length: HISTORY_LENGTH }, (_, idx) => {
    const w = -idx;
    const fd = addDays(anchorFriday, w * 7);
    const key = isoDate(fd);
    const doneMap = status.cleaning?.[key] || {};
    return {
      key,
      label: `${fmtDDMM(fd)}–${fmtDDMM(addDays(anchorFriday, w * 7 + 2))}`,
      done: people.filter((_, i) => doneMap[i]).length,
      total: people.length,
    };
  });

  const currentMonthOffset = totalMonths(todayYM()) - totalMonths(startMonth);
  const supplyHistory = Array.from({ length: HISTORY_LENGTH }, (_, idx) => {
    const offset = currentMonthOffset - idx;
    const { y, m, label } = monthIndexFromStart(startMonth, offset);
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    const doneMap = status.supply?.[key] || {};
    return {
      key,
      label,
      done: items.filter((_, i) => doneMap[i]).length,
      total: items.length,
    };
  });

  const addItem = () => {
    const v = newItem.trim();
    if (!v) return;
    save({ ...config, items: [...items, v] });
    setNewItem("");
  };
  const removeItem = (idx) => save({ ...config, items: items.filter((_, i) => i !== idx) });

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
    const desc = cleaningAssignments.map(a => `${a.person}: ${a.room}`).join("\n");
    const start = fridayDate;
    const end = addDays(anchorFriday, weekOffset * 7 + 3); // exclusive end = Monday
    downloadICS("wochenputz.ics", [{
      uid: `putz-${icsDate(start)}@wg-plan`,
      startDate: start,
      endDateExclusive: end,
      summary: `Wochenputz: ${cleaningAssignments.map(a => `${a.person}–${a.room}`).join(", ")}`,
      description: desc,
    }]);
  };

  const exportCleaningRange = (weeks = 12) => {
    const events = [];
    const n = rooms.length;
    for (let w = 0; w < weeks; w++) {
      const wStart = addDays(anchorFriday, w * 7);
      const wEnd = addDays(anchorFriday, w * 7 + 3);
      const assigns = people.map((person, p) => {
        const roomIdx = ((((p - w) % n) + n) % n);
        return { person, room: rooms[roomIdx] };
      });
      events.push({
        uid: `putz-${icsDate(wStart)}@wg-plan`,
        startDate: wStart,
        endDateExclusive: wEnd,
        summary: `Wochenputz: ${assigns.map(a => `${a.person}–${a.room}`).join(", ")}`,
        description: assigns.map(a => `${a.person}: ${a.room}`).join("\n"),
      });
    }
    downloadICS("wochenputz-12wochen.ics", events);
  };

  const exportSupplyMonth = () => {
    const [sy, sm] = startMonth.split("-").map(Number);
    const total = sy * 12 + (sm - 1) + monthOffset;
    const y = Math.floor(total / 12), m = total % 12;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    downloadICS("einkaufsplan.ics", [{
      uid: `einkauf-${icsDate(start)}@wg-plan`,
      startDate: start,
      endDateExclusive: end,
      summary: `Einkauf: ${supplyAssignments.map(a => `${a.item}–${a.person}`).join(", ")}`,
      description: supplyAssignments.map(a => `${a.item}: ${a.person}`).join("\n"),
    }]);
  };

  const exportSupplyRange = (months = 12) => {
    const [sy, sm] = startMonth.split("-").map(Number);
    const events = [];
    for (let mo = 0; mo < months; mo++) {
      const total = sy * 12 + (sm - 1) + mo;
      const y = Math.floor(total / 12), m = total % 12;
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 1);
      const assigns = items.map((item, i) => ({ item, person: people[(mo + i) % people.length] }));
      events.push({
        uid: `einkauf-${icsDate(start)}@wg-plan`,
        startDate: start,
        endDateExclusive: end,
        summary: `Einkauf: ${assigns.map(a => `${a.item}–${a.person}`).join(", ")}`,
        description: assigns.map(a => `${a.item}: ${a.person}`).join("\n"),
      });
    }
    downloadICS("einkaufsplan-12monate.ics", events);
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

  const doneToggleBtn = (done, onClick) => (
    <button onClick={onClick} aria-label={done ? "als nicht erledigt markieren" : "als erledigt markieren"} style={{ background: "none", border: "none", cursor: "pointer", color: done ? "#5A7A5C" : "#C9BFA5", padding: 8, margin: -8, display: "flex" }}>
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
        .stamp-btn:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
          outline: 3px solid #C68B2C;
          outline-offset: 2px;
        }
        input, select { font-family: inherit; }
        @media (prefers-reduced-motion: reduce) { .stamp-btn { transition: none; } }
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
              <button onClick={() => setWeekOffset(o => o - 1)} aria-label="Vorherige Woche" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronLeft size={20} />
              </button>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16, color: "#F1ECE0" }}>
                {weekLabel}
              </span>
              <button onClick={() => setWeekOffset(o => o + 1)} aria-label="Nächste Woche" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronRight size={20} />
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              {weekOffset !== 0 ? (
                <button onClick={() => setWeekOffset(0)} style={{ background: "none", border: "none", color: "#6B7A6D", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                  zurück zur aktuellen Woche
                </button>
              ) : <span />}
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: doneCleaningCount === people.length ? "#5A7A5C" : "#8A8270" }}>
                {doneCleaningCount}/{people.length} erledigt
              </span>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {cleaningAssignments.map((a, i) => {
                const done = !!doneCleaning[i];
                return (
                  <div key={i} style={{ ...cardBase, opacity: done ? 0.55 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 500, textDecoration: done ? "line-through" : "none" }}>{a.person}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                      <span style={{ background: "#3E5C76", color: "#FFFDF8", fontFamily: "'Archivo Black', sans-serif", fontSize: 13, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                        {a.room}
                      </span>
                      {isAdmin ? doneToggleBtn(done, () => toggleCleaningDone(weekKey, i, done)) : (done && <CheckCircle2 size={20} color="#5A7A5C" />)}
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

        {/* ===================== EINKAUFSPLAN (monthly) ===================== */}
        {activeTab === "supply" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#20241F", borderRadius: 14, padding: "14px 16px", marginBottom: 8 }}>
              <button onClick={() => setMonthOffset(o => o - 1)} aria-label="Vorheriger Monat" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronLeft size={20} />
              </button>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 16, color: "#F1ECE0" }}>
                {monthLabel}
              </span>
              <button onClick={() => setMonthOffset(o => o + 1)} aria-label="Nächster Monat" style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#F1ECE0" }}>
                <ChevronRight size={20} />
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              {monthOffset !== 0 ? (
                <button onClick={() => setMonthOffset(0)} style={{ background: "none", border: "none", color: "#6B7A6D", fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                  zurück zum aktuellen Monat
                </button>
              ) : <span />}
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: doneSupplyCount === items.length ? "#5A7A5C" : "#8A8270" }}>
                {doneSupplyCount}/{items.length} erledigt
              </span>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {supplyAssignments.map((a, i) => {
                const done = !!doneSupply[i];
                return (
                  <div key={i} style={{ ...cardBase, opacity: done ? 0.55 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: done ? "line-through" : "none" }}>
                        {a.item}
                      </span>
                      {isAdmin && (
                        <button onClick={() => removeItem(i)} aria-label={`${a.item} entfernen`} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9BFA5", padding: 2 }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                      <span style={{ background: "#C68B2C", color: "#FFFDF8", fontFamily: "'Archivo Black', sans-serif", fontSize: 13, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                        {a.person}
                      </span>
                      {isAdmin ? doneToggleBtn(done, () => toggleSupplyDone(monthKey, i, done)) : (done && <CheckCircle2 size={20} color="#5A7A5C" />)}
                    </div>
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

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              <button onClick={exportSupplyMonth} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarPlus size={15} /> Diesen Monat in Kalender
              </button>
              <button onClick={() => exportSupplyRange(12)} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarPlus size={15} /> Nächste 12 Monate
              </button>
            </div>

            <button onClick={() => setShowSupplyHistory(v => !v)} style={{ ...toggleBtnStyle, marginBottom: 10 }}>
              <History size={14} /> Verlauf {showSupplyHistory ? "▲" : "▼"}
            </button>
            {showSupplyHistory && (
              <div style={{ display: "grid", gap: 8, marginBottom: 40 }}>
                {supplyHistory.map(h => (
                  <div key={h.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "8px 14px", fontSize: 13 }}>
                    <span>{h.label}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: h.done === h.total ? "#5A7A5C" : "#8A8270" }}>{h.done}/{h.total} erledigt</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===================== WG-TREFFEN ===================== */}
        {activeTab === "meeting" && (
          <>
            <div style={{ background: "#20241F", borderRadius: 14, padding: 18, marginBottom: 24, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 6 }}>
                  Wann?
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
              <div style={{ flex: 1, minWidth: 120 }}>
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
          Putzplan rotiert wöchentlich (Fr–So), Einkaufsplan monatlich — beides automatisch. Über die Kalender-Buttons
          lädt sich jeder eine .ics-Datei herunter und kann sie in Google Kalender, Apple Kalender o.ä. importieren.
          Neue Gegenstände oder Räume könnt ihr über "Vorschläge" einreichen.
        </p>
      </div>
    </div>
  );
}
