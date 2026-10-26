# Test cases: Ticket #5, recurring tasks (issue #7)

Written from the approved plan **before** implementation. Run all automated cases with `node todo/tests/issue-7/run.js`; see *How to run* below.

**Status:** TC-01–TC-25 were executed on `8fa311f` (25/25 passed). TC-26–TC-29 were added after the code review of PR #11 and were **reviewed and approved by hariscontour-gif on 2026-10-26** (4 cases). TC-30–TC-31 were added after the second code-review round and were **reviewed and approved by hariscontour-gif on 2026-10-26** (2 cases). TC-32–TC-35 were added after the third code-review round and were **reviewed and approved by hariscontour-gif on 2026-10-26** (4 cases). TC-36–TC-38 were added after the fourth code-review round and were **reviewed and approved by hariscontour-gif on 2026-10-26** (3 cases; numeric tags are kept as text). TC-39–TC-41 were added after the fifth code-review round and were **reviewed and approved by hariscontour-gif on 2026-10-26** (3 cases).

**Dates** are relative to the day the suite runs: `T` is today, `T+3` is three days from today. Fixed calendar dates appear only in the unit cases (month-end, leap year, year boundary).

| ID | Requirement | Type | Preconditions | Steps | Expected result | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|------|--------|
| TC-01 | Create recurring tasks | Functional | App loaded | Look at the add form | A **Repeat** select offers None, Daily, Weekly, Monthly, and defaults to None | e2e | ✅ |
| TC-02 | Create recurring tasks | Functional | Empty list | Add "Water plants", due `T`, Repeat Daily | Task shows a "🔁 Daily" badge; stored `repeat: "daily"`, `anchorDay` = day of `T` | e2e | ✅ |
| TC-03 | Recurs when done (daily) | Functional | TC-02 | Tick "Water plants" | The ticked task is done (in Completed); a new open "Water plants" is due `T+1` with the same tags and repeat | e2e | ✅ |
| TC-04 | Recurs when done (weekly) | Functional | Empty list | Add "Team sync", due `T+2`, Weekly, tags `work`; tick it | New open copy due `T+9`, tags `[work]`, repeat weekly | e2e | ✅ |
| TC-05 | Recurs when done (monthly) | Functional | Empty list | Add "Pay rent", due `T+3`, Monthly; tick it | New open copy due on the same day of the next month (end-of-month rule applies) | e2e | ✅ |
| TC-06 | Completed occurrences kept | Functional | TC-03 | Click **Completed** | The completed "Water plants" occurrence is listed (history kept) | e2e | ✅ |
| TC-07 | Stop a series | Functional | An open recurring task | Click **Stop repeating** on it, then tick it | The badge and button disappear, stored `repeat: "none"`, and ticking creates **no** new copy | e2e | ✅ |
| TC-08 | Delete ends the series | Functional | An open recurring task | Delete it | It is gone and no replacement copy appears; the total task count drops by 1 | e2e | ✅ |
| TC-09 | Normal tasks unaffected | Functional | A task with Repeat None | Tick it | No copy is created | e2e | ✅ |
| TC-10 | Repeat needs a start date | Edge | Empty list | Add "Stretch", **no due date**, Repeat Daily | The task is saved with due `T` and shows "Due today" | e2e | ✅ |
| TC-11 | Monthly end-of-month anchor | Edge | — | `nextDue("2027-01-31","monthly",31,"2027-01-01")`, then from `"2027-02-28"` with anchor 31 | `2027-02-28`, then `2027-03-31` (no drift to the 28th) | unit | ✅ |
| TC-12 | Leap year | Edge | — | `nextDue("2028-01-31","monthly",31,"2028-01-01")` | `2028-02-29` | unit | ✅ |
| TC-13 | Missed occurrences skipped | Edge | — | Unit: daily due `2026-01-01`, today `2026-01-10`; weekly due `2026-01-01`, today `2026-01-16`. e2e: daily task due `T-5`, tick it | Unit: `2026-01-10`, then `2026-01-22`. e2e: the copy is due `T` (one task, no backlog) | unit + e2e | ✅ |
| TC-14 | Undo completion | Edge | TC-03 state | Untick the completed "Water plants" | The auto-created open copy (still open) is removed; the original is open again; there's exactly one open "Water plants" | e2e | ✅ |
| TC-15 | No duplicate copies | Edge | An open daily task | Call `setDone(id, true)` twice concurrently | Exactly one new copy is created | e2e | ✅ |
| TC-16 | Persistence | Edge | Recurring tasks exist | Reload the page | Badges, repeat and due dates persist; ticking after the reload still creates the next copy | e2e | ✅ |
| TC-17 | Year boundary | Edge | — | `nextDue("2026-12-29","weekly",29,"2026-12-01")`, and daily from `2026-12-31` | `2027-01-05`, then `2027-01-01` | unit | ✅ |
| TC-18 | v2 → v3 migration | Regression | A v2 database with tasks that have due dates and tags | Open the app | Tasks load unchanged, with `repeat: "none"` added; no badge; no data lost | e2e | ✅ |
| TC-19 | Filters still work | Regression | Recurring tasks with tags | Use Active, Completed and a tag filter | Each filter shows the right tasks; copies keep their tags, so the tag filter finds them | e2e | ✅ |
| TC-20 | Due badges and sort still work | Regression | Recurring tasks due `T-1`, `T`, `T+5`, plus an undated task | View All | Order is overdue, today, `T+5`, undated; the overdue and due-today badges are correct | e2e | ✅ |
| TC-21 | HTML renders as text | Security | — | Add a daily task titled `<img src=x onerror=window.pwned=1>` with tag `<b>x</b>`; tick it | Title and tag render as text in **both** occurrences; there is no `<img>` or `<b>` element; `window.pwned` stays unset | e2e | ✅ |
| TC-22 | Tampered repeat value | Security | A stored task with `repeat: "<img src=x onerror=window.pwned=1>"`, and one with `"yearly"` | Load the page; tick both | No crash, no badge, no injection; both are treated as `none`, so no copy is created | e2e | ✅ |
| TC-23 | Tampered due value | Security | Stored daily tasks with `due: "not-a-date"` and `"2026-13-45"` | Load the page; tick one | No crash; no due badge for the invalid date; the next copy is due `T+1` (the calculation falls back to today) | e2e | ✅ |
| TC-24 | No console errors | Security / Regression | The whole e2e run | Watch the console and exceptions | No errors and no uncaught exceptions | e2e | ✅ |
| TC-25 | Calculation rejects bad input | Security | — | `nextDue` with repeat `"x"`, an invalid due, or anchor `99`; `normalizeRepeat` with non-allowlisted values | Returns `null` for a non-repeat, never throws, clamps the anchor to 1–31, and `normalizeRepeat` returns `"none"` | unit | ✅ |
| TC-26 | No duplicate series (code review #1) | Regression | Daily A due `T` | Tick A (creates B); tick B (creates C); untick A; tick A again | No new copy appears: exactly one open occurrence (C) of the series, and A is done | e2e | ⏳ |
| TC-27 | Undo respects Stop repeating (code review #2) | Regression | Weekly A due `T+1` | Tick A (creates B); press **Stop repeating** on B; untick A; tick A again | B is kept with `repeat: "none"`, no new repeating copy is created, and the series stays ended | e2e | ⏳ |
| TC-28 | Undo after the copy was deleted (code review #1/#2) | Regression | Daily A due `T` | Tick A (creates B); delete B; untick A; tick A again | No new copy: deleting B ended the series | e2e | ⏳ |
| TC-29 | Monthly anchor kept when due is invalid; numeric fields coerced (code review #4/#5) | Security | A stored monthly task with `due: "bad"`, `anchorDay: "x"`, `createdAt: "oops"`, plus a normal task | Load the page; tick the monthly task | No crash; the sort is stable (no NaN); the spawned copy has a numeric `anchorDay` equal to its own day of month, and a valid due date | e2e | ⏳ |
| TC-30 | Only the open head of a series looks recurring (code review round 2 #1/#3) | Regression | Daily A due `T` | Tick A (creates B); delete B; untick A; also view completed occurrences | Reopened A shows no 🔁 badge and no Stop repeating; completed occurrences show no 🔁; ticking A creates nothing | e2e | ⏳ |
| TC-31 | Far-past due dates catch up (code review round 2 #4) | Edge | — | `nextDue("1500-01-15","monthly",15,"2026-10-26")`; daily `"1900-01-01"`; weekly `"1900-01-01"`, all with today `2026-10-26` | Monthly gives `2026-11-15`; daily gives `2026-10-26`; weekly gives the first date on or after today on the same weekday, less than 7 days away; never in the past | unit | ⏳ |
| TC-32 | One live series after nested undo (code review round 3 #1) | Regression | Daily A due `T` | A→B→C→D by ticking each; untick B; untick A | Exactly one open repeating head (one 🔁 badge: D) | e2e | ⏳ |
| TC-33 | A reopened past occurrence becomes a one-off (code review round 3 #5) | Regression | Daily A due `T` | Tick A (creates B); tick B (creates C); untick A; tick A again | A reopens with `repeat: "none"` and no 🔁; re-ticking creates nothing (3 tasks total) | e2e | ⏳ |
| TC-34 | Works after the database is upgraded or deleted elsewhere (code review round 3 #2) | Regression | The app is open with a task | Delete the database from the page (as another tab upgrading would), then add a task | The add succeeds and the list shows only the new task; no closed-connection error | e2e | ⏳ |
| TC-35 | Storage errors are visible (code review round 3 #3) | Regression | The app is open | Make `TodoDB.add` fail, then submit "Keep me" | A visible `role=alert` message says the task could not be added, and the typed title is kept | e2e | ⏳ |
| TC-36 | Tampered tag values are dropped (code review round 4 #4) | Security | A stored task with tags `[null, {}, 5, "ok", true, ["x"]]` | Load the page | Only `#5` and `#ok` chips appear: numbers are kept as text; null, objects, booleans and arrays are dropped | e2e | ⏳ |
| TC-37 | The error box clears once loading works again (code review round 4 #2) | Regression | Loading fails once and the error shows | Storage recovers; click the **Active** filter | The error box is hidden and the list loads | e2e | ⏳ |
| TC-38 | An older redraw cannot overwrite a newer one (code review round 4 #3) | Regression | A task "Real" exists | Start a redraw whose read is slow and returns stale data, then a normal redraw | The list shows "Real" (the newest redraw wins), not the stale result | e2e | ⏳ |
| TC-39 | Reopening never deletes a separate task (code review round 5 #1, data loss) | Regression | Daily A due `T` | Tick A (creates B); press **Stop repeating** on B; untick A; tick A; untick A | B still exists and is open; no task is deleted | e2e | ⏳ |
| TC-40 | No duplicate add on a fast double submit (code review round 5 #4) | Regression | Saving a task is slow | Submit "Buy milk" twice quickly | Exactly one "Buy milk" task | e2e | ⏳ |
| TC-41 | Typing during a save is kept (code review round 5 #4) | Regression | Saving a task is slow | Submit "Buy milk", then type "Call mom" while it saves | "Buy milk" is added and the input still holds "Call mom" | e2e | ⏳ |

## How to run

Prerequisites: Node 18+, Python 3 (used to serve the folder), and Google Chrome. Set `CHROME_PATH` if Chrome isn't in the default location.

```
node todo/tests/issue-7/run.js
```

`run.js` runs the unit cases against `todo/recurrence.js` in Node, then serves `todo/` on a free port and drives the real app in headless Chrome over the DevTools Protocol. It prints one `PASS`/`FAIL TC-xx` line per case and exits non-zero on any failure.
