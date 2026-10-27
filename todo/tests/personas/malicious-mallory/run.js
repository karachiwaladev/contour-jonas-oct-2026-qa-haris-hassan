#!/usr/bin/env node
// Malicious Mallory (MAL-01..05): XSS payloads, tampered storage, forged actor. See ../test-cases.md.
//   node todo/tests/personas/malicious-mallory/run.js
const { runPersona } = require("../lib");

const base = { done: false, createdAt: 1, due: null, tags: [], repeat: "none", anchorDay: null, nextId: null, spawnedFrom: null, priority: "medium" };

runPersona({
  dir: __dirname, prefix: "MAL",
  async e2e({ ev, open, tag, kase, seed, consoleErrors }) {
    let r;
    await open();

    await kase("MAL-01", "script payload in title renders as text", async () => {
      await tag("MAL-01");
      r = await ev(`const title = "<img src=x onerror=window.pwned=1>"; const id = await T.add(title, { tags: "<b>x</b>" }); await T.wait(200);
        const li = T.item(id);
        return { shown: li.querySelector(".title").textContent === title, chip: li.querySelector(".chip").textContent,
          img: document.querySelectorAll("#task-list img, #tag-filter img").length, bold: document.querySelectorAll("#task-list b, #tag-filter b").length,
          option: [...document.getElementById("tag-filter").options].map(o => o.textContent), pwned: window.pwned === undefined ? "unset" : window.pwned };`);
      return [r.shown && r.chip === "#<b>x</b>" && r.img === 0 && r.bold === 0 && r.option.includes("#<b>x</b> (1)") && r.pwned === "unset", r];
    });

    await kase("MAL-02", "payload survives as text through edit", async () => {
      const id = await ev(`await T.reset(); return await T.add("Normal task");`);
      await tag("MAL-02");
      r = await ev(`const p = "<script>window.pwned=1</script>"; await T.edit(${id}, { title: p }); await T.wait(200);
        return { shown: T.item(${id}).querySelector(".title").textContent === p, stored: (await T.get(${id})).title === p,
          scripts: document.querySelectorAll("#task-list script").length, pwned: window.pwned === undefined ? "unset" : window.pwned };`);
      return [r.shown && r.stored && r.scripts === 0 && r.pwned === "unset", r];
    });

    await kase("MAL-03", "tampered stored fields coerced on read", async () => {
      await seed(4, [
        { ...base, title: "Bad fields", createdAt: 1, repeat: "<img src=x onerror=window.pwned=1>", due: "2026-13-45", anchorDay: -5, priority: "urgent" },
        { ...base, title: "Bad anchor", createdAt: 2, repeat: "yearly", due: "not-a-date", anchorDay: 99, priority: { evil: true } },
      ]);
      const before = consoleErrors.length;
      await open();
      await tag("MAL-03");
      r = await ev(`const all = await TodoDB.all(); const by = t => all.find(x => x.title === t); const a = by("Bad fields"), b = by("Bad anchor");
        return { a: { repeat: a.repeat, due: a.due, anchor: a.anchorDay, priority: a.priority }, b: { repeat: b.repeat, due: b.due, anchor: b.anchorDay, priority: b.priority },
          rows: T.titles().length, badges: document.querySelectorAll("#task-list .due, #task-list .repeat").length,
          classes: [...document.querySelectorAll("#task-list .priority")].map(e => e.className), pwned: window.pwned === undefined ? "unset" : window.pwned };`);
      r.consoleErrors = consoleErrors.slice(before);
      return [r.rows === 2 && r.badges === 0 && r.pwned === "unset" && r.consoleErrors.length === 0 &&
        JSON.stringify(r.a) === '{"repeat":"none","due":null,"anchor":null,"priority":"medium"}' &&
        JSON.stringify(r.b) === '{"repeat":"none","due":null,"anchor":31,"priority":"medium"}' &&
        r.classes.every((c) => c === "priority medium"), r];
    });

    await kase("MAL-04", "forged {actor:\"user\"} without token is api", async () => {
      const id = await ev(`await T.reset(); return await T.add("Target");`);
      await tag("MAL-04");
      r = await ev(`await TodoDB.remove(${id}, { actor: "user" }); TodoLog.log({ action: "task.delete", actor: "user" }); await TodoLog.flush();
        const dels = (await T.entries("MAL-04")).filter(e => e.action === "task.delete");
        return { actors: dels.map(e => e.actor), token: TodoLog.claimUserToken(), dbToken: TodoDB.claimUserToken() };`);
      return [JSON.stringify(r.actors) === '["api","api"]' && r.token === null && r.dbToken === null, r];
    });

    await kase("MAL-05", "tampered tag array dropped safely", async () => {
      await seed(4, [{ ...base, title: "Odd tags", tags: [null, {}, 5, "ok", true, ["x"]] }]);
      await open();
      await tag("MAL-05");
      r = await ev(`return [...document.querySelectorAll("#task-list .chip")].map(c => c.textContent);`);
      return [JSON.stringify(r) === '["#5","#ok"]', r];
    });
  },
});
