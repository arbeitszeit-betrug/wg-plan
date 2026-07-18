import React, { useState, useEffect } from "react";
import { ref, onValue, set as dbSet } from "firebase/database";
import { db } from "./firebase";
import { Plus, X, Copy, Check, ChevronLeft, ChevronRight, Package, Sparkles, CalendarPlus } from "lucide-react";

const DEFAULT_PEOPLE = ["Hannes", "Mareike", "Mirko"];
const DEFAULT_ITEMS = ["Klopapier", "WC-Reiniger", "Spülmittel", "Müllbeutel"];
const DEFAULT_ROOMS = ["Küche", "Flur", "Bad"];
const CONFIG_PATH = "wg-plan-config";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

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

export default function WGPlan() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [copiedSupply, setCopiedSupply] = useState(false);
  const [copiedCleaning, setCopiedCleaning] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [editingPeople, setEditingPeople] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Live-Sync: hört auf Firebase und übernimmt Änderungen anderer Mitbewohner:innen
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

  const save = async (next) => {
    setConfig(next);
    try {
      await dbSet(ref(db, CONFIG_PATH), next);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
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
  const { label: monthLabel } = monthIndexFromStart(startMonth, monthOffset);
  const supplyAssignments = items.map((item, i) => {
    const personIdx = (monthOffset + i) % people.length;
    return { item, person: people[personIdx] };
  });

  // Cleaning rotation (weekly, Fri-Sun)
  const fridayDate = addDays(anchorFriday, weekOffset * 7);
  const sundayDate = addDays(anchorFriday, weekOffset * 7 + 2);
  const weekLabel = `${WEEKDAY_SHORT[5]} ${fmtDDMM(fridayDate)}–${WEEKDAY_SHORT[0]} ${fmtDDMMYYYY(sundayDate)}`;
  // Cleaning rotation (weekly, Fri-Sun) — people stay in fixed order, rooms rotate underneath them
  const cleaningAssignments = people.map((person, p) => {
    const n = rooms.length;
    const roomIdx = ((((p - weekOffset) % n) + n) % n);
    return { person, room: rooms[roomIdx], roomIdx };
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

  const supplyText = () => {
    const lines = [`🧻 WG-Einkaufsplan – ${monthLabel}`, ""];
    supplyAssignments.forEach(a => lines.push(`• ${a.item}: ${a.person}`));
    lines.push("", "Bitte rechtzeitig besorgen, danke! 🙏");
    return lines.join("\n");
  };

  const cleaningText = () => {
    const lines = [`🧹 Wochenputz – ${weekLabel}`, ""];
    cleaningAssignments.forEach(a => lines.push(`• ${a.person}: ${a.room}`));
    lines.push("", "Bis Sonntag erledigen, danke! 🧽");
    return lines.join("\n");
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

  const copy = async (text, setFlag) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlag(true);
      setTimeout(() => setFlag(false), 2000);
    } catch (e) { /* noop */ }
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
        .stamp-btn:focus-visible, button:focus-visible, input:focus-visible {
          outline: 3px solid #C68B2C;
          outline-offset: 2px;
        }
        input { font-family: inherit; }
        @media (prefers-reduced-motion: reduce) { .stamp-btn { transition: none; } }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Package size={22} color="#C68B2C" strokeWidth={2.5} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B7A6D", fontWeight: 600 }}>
            WG-Plan
          </span>
        </div>
        <h1 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: "clamp(28px, 6vw, 42px)", margin: "6px 0 32px", lineHeight: 1.05 }}>
          Wer macht was?
        </h1>

        {/* ===================== PUTZPLAN (weekly) ===================== */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="#3E5C76" />
          <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, margin: 0 }}>Wochenputz</h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#20241F", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
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
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} style={{ background: "none", border: "none", color: "#6B7A6D", fontSize: 13, marginBottom: 16, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            zurück zur aktuellen Woche
          </button>
        )}

        <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          {cleaningAssignments.map((a, i) => (
            <div key={i} style={cardBase}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{a.person}</span>
              </div>
              <span style={{ background: "#3E5C76", color: "#FFFDF8", fontFamily: "'Archivo Black', sans-serif", fontSize: 13, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                {a.room}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {rooms.map((room, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 999, padding: "6px 10px 6px 14px", fontSize: 13 }}>
              {room}
              <button onClick={() => removeRoom(i)} aria-label={`${room} entfernen`} style={{ background: "none", border: "none", cursor: "pointer", color: "#8A8270", padding: 0, display: "flex" }}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRoom()}
            placeholder="Neuer Raum (z.B. Balkon)"
            style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1.5px solid #DDD6C4", background: "#FFFFFF", fontSize: 15 }}
          />
          <button onClick={addRoom} className="stamp-btn" style={{ background: "#3E5C76", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Plus size={18} />
          </button>
        </div>

        <div style={{ background: "#20241F", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 10 }}>
            Für WhatsApp
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#F1ECE0", lineHeight: 1.6, margin: "0 0 14px" }}>
            {cleaningText()}
          </pre>
          <button onClick={() => copy(cleaningText(), setCopiedCleaning)} className="stamp-btn" style={{ background: copiedCleaning ? "#5A7A5C" : "#3E5C76", color: "#FFFDF8", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            {copiedCleaning ? <Check size={16} /> : <Copy size={16} />}
            {copiedCleaning ? "Kopiert!" : "Text kopieren"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 40 }}>
          <button onClick={exportCleaningWeek} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <CalendarPlus size={15} /> Diese Woche in Kalender
          </button>
          <button onClick={() => exportCleaningRange(12)} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <CalendarPlus size={15} /> Nächste 12 Wochen
          </button>
        </div>

        {/* ===================== EINKAUFSPLAN (monthly) ===================== */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Package size={18} color="#C68B2C" />
          <h2 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, margin: 0 }}>Einkauf / Vorrat</h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#20241F", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
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
        {monthOffset !== 0 && (
          <button onClick={() => setMonthOffset(0)} style={{ background: "none", border: "none", color: "#6B7A6D", fontSize: 13, marginBottom: 16, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            zurück zum aktuellen Monat
          </button>
        )}

        <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          {supplyAssignments.map((a, i) => (
            <div key={i} style={cardBase}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#B9AF97", fontWeight: 600, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.item}
                </span>
                <button onClick={() => removeItem(i)} aria-label={`${a.item} entfernen`} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9BFA5", padding: 2 }}>
                  <X size={14} />
                </button>
              </div>
              <span style={{ background: "#C68B2C", color: "#FFFDF8", fontFamily: "'Archivo Black', sans-serif", fontSize: 13, padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                {a.person}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="Neuer Gegenstand (z.B. Küchenrolle)"
            style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1.5px solid #DDD6C4", background: "#FFFFFF", fontSize: 15 }}
          />
          <button onClick={addItem} className="stamp-btn" style={{ background: "#34404A", color: "#F1ECE0", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Plus size={18} />
          </button>
        </div>

        <div style={{ background: "#20241F", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9AA69C", marginBottom: 10 }}>
            Für WhatsApp
          </div>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#F1ECE0", lineHeight: 1.6, margin: "0 0 14px" }}>
            {supplyText()}
          </pre>
          <button onClick={() => copy(supplyText(), setCopiedSupply)} className="stamp-btn" style={{ background: copiedSupply ? "#5A7A5C" : "#C68B2C", color: "#FFFDF8", border: "none", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            {copiedSupply ? <Check size={16} /> : <Copy size={16} />}
            {copiedSupply ? "Kopiert!" : "Text kopieren"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
          <button onClick={exportSupplyMonth} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <CalendarPlus size={15} /> Diesen Monat in Kalender
          </button>
          <button onClick={() => exportSupplyRange(12)} className="stamp-btn" style={{ background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <CalendarPlus size={15} /> Nächste 12 Monate
          </button>
        </div>

        {/* Combined copy */}
        <button
          onClick={() => copy(`${cleaningText()}\n\n---\n\n${supplyText()}`, setCopiedAll)}
          className="stamp-btn"
          style={{ width: "100%", background: "#FFFFFF", border: "1.5px solid #DDD6C4", borderRadius: 10, padding: "12px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 32 }}
        >
          {copiedAll ? <Check size={16} /> : <Copy size={16} />}
          {copiedAll ? "Beides kopiert!" : "Beides zusammen kopieren"}
        </button>

        {/* People editor */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setEditingPeople(v => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B7A6D", fontWeight: 600, marginBottom: 10 }}
          >
            Mitbewohner:innen bearbeiten {editingPeople ? "▲" : "▼"}
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

        {saveError && (
          <p style={{ color: "#A5453B", fontSize: 13, marginTop: 8 }}>
            Änderungen konnten nicht gespeichert werden. Bitte nochmal versuchen.
          </p>
        )}

        <p style={{ fontSize: 12, color: "#9A9280", marginTop: 20, lineHeight: 1.6 }}>
          Die Liste wird geteilt gespeichert — öffnet jede:r Mitbewohner:in diesen Link, sieht er/sie denselben Stand.
          Putzplan rotiert wöchentlich (Fr–So), Einkaufsplan monatlich — beides automatisch. Über die Kalender-Buttons
          lädt sich jede:r eine .ics-Datei herunter und kann sie in Google Kalender, Apple Kalender o.ä. importieren.
        </p>
      </div>
    </div>
  );
}
