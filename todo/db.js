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
            cursor.update(task);
            cursor.continue();
          };
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Run one request in a transaction and resolve with its result.
  async function run(mode, makeRequest) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = makeRequest(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // "Work, work , URGENT," → ["work", "urgent"]
  function normalizeTags(input) {
    const list = Array.isArray(input) ? input : String(input || "").split(",");
    const seen = new Set();
    for (const raw of list) {
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

    // Complete or reopen a task. Completing a recurring task also creates its
    // next occurrence, in the same transaction, so concurrent calls can't make
    // two copies; reopening removes that copy again if it's still open.
    async setDone(id, done) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.get(id).onsuccess = (e) => {
          const raw = e.target.result;
          if (!raw || (raw.done === true) === done) return; // missing or already in that state
          const task = { ...raw, done };
          const repeat = R.normalizeRepeat(raw.repeat);

          if (done && repeat !== "none") {
            const c = clean(raw);
            const next = {
              title: c.title, done: false, createdAt: Date.now(),
              due: R.nextDue(c.due, repeat, raw.anchorDay, R.today()),
              tags: c.tags, repeat, anchorDay: raw.anchorDay ?? R.dayOf(c.due), spawnedFrom: raw.id,
            };
            store.add(next).onsuccess = (ev) => store.put({ ...task, nextId: ev.target.result });
          } else if (!done && raw.nextId != null) {
            store.get(raw.nextId).onsuccess = (ev) => {
              const copy = ev.target.result;
              if (copy && !copy.done && copy.spawnedFrom === raw.id) store.delete(raw.nextId);
            };
            store.put({ ...task, nextId: null });
          } else {
            store.put(task);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },

    // End a series: the task stays, but no longer repeats.
    async stopRepeating(id) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.get(id).onsuccess = (e) => {
          if (e.target.result) store.put({ ...e.target.result, repeat: "none" });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    remove: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
