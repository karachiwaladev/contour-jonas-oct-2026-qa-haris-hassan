# Todo app

A simple todo app. You can create a task, mark it done and delete it (Ticket #3, issue #4). Tasks can also have an optional due date and tags, and you can filter by status and by tag (Ticket #4, issue #5). Tasks can **repeat** daily, weekly or monthly (Ticket #5, issue #7). Every action is recorded in an **activity log** that distinguishes a person from scripts and AI agents, and test runs are checked against it by an **eval** (issue #14). Tasks are stored in the browser with **IndexedDB**: there is no server or build step, and nothing else to install.

## Run

Open `todo/index.html` in a browser, or serve the folder with `python -m http.server 8765 --directory todo`. Tasks persist across reloads in that browser profile.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup; loads `recurrence.js`, `logger.js`, `db.js` and then `app.js` as classic scripts, so it works from `file://` |
| `logger.js` | `TodoLog`: the action log in its own IndexedDB database `todo-logs` (`log`, `all`, `recent`, `count`, `exportJSONL`, `clear`, `setTestCase`, `flush`, `claimUserToken`). It keeps the last 1,000 entries and is best-effort, so it never breaks the app. |
| `recurrence.js` | `Recurrence`: pure date math (`nextDue`, `normalizeRepeat`, `isValidDate`, `today`). It also loads in Node for unit tests. |
| `db.js` | `TodoDB`: an IndexedDB wrapper (`all`, `add(title, {due, tags, repeat})`, `setDone`, `stopRepeating`, `remove`, `normalizeTags`). Changes pass their last argument through to the log as the actor. It cleans up stored records when reading them, and logs each change after it commits. |
| `app.js` | UI: rendering, the add form, the status and tag filters, tag chips, and the due and repeat badges |
| `styles.css` | Styles, with light and dark themes |
| `tests/issue-N/` | Per ticket: test cases (`test-cases.md`), an automated runner (`run.js`), the actions each case must log (`expected-log.json`), and the latest eval (`eval/`) |
| `tests/lib/harness.js` | Shared test harness: serves the app and drives headless Chrome over the DevTools Protocol |
| `tests/eval/eval-logs.js` | The eval: compares an exported log with a suite's test cases (`node tests/eval/eval-logs.js --log … --spec … --expected …`) |
| `screenshots/issue-N/` | Browser screenshots from verifying each ticket |

## Conventions

- Task shape: `{ id, title, done, createdAt, due: "YYYY-MM-DD" | null, tags: string[], repeat: "none"|"daily"|"weekly"|"monthly", anchorDay: number | null, spawnedFrom?, nextId? }`. The database is `todo-app` (version 3), with the store `tasks`.
- **Recurring tasks:**
  - Completing one creates the next occurrence in the **same transaction**: same title, tags and repeat, due `Recurrence.nextDue(...)`.
  - Missed occurrences are skipped, so the next due date is always on or after today.
  - Monthly tasks keep `anchorDay`, clamped to the month's length, so Jan 31 → Feb 28 → Mar 31.
  - A repeat with no due date starts today.
  - Each occurrence creates the next one **at most once** (`nextId`). Reopening a completed task removes its spawned copy only if that copy is untouched (still open, same repeat, no copy of its own). Otherwise the copy is kept and the reopened occurrence becomes a **one-off** (`repeat: "none"`), so there is never a second live series. Only the **open head** of a series (open, repeating, no `nextId`) shows the 🔁 badge and **Stop repeating**.
  - **Stop repeating** sets `repeat: "none"`.
- Tags are trimmed, lowercased and deduplicated, with at most 30 characters each (`TodoDB.normalizeTags`).
- Sort order: open tasks before completed ones. Open tasks are ordered soonest-due first, with undated tasks last, then newest first.
- The database open handles `onblocked` (another tab holds an older version: fail with a clear message, and close any late connection) and `onversionchange` (close and forget this connection so the next call reopens).
- Storage failures are shown in the `#error` box (`role=alert`) as well as logged. `act()` wraps every storage action, and `render()` reports load failures there.
- Filters (status AND one tag) live in memory and reset on reload.
- **Stored data is untrusted.** `TodoDB` coerces every field on read: the repeat value is checked against a fixed list, invalid dates become `null`, tags are cleaned up, `createdAt` becomes a number, `anchorDay` becomes 1–31 or `null`, and the ids (`nextId`/`spawnedFrom`) become integers or `null`.
- **Action log:**
  - Each entry is `{ id, ts, sessionId, seq, actor: "user"|"api", automated, action, taskId, changes, outcome, error?, testCase? }`.
  - The actions are `task.add`, `task.complete`, `task.spawn`, `task.reopen`, `task.copy_removed`, `task.become_oneoff`, `task.stop_repeating`, `task.delete`, `ui.filter_status`, `ui.filter_tag`, `log.export`, `log.clear` and `test.case_start`.
  - **No titles or tag text are ever logged**; a tag filter is recorded only as `set` or `cleared`.
  - **Limits:** code driving the page's own buttons, such as an AI using the browser, is logged as `user`; `automated: true` marks a browser under automation. The log is client-side and best-effort, so it isn't tamper-proof against code running in the page.
  - **Attribution:** an entry is `user` only when it carries the private token from `TodoLog.claimUserToken()`, which `app.js` claims once and keeps in its closure. It passes the token to `TodoDB` methods and `TodoLog.log`. Every other caller, even one passing `{ actor: "user" }`, is logged as `api`.
  - **Eval expectations** use the syntax `action[:error][@actor]`, e.g. `task.add@user` or `task.delete:error@user`. Only successful entries satisfy a plain action, and a failed action that a case doesn't expect makes it fail (`unexpected-error`).
  - The Activity log panel renders entries as text only.
- Render user input with `textContent` or `new Option(text)` only, never `innerHTML`.
- To change the data shape, bump `DB_VERSION` and migrate existing records in `onupgradeneeded`. Never drop data (see the v1/v2 → v3 migration).

## Tests

`node todo/tests/issue-14/run.js` runs the action-log suite (TC-01–TC-40, including the full issue-7 suite as TC-26). Both runners tag every end-to-end case in the log (`TodoLog.setTestCase`), then run the eval and write `eval/eval-report.md` and `eval/eval-report.json`. A case that didn't run, or didn't produce its expected actions, fails the run.


`node todo/tests/issue-7/run.js` runs the recurring-task suite (TC-01–TC-42): unit tests in Node, then end-to-end tests in headless Chrome. It needs Node 18+, Python 3 and Chrome; set `CHROME_PATH` if Chrome isn't in the default location. Set `SCREENSHOTS=<dir>` to save screenshots.

## Manual test checklist

1. Add a task; it appears in the list, and an empty or whitespace-only title does nothing.
2. Tick it; it is struck through and moves below the open tasks. Delete removes it.
3. Add a task with a past due date and the tags `Home, bills`. It shows "Overdue · <date>" in red and the chips `#home` and `#bills`.
4. A task due today shows "Due today". Open tasks are ordered overdue, then today, then later, then undated.
5. The tags `Work, work , URGENT,` are saved as `work` and `urgent`.
6. The **Active** and **Completed** buttons show only open or only done tasks. The counter adds "showing N".
7. The tag dropdown lists each tag with its count. Picking one narrows the list and combines with the status filter.
8. Clicking a tag chip selects that tag, without ticking the task.
9. A filter with no matches shows "No tasks match this filter."
10. Deleting the last task with a tag removes the tag from the dropdown and resets it to **All tags**.
11. After a reload, tasks, due dates, tags and done state persist; the filters reset.
12. Tasks saved by the v1 or v2 app still load.
13. Add a **Daily** task due today, then tick it. It stays under Completed, and a new copy appears "Due <tomorrow>" with a 🔁 Daily badge.
14. Untick the completed one. The new copy disappears again.
15. **Stop repeating** removes the 🔁 badge; ticking the task then creates no copy.
