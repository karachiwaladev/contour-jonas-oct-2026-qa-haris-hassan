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

  // An entry is attributed to the person ("user") only when it carries this
  // private token, which the page's own UI (app.js) claims once at startup and
  // keeps in its closure. Anything else, including { actor: "user" }, is "api".
  // (Code driving the page's own buttons is still "user"; `automated` marks
  // browsers under automation. A client-side log can't stop code running in
  // the page from tampering; this keeps honest API callers attributed right.)
  let userToken = null;

  let dbPromise = null;
  let chain = Promise.resolve(); // serialises writes; flush() waits for it

  // Resolves with the connection, or null if the log can't be opened right
  // now; a failed open is forgotten, so the next write tries again.
  function openDb() {
    if (dbPromise) return dbPromise;
    const pending = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        resolve(null); // e.g. storage blocked: log nothing now, quietly
        return;
      }
      let gaveUp = false;
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => {
        const db = req.result;
        if (gaveUp) { db.close(); return; } // a late open after a block: don't leave it dangling
        db.onversionchange = () => { db.close(); if (dbPromise === pending) dbPromise = null; };
        resolve(db);
      };
      req.onerror = (e) => {
        if (e && e.preventDefault) e.preventDefault(); // keep it out of the console
        resolve(null);
      };
      // Another tab holds an older version: skip logging for now, try again later.
      req.onblocked = () => { gaveUp = true; resolve(null); };
    });
    dbPromise = pending;
    // A failed open is forgotten once it settles (not inside the executor,
    // which runs before the assignment above), so the next write retries.
    pending.then((db) => { if (!db && dbPromise === pending) dbPromise = null; });
    return pending;
  }

  // Run `work(store)` in one transaction; resolves with the request's result.
  // If the connection was closed under us (another tab upgraded or deleted the
  // log database), reopen once and retry.
  async function tx(mode, work, retried = false) {
    const opened = openDb();
    const db = await opened;
    if (!db) return undefined;
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode); // throws InvalidStateError on a closed connection
        const req = work(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        // The failed request's error is on the event; t.error is still null here.
        t.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); reject((e && e.target && e.target.error) || t.error || new Error("log write failed")); };
        t.onabort = () => reject(t.error);
      });
    } catch (err) {
      if (!retried && err && err.name === "InvalidStateError") {
        // Forget only the connection that failed; another call may already have reopened.
        if (dbPromise === opened) dbPromise = null;
        return tx(mode, work, true);
      }
      throw err;
    }
  }

  // Queue a write. Failures are swallowed: logging must never break the app.
  function enqueue(job) {
    chain = chain.then(job).catch(() => {});
    return chain;
  }

  // Add an entry and drop everything older than the newest MAX_ENTRIES, in one
  // range delete (ids only grow, so older entries have smaller ids).
  function addAndTrim(entry) {
    return tx("readwrite", (store) => {
      const add = store.add(entry);
      add.onsuccess = () => {
        if (add.result > MAX_ENTRIES) store.delete(IDBKeyRange.upperBound(add.result - MAX_ENTRIES));
      };
      return null;
    });
  }

  const text = (value, max) => String(value).slice(0, max);

  // Record one action. Fire-and-forget; call flush() to wait for it.
  // Action names are plain identifiers ("task.add"), never containing "@" or
  // ":", which the eval uses for actor and outcome qualifiers.
  const ACTION_RE = /^[a-z][a-z0-9_.]{0,63}$/;

  // A plain-data copy, so later edits by the caller can't change the entry.
  function copyChanges(changes) {
    try { return changes && typeof changes === "object" ? JSON.parse(JSON.stringify(changes)) : {}; } catch { return {}; }
  }

  function log({ action, actor = "api", taskId = null, changes = {}, outcome = "ok", error } = {}) {
    if (typeof action !== "string" || !ACTION_RE.test(action)) return;
    const entry = {
      ts: new Date().toISOString(),
      sessionId,
      seq: ++seq,
      actor: userToken !== null && actor === userToken ? "user" : "api",
      automated,
      action,
      taskId: Number.isInteger(taskId) ? taskId : null,
      changes: copyChanges(changes),
      outcome: outcome === "error" ? "error" : "ok",
    };
    if (error !== undefined) entry.error = text(error && error.message ? error.message : error, 200);
    if (testCase) entry.testCase = testCase;
    enqueue(() => addAndTrim(entry));
  }

  return {
    log,
    // For the page's own UI only: the first caller gets the token, later callers null.
    claimUserToken() {
      if (userToken !== null) return null;
      userToken = Object.freeze({});
      return userToken;
    },
    flush: () => chain,
    async all() {
      await chain;
      return (await tx("readonly", (s) => s.getAll())) || [];
    },
    // The newest `n` entries, newest first, without reading the whole log.
    async recent(n) {
      await chain;
      return (await tx("readonly", (s) => {
        const out = [];
        const req = s.openCursor(null, "prev");
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor || out.length >= n) return;
          out.push(cursor.value);
          cursor.continue();
        };
        return { get result() { return out; } }; // tx() resolves with .result after commit
      })) || [];
    },
    async count() {
      await chain;
      return (await tx("readonly", (s) => s.count())) || 0;
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
