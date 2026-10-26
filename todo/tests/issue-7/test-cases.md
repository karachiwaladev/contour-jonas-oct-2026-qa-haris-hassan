# Test cases: Ticket #5, recurring tasks (issue #7)

Written from the approved plan **before** implementation. Run all automated cases with `node todo/tests/issue-7/run.js`; see *How to run* below.

**Status:** Executed 2026-10-26 on `8fa311f` (branch `ticket/7-recurring-tasks`): **25/25 cases passed** (26/26 checks; TC-13 runs as both a unit check and an end-to-end check). claude-security scan of the changes at high effort: 0 findings, stamped verified.

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

## How to run

Prerequisites: Node 18+, Python 3 (used to serve the folder), and Google Chrome. Set `CHROME_PATH` if Chrome isn't in the default location.

```
node todo/tests/issue-7/run.js
```

`run.js` runs the unit cases against `todo/recurrence.js` in Node, then serves `todo/` on a free port and drives the real app in headless Chrome over the DevTools Protocol. It prints one `PASS`/`FAIL TC-xx` line per case and exits non-zero on any failure.
