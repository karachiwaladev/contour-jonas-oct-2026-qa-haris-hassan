# Todo app

A simple todo app. You can create a task, mark it done and delete it (Ticket #3, issue #4). Tasks can also have an optional due date and tags, and you can filter by status and by tag (Ticket #4, issue #5). Tasks are stored in the browser with **IndexedDB**: there is no server or build step, and nothing else to install.

## Run

Open `todo/index.html` in a browser, or serve the folder with `python -m http.server 8765 --directory todo`. Tasks persist across reloads in that browser profile.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup; loads `db.js` and then `app.js` as classic scripts, so it works from `file://` |
| `db.js` | `TodoDB`: an IndexedDB wrapper (`all`, `get`, `add(title, {due, tags})`, `setDone`, `remove`, `normalizeTags`) |
| `app.js` | UI: rendering, the add form, the status and tag filters, tag chips and due badges |
| `styles.css` | Styles, with light and dark themes |
| `screenshots/issue-N/` | Browser screenshots from verifying each ticket |

## Conventions

- Task shape: `{ id, title, done, createdAt, due: "YYYY-MM-DD" | null, tags: string[] }`. The database is `todo-app` (version 2), with the store `tasks`.
- Tags are trimmed, lowercased and deduplicated, with at most 30 characters each (`TodoDB.normalizeTags`).
- Sort order: open tasks before completed ones. Open tasks are ordered soonest-due first, with undated tasks last, then newest first.
- Filters (status AND one tag) live in memory and reset on reload.
- Render user input with `textContent` or `new Option(text)` only, never `innerHTML`.
- To change the data shape, bump `DB_VERSION` and migrate existing records in `onupgradeneeded`. Never drop data (see the v1 → v2 migration).

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
12. Tasks saved by the v1 app still load, with no due date and no tags.
