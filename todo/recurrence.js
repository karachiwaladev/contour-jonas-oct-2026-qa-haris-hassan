// Recurrence rules for the todo app: pure date math, no DOM and no storage.
// Loaded as a classic script in the browser (window.Recurrence) and with
// require() from the Node tests. Dates are local calendar days, "YYYY-MM-DD".

(function (root) {
  const REPEATS = ["none", "daily", "weekly", "monthly"];
  const LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

  // Allowlist: anything else (tampered storage, old data) means "none".
  function normalizeRepeat(value) {
    return typeof value === "string" && REPEATS.includes(value) ? value : "none";
  }

  // "YYYY-MM-DD" → { y, m, d } for a real calendar date, otherwise null.
  function parse(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? { y, m, d } : null;
  }

  const isValidDate = (s) => parse(s) !== null;
  const pad = (n) => String(n).padStart(2, "0");
  const format = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  const dayNumber = (p) => Date.UTC(p.y, p.m - 1, p.d) / 86400000;
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function addDaysParts(p, n) {
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  // `k` months after p, on the anchor day clamped to that month's last day
  // (anchor 31: Jan 31 → Feb 28/29 → Mar 31, never drifting to the 28th).
  function addMonths(p, k, anchor) {
    const total = p.y * 12 + (p.m - 1) + k;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    return { y, m, d: Math.min(anchor, daysInMonth(y, m)) };
  }

  // A day-of-month anchor: 1–31 (above 31 clamps to 31), or null for anything
  // else (non-numbers, booleans, 0, negatives), so callers fall back to the
  // due date's own day rather than drifting to the 1st.
  function clampAnchor(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(31, n) : null;
  }

  // Today's local date as "YYYY-MM-DD".
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // The due date of the occurrence after `due`, skipping any that are already
  // in the past: the result is the first occurrence on or after `todayStr`.
  // Returns null for a non-repeating task. An invalid `due` counts from today.
  function nextDue(due, repeat, anchorDay, todayStr) {
    const kind = normalizeRepeat(repeat);
    if (kind === "none") return null;
    const t = parse(todayStr) || parse(today());
    const cur = parse(due) || t;

    if (kind === "daily") {
      const next = addDaysParts(cur, 1);
      return format(dayNumber(next) < dayNumber(t) ? t : next);
    }
    if (kind === "weekly") {
      const behind = dayNumber(t) - dayNumber(cur);
      const weeks = behind > 7 ? Math.ceil(behind / 7) : 1;
      return format(addDaysParts(cur, 7 * weeks));
    }
    // monthly
    const anchor = clampAnchor(anchorDay) || cur.d;
    let next = addMonths(cur, 1, anchor);
    if (dayNumber(next) < dayNumber(t)) {
      // Far behind: jump straight to the month before today's, then step at
      // most twice. There is no cap, so any past date catches up.
      const behind = (t.y - cur.y) * 12 + (t.m - cur.m) - 1;
      if (behind > 1) next = addMonths(cur, behind, anchor);
      while (dayNumber(next) < dayNumber(t)) next = addMonths(next, 1, anchor);
    }
    return format(next);
  }

  // "YYYY-MM-DD" `n` days after `ymd`, or null if `ymd` isn't a real date.
  const addDaysYmd = (ymd, n) => { const p = parse(ymd); return p ? format(addDaysParts(p, n)) : null; };

  const api = { REPEATS, LABELS, normalizeRepeat, isValidDate, nextDue, today, clampAnchor, addDays: addDaysYmd,
    dayOf: (s) => (parse(s) || {}).d || null };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Recurrence = api;
})(typeof window !== "undefined" ? window : globalThis);
