#!/usr/bin/env node
// Legacy Larry (LARRY-01..05): upgrading v1/v2/v3 data to v4. See ../test-cases.md.
//   node todo/tests/personas/legacy-larry/run.js
const { runPersona } = require("../lib");

const ymd = (o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const HOLDER = `if (location.pathname.endsWith("/index.html")) {
  const q = indexedDB.open("todo-app", 3); q.onsuccess = () => { window.__holder = q.result; };
}`;
const v3 = (title, extra = {}) => ({ title, done: false, createdAt: 1, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, ...extra });

runPersona({
  dir: __dirname, prefix: "LARRY",
  async e2e({ ev, open, tag, kase, seed, b }) {
    let r;

    await kase("LARRY-01", "v1 data migrates to v4 with no loss", async () => {
      await seed(1, [{ title: "Old one", done: false, createdAt: 1 }, { title: "Old two", done: true, createdAt: 2 }, { title: "Old three", done: false, createdAt: 3 }]);
      await open();
      await tag("LARRY-01");
      r = await ev(`const raw = await T.raw(); return { v: raw.v, records: raw.records.map(({ id, createdAt, ...rest }) => rest), titles: T.titles().sort() };`);
      const want = (title, done) => ({ title, done, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, priority: "medium" });
      const exp = [want("Old one", false), want("Old two", true), want("Old three", false)];
      return [r.v === 4 && JSON.stringify(r.records) === JSON.stringify(exp) && JSON.stringify(r.titles) === '["Old one","Old three","Old two"]', r];
    });

    await kase("LARRY-02", "v2 data migrates (due + tags kept)", async () => {
      const due = ymd(4);
      await seed(2, [{ title: "Dated", done: false, createdAt: 1, due, tags: ["work", "q3"] }, { title: "Plain", done: false, createdAt: 2, due: null, tags: [] }]);
      await open();
      await tag("LARRY-02");
      r = await ev(`const raw = await T.raw(); const rec = raw.records.find(x => x.title === "Dated");
        const row = T.items("Dated")[0];
        return { v: raw.v, due: rec.due, tags: rec.tags, repeat: rec.repeat, priority: rec.priority, anchor: rec.anchorDay,
          repeatBadges: document.querySelectorAll("#task-list .repeat").length, prio: row.querySelector(".priority").textContent,
          chips: [...row.querySelectorAll(".chip")].map(c => c.textContent), n: raw.records.length };`);
      return [r.v === 4 && r.n === 2 && r.due === due && JSON.stringify(r.tags) === '["work","q3"]' && r.repeat === "none" && r.priority === "medium" &&
        r.anchor === Number(due.slice(8)) && r.repeatBadges === 0 && r.prio === "Medium" && JSON.stringify(r.chips) === '["#work","#q3"]', r];
    });

    await kase("LARRY-03", "v3 data gets default priority", async () => {
      const seeded = [v3("Weekly review", { due: ymd(2), tags: ["home"], repeat: "weekly", anchorDay: Number(ymd(2).slice(8)), createdAt: 1 }),
        v3("Done thing", { done: true, createdAt: 2 })];
      await seed(3, seeded);
      await open();
      await tag("LARRY-03");
      r = await ev(`return (await T.raw()).records;`);
      const same = r.length === 2 && r.every((rec, i) => { const { id, priority, ...rest } = rec; return priority === "medium" && JSON.stringify(rest) === JSON.stringify(seeded[i]); });
      return [same, r];
    });

    await kase("LARRY-04", "count/sort correct after migration", async () => {
      await seed(2, [
        { title: "A soon", done: false, createdAt: 1, due: ymd(2), tags: [] },
        { title: "B undated old", done: false, createdAt: 2, due: null, tags: [] },
        { title: "C overdue", done: false, createdAt: 3, due: ymd(-1), tags: [] },
        { title: "D done", done: true, createdAt: 4, due: ymd(0), tags: [] },
        { title: "E undated new", done: false, createdAt: 5, due: null, tags: [] },
        { title: "F done new", done: true, createdAt: 6, due: null, tags: [] },
      ]);
      await open();
      await tag("LARRY-04");
      r = await ev(`return { titles: T.titles(), count: T.count() };`);
      return [JSON.stringify(r.titles) === JSON.stringify(["C overdue", "A soon", "E undated new", "B undated old", "F done new", "D done"]) && r.count === "4 of 6 left", r];
    });

    await kase("LARRY-05", "older tab open: safe, explained block", async () => {
      const seeded = [v3("Keep me 1", { createdAt: 1 }), v3("Keep me 2", { createdAt: 2, tags: ["x"] })];
      await seed(3, seeded);
      const script = await b.addInitScript(HOLDER);
      try {
        await open();
        await tag("LARRY-05");
        r = await ev(`await T.wait(200); const box = document.getElementById("error");
          const res = { held: !!window.__holder, box: box.hidden ? null : box.textContent, during: T.titles() };
          window.__holder.close(); await T.wait(300); await render(); await T.wait(100);
          const raw = await T.raw(); res.after = T.titles().sort(); res.v = raw.v; res.n = raw.records.length; res.boxAfter = box.hidden ? null : box.textContent;
          return res;`);
      } finally { await b.removeInitScript(script); }
      return [r.held && /being upgraded/.test(r.box || "") && /[Cc]lose other tabs/.test(r.box || "") && r.during.length === 0 &&
        JSON.stringify(r.after) === '["Keep me 1","Keep me 2"]' && r.v === 4 && r.n === 2 && r.boxAfter === null, r];
    });
  },
});
