// Client-side database for the todo app, backed by IndexedDB.
// Every call returns a Promise. A task looks like:
//   { id: number, title: string, done: boolean, createdAt: number }

const TodoDB = (() => {
  const DB_NAME = "todo-app";
  const DB_VERSION = 1;
  const STORE = "tasks";
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
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

  return {
    all: () => run("readonly", (s) => s.getAll()),
    get: (id) => run("readonly", (s) => s.get(id)),
    add: (title) =>
      run("readwrite", (s) => s.add({ title, done: false, createdAt: Date.now() })),
    async setDone(id, done) {
      const task = await this.get(id);
      if (!task) return;
      task.done = done;
      await run("readwrite", (s) => s.put(task));
    },
    remove: (id) => run("readwrite", (s) => s.delete(id)),
  };
})();
