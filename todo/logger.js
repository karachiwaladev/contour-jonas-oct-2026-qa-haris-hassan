// Action log for the todo app: records what a person ("user", through the page)
// or a script/AI ("api", direct TodoDB calls) did, in its own IndexedDB
// database ("todo-logs"), separate from the tasks so logging can never put
// task data at risk. Entries hold ids, action names and changed fields only,
// never task titles or tag text. Logging is best-effort: if it can't store,
// it stays quiet and the app carries on.
//
// Entry: { id, ts, sessionId, seq, actor, automated, action, taskId,
//          changes, outcome, error?, testCase? }

const TodoLog = (() => {
  const DB_NAME = "todo-logs";
  const STORE = "entries";
  const MAX_ENTRIES = 1000;
  const TEST_CASE_KEY = "todo-log-test-case";
  const TEST_CASE_RE = /^TC-\d{1,4}$/;

  const sessionId = (self.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const automated = navigator.webdriver === true;
  let seq = 0;
  let testCase = null;
  try {
    const saved = sessionStorage.getItem(TEST_CASE_KEY);
    if (saved && TEST_CASE_RE.test(saved)) testCase = saved;
  } catch {}

  let dbPromise = null;
  let unavailable = false;
  let chain = Promise.resolve(); // serialises writes; flush() waits for it

  function openDb() {
    if (unavailable) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        let req;
        try {
          req = indexedDB.open(DB_NAME, 1);
        } catch {
          unavailable = true; // e.g. storage blocked: log nothing, quietly
          resolve(null);
          return;
        }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { db.close(); dbPromise = null; };
          resolve(db);
        };
        req.onerror = (e) => {
          if (e && e.preventDefault) e.preventDefault(); // keep it out of the console
          unavailable = true;
          resolve(null);
        };
        req.onblocked = () => { dbPromise = null; resolve(null); };
      });
    }
    return dbPromise;
  }

  // Run `work(store)` in one transaction; resolves with the request's result.
  async function tx(mode, work) {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = work(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); reject(t.error); };
      t.onabort = () => reject(t.error);
    });
  }

  // Queue a write. Failures are swallowed: logging must never break the app.
  function enqueue(job) {
    chain = chain.then(job).catch(() => {});
    return chain;
  }

  function addAndTrim(entry) {
    return tx("readwrite", (store) => {
      store.add(entry);
      const countReq = store.count();
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ENTRIES;
        if (excess <= 0) return;
        store.openCursor().onsuccess = (e) => { // oldest first (ascending ids)
          const cursor = e.target.result;
          if (!cursor || excess <= 0) return;
          cursor.delete();
          excess--;
          cursor.continue();
        };
      };
      return null;
    });
  }

  const text = (value, max) => String(value).slice(0, max);

  // Record one action. Fire-and-forget; call flush() to wait for it.
  function log({ action, actor = "api", taskId = null, changes = {}, outcome = "ok", error } = {}) {
    if (typeof action !== "string" || !action) return;
    const entry = {
      ts: new Date().toISOString(),
      sessionId,
      seq: ++seq,
      actor: actor === "user" ? "user" : "api",
      automated,
      action: text(action, 64),
      taskId: Number.isInteger(taskId) ? taskId : null,
      changes: changes && typeof changes === "object" ? changes : {},
      outcome: outcome === "error" ? "error" : "ok",
    };
    if (error !== undefined) entry.error = text(error && error.message ? error.message : error, 200);
    if (testCase) entry.testCase = testCase;
    enqueue(() => addAndTrim(entry));
  }

  return {
    log,
    flush: () => chain,
    async all() {
      await chain;
      return (await tx("readonly", (s) => s.getAll())) || [];
    },
    async exportJSONL() {
      return (await this.all()).map((e) => JSON.stringify(e)).join("\n");
    },
    // Empty the log. Unless silent, the clear itself is recorded.
    clear({ actor = "api", silent = false } = {}) {
      enqueue(() => tx("readwrite", (s) => s.clear()));
      if (!silent) log({ action: "log.clear", actor });
      return chain;
    },
    // Tag later entries with a test case ("TC-12"), for evals. null stops it.
    // Survives reloads within the tab (sessionStorage). Returns false if rejected.
    setTestCase(id) {
      if (id === null) {
        testCase = null;
        try { sessionStorage.removeItem(TEST_CASE_KEY); } catch {}
        return true;
      }
      if (typeof id !== "string" || !TEST_CASE_RE.test(id)) return false;
      testCase = id;
      try { sessionStorage.setItem(TEST_CASE_KEY, id); } catch {}
      log({ action: "test.case_start", actor: "api" });
      return true;
    },
    get testCase() { return testCase; },
  };
})();
