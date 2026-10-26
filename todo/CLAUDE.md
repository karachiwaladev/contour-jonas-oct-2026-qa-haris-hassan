# Todo app

A simple todo app (Ticket #3, issue #4). You can create a task, mark it done and delete it. Tasks are stored in the browser with **IndexedDB**: there is no server or build step, and nothing else to install.

## Run

Open `todo/index.html` in a browser. Tasks persist across reloads in that browser profile.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup; loads `db.js` and then `app.js` as classic scripts, so it works from `file://` |
| `db.js` | `TodoDB`: an IndexedDB wrapper (`all`, `get`, `add`, `setDone`, `remove`). All methods return Promises. |
| `app.js` | UI: renders the list and wires up the add form, the checkbox and the delete button |
| `styles.css` | Styles, with light and dark themes |

## Conventions

- Task shape: `{ id, title, done, createdAt }`. The database is `todo-app`, with the store `tasks`.
- Render titles with `textContent` only, because they are user input.
- To change the data shape, bump `DB_VERSION` in `db.js` and migrate in `onupgradeneeded`.

## Manual test checklist

1. Add a task; it appears at the top of the list.
2. Tick it; it is struck through and moves below the open tasks.
3. Reload the page; the task and its state are still there.
4. Delete it; it disappears and stays gone after a reload.
5. Submitting an empty or whitespace-only title does nothing.
