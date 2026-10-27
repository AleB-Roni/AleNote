// iCal (.ics) lesen: Termine aus Google-, Outlook- oder Apple-Kalender-Abos.
// Unterstützt ganztägige und zeitgebundene Termine, Zeitzonen (TZID), Wiederholungen (RRULE:
// täglich/wöchentlich/monatlich/jährlich mit INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY) und Ausnahmen (EXDATE).

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Zeilen entfalten und in { name, params, value } zerlegen */
function parseLines(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  return raw.filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    if (i < 0) return null;
    const [name, ...params] = line.slice(0, i).split(';');
    const p = {};
    for (const x of params) { const [k, v] = x.split('='); if (k) p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
    return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
  }).filter(Boolean);
}

const unescape = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Versatz einer Zeitzone (ms) zu einem UTC-Zeitpunkt */
function tzOffset(tz, utcMs) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch { return null; }
}

// Windows-Zeitzonennamen (Outlook) → IANA
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'Central Europe Standard Time': 'Europe/Budapest', 'E. Europe Standard Time': 'Europe/Bucharest', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', 'UTC': 'UTC' };

/** iCal-Datum → { date: Date, allDay } */
export function parseDate(value, params = {}) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh || params.VALUE === 'DATE') return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const guess = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0));
  if (z) return { date: new Date(guess), allDay: false, utc: true };
  const tz = params.TZID && (WIN_TZ[params.TZID] || params.TZID);
  if (tz) {
    let off = tzOffset(tz, guess);
    if (off != null) { off = tzOffset(tz, guess - off) ?? off; return { date: new Date(guess - off), allDay: false }; }
  }
  return { date: new Date(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)), allDay: false }; // „schwebende“ Ortszeit
}

function parseDuration(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  return (sign === '-' ? -1 : 1) * ((+w || 0) * 7 * 864e5 + (+d || 0) * 864e5 + (+h || 0) * 36e5 + (+mi || 0) * 6e4 + (+s || 0) * 1e3);
}

/** .ics-Text → Liste von Termin-Definitionen */
export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const l of parseLines(text)) {
    if (l.name === 'BEGIN' && l.value === 'VEVENT') { cur = { exdates: [] }; continue; }
    if (l.name === 'END' && l.value === 'VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    switch (l.name) {
      case 'UID': cur.uid = l.value; break;
      case 'SUMMARY': cur.title = unescape(l.value); break;
      case 'LOCATION': cur.location = unescape(l.value); break;
      case 'DESCRIPTION': cur.description = unescape(l.value).slice(0, 2000); break;
      case 'STATUS': cur.status = l.value; break;
      case 'DTSTART': { const r = parseDate(l.value, l.params); if (r) { cur.start = r.date; cur.allDay = r.allDay; cur.utc = !!r.utc; } break; }
      case 'DTEND': { const r = parseDate(l.value, l.params); if (r) cur.end = r.date; break; }
      case 'DURATION': cur.duration = parseDuration(l.value); break;
      case 'RRULE': cur.rrule = Object.fromEntries(l.value.split(';').map((x) => x.split('=')).map(([k, v]) => [k.toUpperCase(), v])); break;
      case 'EXDATE': for (const v of l.value.split(',')) { const r = parseDate(v, l.params); if (r) cur.exdates.push(r.date.getTime()); } break;
      case 'RECURRENCE-ID': { const r = parseDate(l.value, l.params); if (r) cur.recurrenceId = r.date.getTime(); break; }
    }
  }
  for (const e of events) {
    if (!e.end) e.end = new Date(e.start.getTime() + (e.duration || (e.allDay ? 864e5 : 36e5)));
    e.title ||= '(Ohne Titel)';
  }
  return events.filter((e) => e.status !== 'CANCELLED');
}

/** Wiederholungen im Zeitraum [from, to) ausrollen → [{ ...event, start, end }] */
export function expandEvents(events, from, to) {
  const out = [];
  // Geänderte Einzeltermine (RECURRENCE-ID) ersetzen das Original
  const overrides = new Map();
  for (const e of events) if (e.recurrenceId) overrides.set(e.uid + '@' + e.recurrenceId, e);
  const push = (e, start) => {
    const len = e.end - e.start;
    const s = new Date(start), en = new Date(start + len);
    if (en > from && s < to) out.push({ ...e, start: s, end: en });
  };
  for (const e of events) {
    if (e.recurrenceId) { push(e, e.start.getTime()); continue; }
    const r = e.rrule;
    if (!r) { push(e, e.start.getTime()); continue; }
    const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
    const until = r.UNTIL ? parseDate(r.UNTIL)?.date?.getTime() + (r.UNTIL.length === 8 ? 864e5 - 1 : 0) : Infinity;
    const count = r.COUNT ? +r.COUNT : Infinity;
    const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, day: DAYS.indexOf(m[2]) } : null; }).filter(Boolean) : null;
    const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
    const s0 = e.start;
    // In UTC definierte Serien bleiben in UTC (sonst verschiebt die Sommerzeit die Uhrzeit)
    const U = e.utc;
    const Y = (d) => (U ? d.getUTCFullYear() : d.getFullYear()), M = (d) => (U ? d.getUTCMonth() : d.getMonth()), D = (d) => (U ? d.getUTCDate() : d.getDate()), WD = (d) => (U ? d.getUTCDay() : d.getDay());
    const h = U ? s0.getUTCHours() : s0.getHours(), mi = U ? s0.getUTCMinutes() : s0.getMinutes(), sec = U ? s0.getUTCSeconds() : s0.getSeconds();
    let n = 0, guard = 0;
    const emit = (d) => {
      const t = d.getTime();
      if (t < s0.getTime() || t > until || n >= count) return false;
      n++;
      const key = e.uid + '@' + t;
      if (!e.exdates.includes(t) && !overrides.has(key)) push(e, t);
      return true;
    };
    const at = (y, m, d) => (U ? new Date(Date.UTC(y, m, d, h, mi, sec)) : new Date(y, m, d, h, mi, sec));
    const dayOf = (y, m, d) => (U ? new Date(Date.UTC(y, m, d)).getUTCDay() : new Date(y, m, d).getDay());
    if (freq === 'DAILY') {
      for (let d = new Date(s0); d.getTime() <= until && n < count && d < to && guard++ < 5000; d = at(Y(d), M(d), D(d) + interval)) emit(d);
    } else if (freq === 'WEEKLY') {
      const days = byDay?.length ? byDay.map((x) => x.day).sort() : [WD(s0)];
      const weekStart = at(Y(s0), M(s0), D(s0) - WD(s0));
      for (let w = weekStart; w.getTime() <= until && n < count && w < to && guard++ < 3000; w = at(Y(w), M(w), D(w) + 7 * interval)) {
        for (const dd of days) emit(at(Y(w), M(w), D(w) + dd));
      }
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const step = freq === 'MONTHLY' ? interval : 12 * interval;
      const months = freq === 'YEARLY' && r.BYMONTH ? r.BYMONTH.split(',').map((x) => +x - 1) : null;
      for (let k = 0; guard++ < 2000; k += step) {
        const base = U ? new Date(Date.UTC(Y(s0), M(s0) + k, 1)) : new Date(Y(s0), M(s0) + k, 1);
        if (base.getTime() > until || base > to || n >= count) break;
        for (const month of months || [M(base)]) {
          const y = Y(base);
          const dim = new Date(y, month + 1, 0).getDate();
          let dates = [];
          if (byDay?.length) {
            for (const { n: nth, day } of byDay) {
              const all = [];
              for (let d = 1; d <= dim; d++) if (dayOf(y, month, d) === day) all.push(d);
              if (!nth) dates.push(...all); else dates.push(nth > 0 ? all[nth - 1] : all[all.length + nth]);
            }
          } else if (byMonthDay?.length) dates = byMonthDay.map((d) => (d < 0 ? dim + d + 1 : d));
          else dates = [D(s0)];
          for (const d of dates.filter((x) => x && x <= dim).sort((a, b) => a - b)) emit(at(y, month, d));
        }
      }
    } else push(e, s0.getTime());
  }
  return out.sort((a, b) => a.start - b.start);
}
