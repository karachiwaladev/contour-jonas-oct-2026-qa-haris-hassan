// Client-side database for the todo app, backed by IndexedDB.
// Every call returns a Promise. A task looks like:
//   { id: number, title: string, done: boolean, createdAt: number,
//     due: "YYYY-MM-DD" | null, tags: string[] }

const TodoDB = (() => {
  const DB_NAME = "todo-app";
  const DB_VERSION = 2;
  const STORE = "tasks";
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
          const old = event.oldVersion;
          if (old < 1) {
            req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          }
          if (old >= 1 && old < 2) {
            // v1 → v2: add due/tags to existing tasks in place; never drop data.
            req.transaction.objectStore(STORE).openCursor().onsuccess = (e) => {
              const cursor = e.target.result;
              if (!cursor) return;
              const task = cursor.value;
              if (task.due === undefined) task.due = null;
              if (!Array.isArray(task.tags)) task.tags = [];
              cursor.update(task);
              cursor.continue();
            };
          }
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
      const tag = raw.trim().toLowerCase().slice(0, 30);
      if (tag) seen.add(tag);
    }
    return [...seen];
  }

  return {
    normalizeTags,
    all: () => run("readonly", (s) => s.getAll()),
    get: (id) => run("readonly", (s) => s.get(id)),
    add: (title, { due = null, tags = [] } = {}) =>
      run("readwrite", (s) =>
        s.add({ title, done: false, createdAt: Date.now(), due: due || null, tags: normalizeTags(tags) })
      ),
    async setDone(id, done) {
      const task = await this.get(id);
      if (!task) return;
      task.done = done;
      await run("readwrite", (s) => s.put(task));
    },
    remove: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
