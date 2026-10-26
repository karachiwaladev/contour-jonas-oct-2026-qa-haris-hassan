# Todo app

A simple todo app. You can create a task, mark it done and delete it (Ticket #3, issue #4). Tasks can also have an optional due date and tags, and you can filter by status and by tag (Ticket #4, issue #5). Tasks can **repeat** daily, weekly or monthly (Ticket #5, issue #7). Tasks are stored in the browser with **IndexedDB**: there is no server or build step, and nothing else to install.

## Run

Open `todo/index.html` in a browser, or serve the folder with `python -m http.server 8765 --directory todo`. Tasks persist across reloads in that browser profile.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup; loads `recurrence.js`, `db.js` and then `app.js` as classic scripts, so it works from `file://` |
| `recurrence.js` | `Recurrence`: pure date math (`nextDue`, `normalizeRepeat`, `isValidDate`, `today`). It also loads in Node for unit tests. |
| `db.js` | `TodoDB`: an IndexedDB wrapper (`all`, `get`, `add(title, {due, tags, repeat})`, `setDone`, `stopRepeating`, `remove`, `normalizeTags`). It cleans up stored records when reading them. |
| `app.js` | UI: rendering, the add form, the status and tag filters, tag chips, and the due and repeat badges |
| `styles.css` | Styles, with light and dark themes |
| `tests/issue-N/` | Test cases (`test-cases.md`) and an automated runner (`run.js`) per ticket |
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
- Render user input with `textContent` or `new Option(text)` only, never `innerHTML`.
- To change the data shape, bump `DB_VERSION` and migrate existing records in `onupgradeneeded`. Never drop data (see the v1/v2 → v3 migration).

## Tests

`node todo/tests/issue-7/run.js` runs the recurring-task suite (TC-01–TC-41): unit tests in Node, then end-to-end tests in headless Chrome. It needs Node 18+, Python 3 and Chrome; set `CHROME_PATH` if Chrome isn't in the default location. Set `SCREENSHOTS=<dir>` to save screenshots.

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
