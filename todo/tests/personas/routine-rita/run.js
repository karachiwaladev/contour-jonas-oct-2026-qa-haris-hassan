#!/usr/bin/env node
// Routine Rita (RITA-01..07): recurring chores. RITA-04 is a Node unit test. See ../test-cases.md.
//   node todo/tests/personas/routine-rita/run.js
const path = require("path");
const { runPersona } = require("../lib");

runPersona({
  dir: __dirname, prefix: "RITA",
  unit({ check }) {
    const R = require(path.join(__dirname, "..", "..", "..", "recurrence.js"));
    const feb = R.nextDue("2027-01-31", "monthly", 31, "2027-01-01");
    const mar = R.nextDue(feb, "monthly", 31, "2027-02-01");
    check("RITA-04", "monthly month-end clamping", feb === "2027-02-28" && mar === "2027-03-31", `got ${feb}, ${mar}`);
  },
  async e2e({ ev, open, tag, kase }) {
    let r;
    await open();

    await kase("RITA-01", "daily chore spawns next on completion", async () => {
      const id = await ev(`return await T.add("Water plants", { due: T.ymd(0), repeat: "daily" });`);
      await tag("RITA-01");
      r = await ev(`await T.tick(${id}); const all = (await TodoDB.all()).filter(t => t.title === "Water plants");
        const copy = all.find(t => !t.done); const row = copy && T.item(copy.id);
        return { n: all.length, origDone: (await T.get(${id})).done, origRow: T.item(${id}).classList.contains("done"),
          copyDue: copy && copy.due, exp: T.ymd(1), badge: row && (row.querySelector(".repeat") || {}).textContent };`);
      return [r.n === 2 && r.origDone && r.origRow && r.copyDue === r.exp && r.badge === "🔁 Daily", r];
    });

    await kase("RITA-02", "repeat with no due starts today", async () => {
      await ev(`await T.reset();`);
      await tag("RITA-02");
      r = await ev(`const id = await T.add("Stretch", { repeat: "daily" }); const row = T.item(id);
        return { due: (await T.get(id)).due, today: T.ymd(0), badge: (row.querySelector(".due") || {}).textContent, rep: (row.querySelector(".repeat") || {}).textContent };`);
      return [r.due === r.today && r.badge === "Due today" && r.rep === "🔁 Daily", r];
    });

    await kase("RITA-03", "missed occurrences skipped", async () => {
      await ev(`await T.reset();`);
      await tag("RITA-03");
      r = await ev(`const id = await T.add("Journal", { due: T.ymd(-5), repeat: "daily" }); await T.tick(id);
        const open = (await TodoDB.all()).filter(t => !t.done); return { open: open.map(t => t.due), today: T.ymd(0) };`);
      return [r.open.length === 1 && r.open[0] === r.today, r];
    });

    await kase("RITA-05", "stop repeating ends the series", async () => {
      const id = await ev(`await T.reset(); return await T.add("Vitamins", { due: T.ymd(0), repeat: "daily" });`);
      await tag("RITA-05");
      r = await ev(`T.item(${id}).querySelector(".stop-repeat").click(); await T.wait(); await TodoLog.flush();
        const row = T.item(${id}); const res = { badge: !!row.querySelector(".repeat"), stop: !!row.querySelector(".stop-repeat"), repeat: (await T.get(${id})).repeat };
        await T.tick(${id}); res.total = (await TodoDB.all()).length; res.done = (await T.get(${id})).done; return res;`);
      return [!r.badge && !r.stop && r.repeat === "none" && r.total === 1 && r.done, r];
    });

    await kase("RITA-06", "undo an accidental completion", async () => {
      const id = await ev(`await T.reset(); const id = await T.add("Feed cat", { due: T.ymd(0), repeat: "daily" }); await T.tick(id); return id;`);
      await tag("RITA-06");
      r = await ev(`const copyId = (await TodoDB.all()).find(t => !t.done).id; await T.tick(${id});
        const all = await TodoDB.all(); return { copyGone: !all.some(t => t.id === copyId), orig: all.find(t => t.id === ${id}), open: all.filter(t => !t.done).length };`);
      return [r.copyGone && r.orig && r.orig.done === false && r.orig.repeat === "daily" && r.open === 1, r];
    });

    await kase("RITA-07", "reopening after the series moved on becomes a one-off", async () => {
      const a = await ev(`await T.reset(); const a = await T.add("Run", { due: T.ymd(0), repeat: "daily" }); await T.tick(a);
        const b = (await TodoDB.all()).find(t => !t.done).id; await T.tick(b); return a;`);
      await tag("RITA-07");
      r = await ev(`await T.tick(${a}); const A = await T.get(${a}); const badge = !!T.item(${a}).querySelector(".repeat");
        await T.tick(${a}); const all = await TodoDB.all();
        return { repeat: A.repeat, wasOpen: A.done === false, badge, total: all.length, reDone: all.find(t => t.id === ${a}).done };`);
      return [r.repeat === "none" && r.wasOpen && !r.badge && r.total === 3 && r.reDone, r];
    });
  },
});
