// Client-side database for the todo app, backed by IndexedDB.
// Every call returns a Promise. A task looks like:
//   { id: number, title: string, done: boolean, createdAt: number,
//     due: "YYYY-MM-DD" | null, tags: string[],
//     repeat: "none" | "daily" | "weekly" | "monthly", anchorDay: number | null,
//     priority: "high" | "medium" | "low",
//     spawnedFrom?: number, nextId?: number | null }
// Needs recurrence.js (window.Recurrence) to be loaded first.

const TodoDB = (() => {
  const DB_NAME = "todo-app";
  const DB_VERSION = 4;
  const STORE = "tasks";
  const PRIORITIES = ["high", "medium", "low"];
  const normalizePriority = (p) => (PRIORITIES.includes(p) ? p : "medium");
  const MAX_TITLE = 200;

  // One title rule for add and edit: trimmed, not empty, at most MAX_TITLE.
  function checkTitle(title) {
    const t = typeof title === "string" ? title.trim() : "";
    if (!t) throw new Error("The title can't be empty.");
    if (t.length > MAX_TITLE) throw new Error(`The title can be at most ${MAX_TITLE} characters.`);
    return t;
  }
  const R = Recurrence;
  const BLOCKED_MESSAGE = "The todo database is being upgraded. Close other tabs with this app open, then reload.";
  let dbPromise = null;   // the open connection (or the open in progress)
  let blockedError = null; // set while a blocked upgrade request is still pending

  // Make `db` the connection in use. If another tab (or devtools) upgrades or
  // deletes the database, close it and forget it, so the next call reopens.
  function adopt(db) {
    const settled = Promise.resolve(db);
    db.onversionchange = () => {
      db.close();
      if (dbPromise === settled) dbPromise = null;
    };
    dbPromise = settled;
  }

  function open() {
    // While a blocked upgrade is pending, a new request would queue behind it
    // and hang, so fail at once with the same clear message.
    if (blockedError) return Promise.reject(blockedError);
    if (dbPromise) return dbPromise;

    const pending = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION); // a synchronous throw rejects `pending`
      req.onupgradeneeded = (event) => {
        const old = event.oldVersion;
        if (old < 1) {
          req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          return;
        }
        // v1/v2 → v3: fill in new fields in place; never drop data.
        req.transaction.objectStore(STORE).openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const task = cursor.value;
          if (task.due === undefined) task.due = null;
          if (!Array.isArray(task.tags)) task.tags = [];
          if (task.repeat === undefined) task.repeat = "none";
          if (task.anchorDay === undefined) task.anchorDay = R.dayOf(task.due);
          if (task.nextId === undefined) task.nextId = null;
          if (task.spawnedFrom === undefined) task.spawnedFrom = null;
          if (task.priority === undefined) task.priority = "medium"; // v4
          cursor.update(task);
          cursor.continue();
        };
      };
      // Another tab still has an older version open: fail clearly instead of
      // waiting. If the other tab closes later, this request still succeeds,
      // and that connection is used from then on.
      req.onblocked = () => {
        blockedError = new Error(BLOCKED_MESSAGE);
        reject(blockedError);
      };
      req.onsuccess = () => {
        blockedError = null;
        adopt(req.result);
        resolve(req.result); // no-op if we already gave up on this request
      };
      req.onerror = () => {
        blockedError = null;
        reject(req.error);
      };
    });

    dbPromise = pending;
    // Any failure (a throw, an error, a block) is forgotten, so the next call retries.
    pending.catch(() => {
      if (dbPromise === pending) dbPromise = null;
    });
    return pending;
  }

  // Run `work(store)` in one transaction. Resolves when the transaction commits,
  // with the result of the request `work` returns (if any); rejects on error or abort.
  async function run(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      // A failed request's error event bubbles here before the abort, while
      // tx.error is still null, so take the error from the event itself.
      tx.onerror = (e) => reject(e.target.error || tx.error || new Error("IndexedDB request failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }

  const idOrNull = (value) => (Number.isInteger(value) ? value : null);

  // "Work, work , URGENT," → ["work", "urgent"]
  function normalizeTags(input) {
    const list = Array.isArray(input) ? input : String(input || "").split(",");
    const seen = new Set();
    for (const raw of list) {
      // Only text (and finite numbers, kept as text) can be a tag; null,
      // objects, arrays and booleans in tampered storage are dropped.
      if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) continue;
      const tag = String(raw).trim().toLowerCase().slice(0, 30);
      if (tag) seen.add(tag);
    }
    return [...seen];
  }

  // Stored data is untrusted (old versions, devtools edits): coerce every
  // field to its expected type before the UI sees it.
  function clean(task) {
    return {
      ...task,
      title: String(task.title ?? ""),
      done: task.done === true,
      due: R.isValidDate(task.due) ? task.due : null,
      tags: normalizeTags(Array.isArray(task.tags) ? task.tags : []),
      repeat: R.normalizeRepeat(task.repeat),
      priority: normalizePriority(task.priority),
      createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : 0,
      anchorDay: R.clampAnchor(task.anchorDay),
      nextId: idOrNull(task.nextId),
      spawnedFrom: idOrNull(task.spawnedFrom),
    };
  }

  // An Error marked as already logged, so the UI layer doesn't log it again.
  // Non-Error rejections and frozen errors can't carry the mark, so they are
  // wrapped (the original stays as `cause`).
  function markLogged(err) {
    let e = err;
    if (!(e instanceof Error) || !Object.isExtensible(e)) {
      e = new Error(err && err.message ? err.message : String(err));
      e.cause = err;
    }
    e.logged = true;
    return e;
  }

  // Run a change and record it in the action log (TodoLog, if loaded).
  // `work(events)` fills `events` from inside the transaction; they are logged
  // only after it commits. A failure is logged once with outcome "error".
  // `meta` is passed to the log as the actor: only the page UI's private token
  // (TodoLog.claimUserToken) makes an entry "user"; anything else is "api".
  async function logged(meta, failure, work) {
    const log = typeof TodoLog !== "undefined" ? TodoLog.log : () => {};
    const events = [];
    try {
      const result = await work(events);
      for (const ev of events) log({ ...ev, actor: meta });
      return result;
    } catch (err) {
      log({ ...failure, actor: meta, outcome: "error", error: err });
      throw markLogged(err);
    }
  }

  return {
    normalizeTags,
    // The page UI's token comes from the log (see logger.js); this alias keeps
    // one place to ask. The first caller gets it, later callers null.
    claimUserToken: () => (typeof TodoLog !== "undefined" ? TodoLog.claimUserToken() : null),
    all: async () => (await run("readonly", (s) => s.getAll())).map(clean),
    add(title, { due = null, tags = [], repeat = "none", priority = "medium" } = {}, meta) {
      const kind = R.normalizeRepeat(repeat);
      let date = R.isValidDate(due) ? due : null;
      if (kind !== "none" && !date) date = R.today(); // a series needs a start date
      const cleanTags = normalizeTags(tags);
      const prio = normalizePriority(priority);
      return logged(meta, { action: "task.add" }, async (events) => {
        const cleanTitle = checkTitle(title);
        const id = await run("readwrite", (s) =>
          s.add({
            title: cleanTitle, done: false, createdAt: Date.now(), due: date, tags: cleanTags,
            repeat: kind, anchorDay: R.dayOf(date), priority: prio,
          })
        );
        // No title or tag text in the log: only what kind of task it is.
        events.push({ action: "task.add", taskId: id,
          changes: { done: false, repeat: kind, due: date, tags: cleanTags.length, priority: prio } });
        return id;
      });
    },

    // Edit an open task. `fields` may hold title, due, tags, repeat, priority;
    // each is validated like on add, and anything invalid rejects the whole
    // edit (nothing is stored). It rejects if the task was completed or
    // deleted meanwhile. Choosing a repeat with no due date starts it today; a
    // new due date or repeat resets the monthly anchor to the due date's day.
    // An edited task is marked `edited`, so undoing its parent never deletes
    // it. The log records which fields changed (and the new due/repeat/
    // priority, a tag count), never the title or tag text.
    update(id, fields = {}, meta) {
      return logged(meta, { action: "task.edit", taskId: id }, async (events) => {
        const want = {};
        if ("title" in fields) {
          const title = typeof fields.title === "string" ? fields.title.trim() : "";
          if (!title) throw new Error("The title can't be empty.");
          want.title = title; // the length rule applies only if the title changes (legacy long titles stay editable)
        }
        if ("due" in fields) {
          if (fields.due === null || fields.due === "") want.due = null;
          else if (R.isValidDate(fields.due)) want.due = fields.due;
          else throw new Error("That due date isn't a real date.");
        }
        if ("repeat" in fields) {
          if (!R.REPEATS.includes(fields.repeat)) throw new Error("Unknown repeat.");
          want.repeat = fields.repeat;
        }
        if ("priority" in fields) {
          if (!PRIORITIES.includes(fields.priority)) throw new Error("Unknown priority.");
          want.priority = fields.priority;
        }
        if ("tags" in fields) want.tags = normalizeTags(fields.tags);

        let problem = null; // found inside the transaction; thrown once it ends (nothing was stored)
        await run("readwrite", (store) => {
          store.get(id).onsuccess = (e) => {
            const raw = e.target.result;
            if (!raw || raw.done === true) { problem = "This task was completed or deleted."; return; }
            const c = clean(raw);
            const next = { ...c, ...want };
            if (next.repeat !== "none" && !next.due) next.due = R.today(); // a series needs a start date
            const changed = ["title", "due", "tags", "repeat", "priority"]
              .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(c[k]));
            if (!changed.length) return;
            if (changed.includes("title") && next.title.length > MAX_TITLE) {
              problem = `The title can be at most ${MAX_TITLE} characters.`;
              return;
            }
            if (changed.includes("due") || changed.includes("repeat")) next.anchorDay = R.dayOf(next.due);
            store.put({ ...raw, title: next.title, due: next.due, tags: next.tags, repeat: next.repeat,
              priority: next.priority, anchorDay: next.anchorDay, edited: true });
            const log = { fields: changed };
            for (const k of ["due", "repeat", "priority"]) if (changed.includes(k)) log[k] = next[k];
            if (changed.includes("tags")) log.tags = next.tags.length;
            events.push({ action: "task.edit", taskId: id, changes: log });
          };
        });
        if (problem) throw new Error(problem);
      });
    },

    // Complete or reopen a task, in one transaction (concurrent calls can't
    // make two copies).
    // - Completing a recurring occurrence creates the next one, at most once
    //   per occurrence: once `nextId` is set, the series has moved past it.
    // - Reopening removes that copy only if it's untouched (still open, same
    //   repeat, no copy of its own). Otherwise the copy is kept and the reopened
    //   occurrence becomes a one-off (`repeat: "none"`), so there is never a
    //   second live series and what the UI shows matches what will happen.
    setDone(id, done, meta) {
      return logged(meta, { action: done ? "task.complete" : "task.reopen", taskId: id }, (events) =>
        run("readwrite", (store) => {
          store.get(id).onsuccess = (e) => {
            const raw = e.target.result;
            if (!raw || (raw.done === true) === done) return; // missing or already in that state
            const c = clean(raw);

            if (done) {
              events.push({ action: "task.complete", taskId: raw.id, changes: { done: true } });
              if (c.repeat === "none" || c.nextId !== null) {
                store.put({ ...raw, done: true });
                return;
              }
              const anchorDay = c.anchorDay ?? R.dayOf(c.due) ?? R.dayOf(R.today());
              const next = {
                title: c.title, done: false, createdAt: Date.now(),
                due: R.nextDue(c.due, c.repeat, anchorDay, R.today()),
                tags: c.tags, repeat: c.repeat, anchorDay, spawnedFrom: raw.id, nextId: null, priority: c.priority,
              };
              store.add(next).onsuccess = (ev) => {
                events.push({ action: "task.spawn", taskId: ev.target.result,
                  changes: { due: next.due, repeat: next.repeat, spawnedFrom: raw.id } });
                store.put({ ...raw, done: true, nextId: ev.target.result });
              };
              return;
            }

            events.push({ action: "task.reopen", taskId: raw.id, changes: { done: false } });
            if (c.nextId === null) {
              store.put({ ...raw, done: false });
              return;
            }
            store.get(c.nextId).onsuccess = (ev) => {
              const copy = ev.target.result;
              // Untouched: still open, still repeating the same way, and it hasn't
              // spawned a copy of its own. Only then is undo just "take it back".
              const untouched = c.repeat !== "none" && !!copy && copy.done !== true &&
                copy.spawnedFrom === raw.id && R.normalizeRepeat(copy.repeat) === c.repeat &&
                idOrNull(copy.nextId) === null && copy.edited !== true; // an edited copy is the user's, never discarded
              if (untouched) {
                store.delete(c.nextId);
                store.put({ ...raw, done: false, nextId: null });
                events.push({ action: "task.copy_removed", taskId: c.nextId, changes: { spawnedFrom: raw.id } });
              } else {
                // The series has moved on (the copy was completed, stopped, deleted
                // or has its own copy), so the reopened occurrence becomes a plain
                // one-off task: no badge, nothing recurs from it, and its link to
                // the copy is cut so a later undo can never touch that task.
                store.put({ ...raw, done: false, repeat: "none", nextId: null });
                events.push({ action: "task.become_oneoff", taskId: raw.id, changes: { repeat: "none" } });
              }
            };
          };
        })
      );
    },

    // End a series: the task stays, but no longer repeats.
    stopRepeating(id, meta) {
      return logged(meta, { action: "task.stop_repeating", taskId: id }, (events) =>
        run("readwrite", (store) => {
          store.get(id).onsuccess = (e) => {
            const raw = e.target.result;
            if (!raw || R.normalizeRepeat(raw.repeat) === "none") return; // nothing to stop: no change, no log
            store.put({ ...raw, repeat: "none" });
            events.push({ action: "task.stop_repeating", taskId: id, changes: { repeat: "none" } });
          };
        })
      );
    },

    // Deleting a task that isn't there succeeds in IndexedDB but logs nothing.
    remove(id, meta) {
      return logged(meta, { action: "task.delete", taskId: id }, (events) =>
        run("readwrite", (store) => {
          store.get(id).onsuccess = (e) => {
            if (!e.target.result) return;
            store.delete(id);
            events.push({ action: "task.delete", taskId: id, changes: {} });
          };
        })
      );
    },
  };
})();
