#!/usr/bin/env node
// Bot Bob (BOB-01..06): automation, attribution, eval syntax, log cap. BOB-04 is a Node unit test. See ../test-cases.md.
//   node todo/tests/personas/bot-bob/run.js
const path = require("path");
const { runPersona, FILLER } = require("../lib");

runPersona({
  dir: __dirname, prefix: "BOB",
  unit({ kase }) {
    return kase("BOB-04", "eval syntax: success and :error", async () => {
      const E = require(path.join(__dirname, "..", "..", "eval", "eval-logs.js"));
      const spec = "| ID | Auto |\n|----|------|\n| FIX-01 | e2e |\n";
      const entry = (outcome, actor) => JSON.stringify({ action: "task.add", outcome, actor, testCase: "FIX-01" });
      const status = (log, need) => E.evaluate({ logText: log, specText: spec, expected: { "FIX-01": need } }).cases[0].status;
      const r = {
        okUser_addUser: status(entry("ok", "user"), ["task.add@user"]),          // pass
        okUser_addError: status(entry("ok", "user"), ["task.add:error"]),        // :error needs a failure
        errUser_addUser: status(entry("error", "user"), ["task.add@user"]),      // a failure is not a success
        errUser_addError: status(entry("error", "user"), ["task.add:error"]),    // pass
        okApi_addUser: status(entry("ok", "api"), ["task.add@user"]),            // actor qualifier enforced
        okApi_add: status(entry("ok", "api"), ["task.add"]),                     // pass (no actor named)
        errUnexpected: status(entry("ok", "user") + "\n" + entry("error", "user"), ["task.add@user"]), // unexpected failure
      };
      const exp = { okUser_addUser: "pass", okUser_addError: "incomplete", errUser_addUser: "incomplete", errUser_addError: "pass",
        okApi_addUser: "incomplete", okApi_add: "pass", errUnexpected: "unexpected-error" };
      return [JSON.stringify(r) === JSON.stringify(exp), r];
    });
  },
  async e2e({ ev, open, tag, kase, collect }) {
    let r;
    await open();

    await kase("BOB-01", "direct API calls logged as api", async () => {
      await tag("BOB-01");
      r = await ev(`const id = await TodoDB.add("Bot task", {}); await TodoDB.setDone(id, true); await render();
        const pid = await T.add("Page task"); await T.tick(pid);
        const es = (await T.entries("BOB-01")).filter(e => e.action.startsWith("task."));
        return es.map(e => e.action + "#" + (e.taskId === id ? "bot" : e.taskId === pid ? "page" : e.taskId) + "@" + e.actor);`);
      return [JSON.stringify(r) === JSON.stringify(["task.add#bot@api", "task.complete#bot@api", "task.add#page@user", "task.complete#page@user"]), r];
    });

    await kase("BOB-02", "automation flag set", async () => {
      await ev(`await T.reset();`);
      await tag("BOB-02");
      r = await ev(`await T.add("Automated"); await TodoDB.add("Automated too", {});
        const es = (await T.entries("BOB-02")).filter(e => e.action === "task.add");
        return { webdriver: navigator.webdriver, flags: es.map(e => e.actor + ":" + e.automated) };`);
      return [r.webdriver === true && r.flags.length === 2 && r.flags.every((f) => f.endsWith(":true")), r];
    });

    await kase("BOB-03", "add corrects, update rejects", async () => {
      await ev(`await T.reset();`);
      await tag("BOB-03");
      r = await ev(`const id = await TodoDB.add("x", { priority: "urgent", repeat: "yearly" }); const added = await T.get(id);
        let rejected = null; try { await TodoDB.update(id, { priority: "urgent" }); } catch (e) { rejected = e.message; }
        await TodoLog.flush(); const after = await T.get(id);
        const errs = (await T.entries("BOB-03")).filter(e => e.action === "task.edit" && e.outcome === "error").map(e => e.actor);
        return { priority: added.priority, repeat: added.repeat, rejected, unchanged: after.priority === "medium", errs };`);
      return [r.priority === "medium" && r.repeat === "none" && /Unknown priority/.test(r.rejected || "") && r.unchanged && JSON.stringify(r.errs) === '["api"]', r];
    });

    await kase("BOB-06", "spawned copies keep attribution & priority", async () => {
      const id = await ev(`await T.reset(); return await TodoDB.add("Meds", { priority: "high", repeat: "daily", due: T.ymd(0) });`);
      await tag("BOB-06");
      r = await ev(`await TodoDB.setDone(${id}, true); await TodoLog.flush(); const copy = (await TodoDB.all()).find(t => !t.done);
        const es = (await T.entries("BOB-06")).filter(e => e.action.startsWith("task."));
        return { log: es.map(e => e.action + "@" + e.actor), copyPriority: copy && copy.priority, spawnedFrom: copy && copy.spawnedFrom === ${id} };`);
      return [JSON.stringify(r.log) === '["task.complete@api","task.spawn@api"]' && r.copyPriority === "high" && r.spawnedFrom, r];
    });

    // Last: it fills the log with filler entries (left out of run-log.jsonl).
    await kase("BOB-05", "1,000-entry log cap", async () => {
      await ev(`await T.reset();`);
      await tag("BOB-05");
      await collect();
      r = await ev(`await TodoLog.clear({ silent: true });
        for (let i = 0; i < 1005; i++) TodoLog.log({ action: "${FILLER}", changes: { n: i } });
        await TodoLog.flush(); const all = await TodoLog.all(); const ns = all.map(e => e.changes.n);
        return { total: all.length, count: await TodoLog.count(), first: Math.min(...ns), last: Math.max(...ns) };`);
      return [r.total === 1000 && r.count === 1000 && r.first === 5 && r.last === 1004, r];
    });
  },
});
