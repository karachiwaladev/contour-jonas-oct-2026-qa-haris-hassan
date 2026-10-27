#!/usr/bin/env node
// Volume Vera (VERA-01..05): load and performance budgets. See ../test-cases.md.
// Each case has two checks: its correctness (row counts, counter text, console
// errors, log cap, tag options), which FAILs like any other check, and its
// time budget, a known weakness to watch (no virtualization) that is reported
// as FINDING when missed. Timings are headless Chrome on this machine.
//   node todo/tests/personas/volume-vera/run.js
const { runPersona, FILLER, WAIT_MS } = require("../lib");

// In the page: N v4 task records spread over `tags` distinct tags, a quarter done.
const records = (n, tags) => `Array.from({ length: ${n} }, (_, i) => ({
  title: "Task " + i, done: i % 4 === 0, createdAt: i + 1,
  due: i % 3 === 0 ? null : "2027-" + String(1 + (i % 12)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0"),
  tags: ["tag-" + String(i % ${tags}).padStart(3, "0")], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null,
  priority: ["high", "medium", "low"][i % 3] }))`;

// Init script: time from navigation start until #task-list holds N rows and that frame is painted.
const FIRST_RENDER = (n) => `if (location.pathname.endsWith("/index.html")) {
  const o = new MutationObserver(() => { const l = document.getElementById("task-list");
    if (l && l.children.length >= ${n}) { o.disconnect(); requestAnimationFrame(() => setTimeout(() => { window.__firstRender = performance.now(); }, 0)); } });
  o.observe(document, { childList: true, subtree: true });
}`;

const budget = (ms, limit, what) => [ms < limit, `${what} ${ms} ms (budget ${limit} ms)`, { show: true }];

runPersona({
  dir: __dirname, prefix: "VERA", findingIds: ["VERA-01", "VERA-02", "VERA-03", "VERA-04", "VERA-05"],
  async e2e({ ev, open, tag, kase, check, seed, consoleErrors, collect, b }) {
    let r;

    await kase("VERA-01", "first render of 2,000 tasks: time budget", async () => {
      await seed(4, records(2000, 20));
      const errorsBefore = consoleErrors.length;
      const script = await b.addInitScript(FIRST_RENDER(2000));
      try { await open(); } finally { await b.removeInitScript(script); }
      await tag("VERA-01");
      r = await ev(`const t0 = performance.now();
        while (window.__firstRender === undefined) { if (performance.now() - t0 > ${WAIT_MS}) throw new Error("timed out after ${WAIT_MS / 1000} s waiting for 2,000 rows"); await T.wait(20); }
        return { ms: Math.round(window.__firstRender), rows: document.querySelectorAll("#task-list .task").length, count: T.count() };`);
      const errs = consoleErrors.slice(errorsBefore);
      check("VERA-01", "first render of 2,000 tasks: correctness", r.rows === 2000 && r.count === "1500 of 2000 left" && errs.length === 0,
        `rows ${r.rows}, count "${r.count}", console errors ${errs.length}${errs.length ? ": " + errs.join(" | ") : ""}`, { strict: true });
      return budget(r.ms, 1500, "cold load to 2,000 rows painted (incl. DB open)");
    });

    await kase("VERA-02", "filter change latency at scale: time budget", async () => {
      await tag("VERA-02");
      r = await ev(`const active = await T.timed("#task-list", () => document.querySelector('#status-filter [data-status="active"]').click());
        const activeRows = T.titles().length;
        const s = document.getElementById("priority-filter");
        const high = await T.timed("#task-list", () => { s.value = "high"; s.dispatchEvent(new Event("change")); });
        const highRows = T.titles().length;
        s.value = ""; s.dispatchEvent(new Event("change")); await T.wait(); await T.status("all");
        return { active, activeRows, high, highRows };`);
      check("VERA-02", "filter change latency at scale: correctness", r.activeRows === 1500 && r.highRows === 500,
        `Active shows ${r.activeRows} rows (want 1500), Active + High ${r.highRows} (want 500)`, { strict: true });
      return [r.active < 500 && r.high < 500, `Active ${r.active} ms, High ${r.high} ms (budget 500 ms each)`, { show: true }];
    });

    await kase("VERA-04", "add a task into a large list: time budget", async () => {
      await tag("VERA-04");
      r = await ev(`const before = T.count(); const t0 = performance.now();
        await T.waitFor("#task-list", () => T.items("Vera new task").length > 0, () => {
          document.getElementById("task-title").value = "Vera new task"; document.getElementById("new-task").requestSubmit(); });
        await T.frame(); const ms = Math.round(performance.now() - t0); await TodoLog.flush();
        return { ms, before, after: T.count() };`);
      const [ob, tb] = (r.before.match(/\d+/g) || []).map(Number), [oa, ta] = (r.after.match(/\d+/g) || []).map(Number);
      check("VERA-04", "add a task into a large list: correctness", oa === ob + 1 && ta === tb + 1 && ta === 2001,
        `count "${r.before}" -> "${r.after}"`, { strict: true });
      return budget(r.ms, 1500, "add + re-render");
    });

    await kase("VERA-03", "many tags in the dropdown: time budget", async () => {
      await seed(4, records(2000, 300));
      await open();
      await tag("VERA-03");
      r = await ev(`const s = document.getElementById("tag-filter");
        const ms = await T.timed("#tag-filter", () => { render(); });
        s.focus(); s.click(); // "open" the dropdown
        const values = [...s.options].map(o => o.value).slice(1);
        return { ms, options: values.length, sorted: JSON.stringify(values) === JSON.stringify([...values].sort()) };`);
      check("VERA-03", "many tags in the dropdown: correctness", r.options === 300 && r.sorted,
        `${r.options} tag options (want 300), sorted ${r.sorted}`, { strict: true });
      return budget(r.ms, 500, "dropdown built after render() (includes reading 2,000 tasks)");
    });

    await kase("VERA-05", "log rollover stays bounded & cheap: time budget", async () => {
      await seed(4, []);
      await open();
      await tag("VERA-05");
      await collect();
      r = await ev(`for (let i = 0; i < 1000; i++) TodoLog.log({ action: "${FILLER}", changes: { n: i } }); await TodoLog.flush();
        const full = await TodoLog.count();
        for (let i = 0; i < 50; i++) { document.querySelector('#status-filter [data-status="' + (i % 2 ? "all" : "active") + '"]').click(); await T.wait(10); }
        await TodoLog.flush(); const total = await TodoLog.count();
        const a = document.getElementById("activity");
        const ms = await T.timed("#activity-list", () => { a.open = true; });
        const rows = [...document.querySelectorAll("#activity-list li")];
        const newest = (await TodoLog.recent(1))[0];
        return { full, total, ms, rows: rows.length, firstIsNewest: !!rows[0] && Number(rows[0].dataset.id) === newest.id,
          summary: document.getElementById("activity-summary").textContent };`);
      check("VERA-05", "log rollover stays bounded & cheap: correctness",
        r.full === 1000 && r.total === 1000 && r.rows === 50 && r.firstIsNewest && r.summary === "Activity log (1000)",
        `store ${r.full} then ${r.total} entries after 50 more actions (want 1000), panel ${r.rows} rows, newest first ${r.firstIsNewest}, "${r.summary}"`, { strict: true });
      return budget(r.ms, 500, "panel renders newest 50 rows in");
    });
  },
});
