// Client-side database for the todo app, backed by IndexedDB.
// Every call returns a Promise. A task looks like:
//   { id: number, title: string, done: boolean, createdAt: number,
//     due: "YYYY-MM-DD" | null, tags: string[],
//     repeat: "none" | "daily" | "weekly" | "monthly", anchorDay: number | null,
//     spawnedFrom?: number, nextId?: number | null }
// Needs recurrence.js (window.Recurrence) to be loaded first.

const TodoDB = (() => {
  const DB_NAME = "todo-app";
  const DB_VERSION = 3;
  const STORE = "tasks";
  const R = Recurrence;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
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
            cursor.update(task);
            cursor.continue();
          };
        };
        let gaveUp = false;
        // Another tab still has an older version open: fail clearly instead of
        // waiting forever, and let the next call try again.
        req.onblocked = () => {
          gaveUp = true;
          if (dbPromise === pending) dbPromise = null;
          reject(new Error("The todo database is being upgraded. Close other tabs with this app open, then reload."));
        };
        req.onsuccess = () => {
          const db = req.result;
          if (gaveUp) { db.close(); return; } // a late open after we gave up: don't leave it dangling
          // Another tab (or devtools) is upgrading or deleting the database:
          // close, and forget this connection so the next call reopens.
          db.onversionchange = () => {
            db.close();
            if (dbPromise === pending) dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          if (dbPromise === pending) dbPromise = null;
          reject(req.error);
        };
      });
      const pending = dbPromise;
    }
    return dbPromise;
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
      createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : 0,
      anchorDay: R.clampAnchor(task.anchorDay),
      nextId: idOrNull(task.nextId),
      spawnedFrom: idOrNull(task.spawnedFrom),
    };
  }

  return {
    normalizeTags,
    all: async () => (await run("readonly", (s) => s.getAll())).map(clean),
    get: async (id) => {
      const t = await run("readonly", (s) => s.get(id));
      return t ? clean(t) : t;
    },
    add(title, { due = null, tags = [], repeat = "none" } = {}) {
      const kind = R.normalizeRepeat(repeat);
      let date = R.isValidDate(due) ? due : null;
      if (kind !== "none" && !date) date = R.today(); // a series needs a start date
      return run("readwrite", (s) =>
        s.add({
          title, done: false, createdAt: Date.now(), due: date, tags: normalizeTags(tags),
          repeat: kind, anchorDay: R.dayOf(date),
        })
      );
    },

    // Complete or reopen a task, in one transaction (concurrent calls can't
    // make two copies).
    // - Completing a recurring occurrence creates the next one, at most once
    //   per occurrence: once `nextId` is set, the series has moved past it.
    // - Reopening removes that copy only if it's untouched (still open, same
    //   repeat, no copy of its own). Otherwise the copy is kept and the reopened
    //   occurrence becomes a one-off (`repeat: "none"`), so there is never a
    //   second live series and what the UI shows matches what will happen.
    setDone(id, done) {
      return run("readwrite", (store) => {
        store.get(id).onsuccess = (e) => {
          const raw = e.target.result;
          if (!raw || (raw.done === true) === done) return; // missing or already in that state
          const c = clean(raw);

          if (done) {
            if (c.repeat === "none" || c.nextId !== null) {
              store.put({ ...raw, done: true });
              return;
            }
            const anchorDay = c.anchorDay ?? R.dayOf(c.due) ?? R.dayOf(R.today());
            const next = {
              title: c.title, done: false, createdAt: Date.now(),
              due: R.nextDue(c.due, c.repeat, anchorDay, R.today()),
              tags: c.tags, repeat: c.repeat, anchorDay, spawnedFrom: raw.id, nextId: null,
            };
            store.add(next).onsuccess = (ev) => store.put({ ...raw, done: true, nextId: ev.target.result });
            return;
          }

          if (c.nextId === null) {
            store.put({ ...raw, done: false });
            return;
          }
          store.get(c.nextId).onsuccess = (ev) => {
            const copy = ev.target.result;
            // Untouched: still open, still repeating the same way, and it hasn't
            // spawned a copy of its own. Only then is undo just "take it back".
            const untouched = !!copy && copy.done !== true && copy.spawnedFrom === raw.id &&
              R.normalizeRepeat(copy.repeat) === c.repeat && idOrNull(copy.nextId) === null;
            if (untouched) {
              store.delete(c.nextId);
              store.put({ ...raw, done: false, nextId: null });
            } else {
              // The series has moved on (the copy was completed, stopped, deleted
              // or has its own copy), so the reopened occurrence becomes a plain
              // one-off task: no badge, and nothing recurs from it.
              store.put({ ...raw, done: false, repeat: "none" });
            }
          };
        };
      });
    },

    // End a series: the task stays, but no longer repeats.
    stopRepeating(id) {
      return run("readwrite", (store) => {
        store.get(id).onsuccess = (e) => {
          if (e.target.result) store.put({ ...e.target.result, repeat: "none" });
        };
      });
    },

    remove: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
