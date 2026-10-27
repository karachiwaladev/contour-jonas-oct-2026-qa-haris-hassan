# Test cases: ticket #10, search and due-date filter (issue #25)

Written from the approved plan **before** implementation. Each end-to-end case is tagged in the action log and checked by the eval. **Expected log** uses the eval syntax `action[:error][@actor]`; `expected-log.json` holds the same expectations for the eval.

**Status:** **Reviewed and approved by hariscontour-gif on 2026-10-27** (31 cases). TC-32–TC-35 were added after the code review and **approved by hariscontour-gif on 2026-10-27**. TC-36–TC-37 were added after the second code-review round and **approved by hariscontour-gif on 2026-10-27**. After the third round, hariscontour-gif approved **logging search on and off only**: `set` when the box goes from empty to a query and `cleared` when it empties, both at once, with nothing new logged while a query is refined; TC-38–TC-39 were added and approved on 2026-10-27. TC-40 was added after the fourth code-review round and approved by hariscontour-gif on 2026-10-27. **Executed 2026-10-27 on `41cdd90`: 40/40 cases passed, plus the eval of the run.** TC-31 ran the issue-15 suite, which runs issue-14 and issue-7, with every eval passing. TC-26 and TC-32 were renamed for on/off logging; their expected results are unchanged.

`T` means today. "Search" is the new search box; "Due" is the new due-date filter.

| ID | Requirement | Type | Preconditions | Steps | Expected result | Expected log | Auto | Result |
|----|-------------|------|---------------|-------|-----------------|--------------|------|--------|
| TC-01 | Search box and Due filter exist | Functional | App loaded | Look at the filter bar | A search box (labelled, `maxlength` 200, empty) and a **Due** select offering Any due date, Overdue, Due today, Next 7 days, No due date (Any selected) | — | e2e | ✅ |
| TC-02 | Search by title as you type | Functional | Tasks "Buy milk", "Pay rent", "Milkshake recipe" | Type `milk` one character at a time | After each keystroke the list narrows; finally only "Buy milk" and "Milkshake recipe" show | ui.filter_search@user | e2e | ✅ |
| TC-03 | Search by tag | Functional | "A" tagged `work`; "B" tagged `home`; "C" untagged | Search `wor` | Only "A" shows (partial tag match) | ui.filter_search@user | e2e | ✅ |
| TC-04 | Any case | Functional | "Buy MILK" | Search `Milk`, then `mILK` | "Buy MILK" shows both times | ui.filter_search@user | e2e | ✅ |
| TC-05 | Leading `#` searches tags | Functional | "Report" tagged `work`; "Work out" untagged | Search `#work` | Only "Report" shows (the `#` form matches tag names, not titles) | ui.filter_search@user | e2e | ✅ |
| TC-06 | Spaces are trimmed | Edge | "Buy milk" | Search `   milk  ` | "Buy milk" shows | ui.filter_search@user | e2e | ✅ |
| TC-07 | Spaces only = no search | Edge | 3 tasks | Type three spaces | All 3 show; the counter has no "showing N" | — | e2e | ✅ |
| TC-08 | Clearing shows everything | Functional | 3 tasks; search `milk` narrows to 1 | Clear the box (select all + delete) | All 3 show again; the counter drops "showing N" | ui.filter_search@user | e2e | ✅ |
| TC-09 | Escape clears the search | Functional | Search `milk` active | Press Escape in the search box | The box is empty and all tasks show | ui.filter_search@user | e2e | ✅ |
| TC-10 | No matches | Edge | 3 tasks | Search `zzzz` | Empty list; "No tasks match this filter."; counter "… · showing 0" | ui.filter_search@user | e2e | ✅ |
| TC-11 | Due: Overdue | Functional | Open due `T-2`; open due `T`; done due `T-3`; open undated | Due = Overdue | Only the open `T-2` task shows (completed tasks are never overdue, matching the red badge) | ui.filter_due@user | e2e | ✅ |
| TC-12 | Due: Due today | Functional | Due `T-1`, `T`, `T+1`, undated | Due = Due today | Only the `T` task shows | ui.filter_due@user | e2e | ✅ |
| TC-13 | Due: Next 7 days | Functional | Due `T-1`, `T`, `T+6`, `T+7`, undated | Due = Next 7 days | `T` and `T+6` show; `T-1`, `T+7` and undated don't | ui.filter_due@user | e2e | ✅ |
| TC-14 | Due: No due date | Functional | Due `T`, undated ×2 | Due = No due date | Only the 2 undated tasks show | ui.filter_due@user | e2e | ✅ |
| TC-15 | Due: Any resets | Functional | Due = Overdue active | Due = Any due date | All tasks show | ui.filter_due@user | e2e | ✅ |
| TC-16 | Search combines with status | Functional | Open "Milk A", done "Milk B" | Search `milk`, then **Active** | Only "Milk A" | ui.filter_search@user, ui.filter_status@user | e2e | ✅ |
| TC-17 | Search combines with tag and priority | Functional | "Milk" High `shop`; "Milk" Low `shop`; "Milk" High `home` | Search `milk`, tag `shop`, priority High | Only the High `shop` task | ui.filter_search@user, ui.filter_tag@user, ui.filter_priority@user | e2e | ✅ |
| TC-18 | All five filters combine | Functional | Mixed tasks; exactly one is open, High, tagged `work`, due `T+2`, titled "Report" | Search `rep`, Active, tag `work`, priority High, Due = Next 7 days | Only that task; clearing each filter in turn widens the list | ui.filter_search@user, ui.filter_status@user, ui.filter_tag@user, ui.filter_priority@user, ui.filter_due@user | e2e | ✅ |
| TC-19 | List updates while searching | Functional | Search `milk` active | Add "Oat milk"; tick an existing match; delete one | The new match appears, the ticked one moves below, the deleted one disappears; the search stays active | task.add@user, task.complete@user, task.delete@user | e2e | ✅ |
| TC-20 | Filters reset on reload | Regression | Search `milk` and Due = Overdue active | Reload | The box is empty, Due is Any, all tasks show | — | e2e | ✅ |
| TC-21 | Regex characters are literal | Edge | "Plan (draft)", "a.b", "Other" | Search `(`, then `.*`, then `a.b` | `(` finds "Plan (draft)"; `.*` finds nothing; `a.b` finds only "a.b"; no console errors | ui.filter_search@user | e2e | ✅ |
| TC-22 | Long and non-English queries | Edge | "Café crème", "東京 trip" | Type 250 characters; then search `café`, then `東京` | The box holds at most 200 characters; `café` finds "Café crème"; `東京` finds "東京 trip" | ui.filter_search@user | e2e | ✅ |
| TC-23 | Empty list | Edge | No tasks | Search `x`; Due = Overdue | "No tasks yet. Add one above."; no errors | ui.filter_search@user, ui.filter_due@user | e2e | ✅ |
| TC-24 | HTML in the search box | Security | Task titled `<img src=x onerror=window.__xss=1>` | Search `<img`; also search `<b>bold</b>` | The task shows as plain text; no element is injected; `window.__xss` stays undefined | ui.filter_search@user | e2e | ✅ |
| TC-25 | Search text never logged | Security | Tasks exist | Search `secret-word-42`, pause, clear | Log has `ui.filter_search` with `changes.search` = `set` then `cleared`; no log entry contains `secret-word-42` | ui.filter_search@user | e2e | ✅ |
| TC-26 | Logged once per search | Functional | Tasks exist | Type `milk` quickly (under 100 ms per key), wait 1 s | Exactly one `ui.filter_search` `set` entry for the burst | ui.filter_search@user | e2e | ✅ |
| TC-27 | Due filter is logged with its value | Functional | Tasks exist | Choose each Due option | Each choice logs `ui.filter_due` with `changes.due` = `overdue`, `today`, `week`, `none`, `all` | ui.filter_due@user | e2e | ✅ |
| TC-28 | Tag chip + search | Regression | Search `milk`; "Milk" tagged `shop` | Click the `#shop` chip | Tag filter = `shop` and the search stays; the task isn't ticked | ui.filter_search@user, ui.filter_tag@user | e2e | ✅ |
| TC-29 | Edit form survives search re-renders | Regression | Two open tasks | Edit "Milk", type "Draft" in the title; then type in the search box | The edit form stays open with "Draft" if its task still matches | ui.filter_search@user | e2e | ✅ |
| TC-30 | No console errors, phone width | Functional | App at 375 px wide | Use search and Due | No console errors; the filter bar wraps with no horizontal scroll | ui.filter_search@user, ui.filter_due@user | e2e | ✅ |
| TC-31 | Earlier suites still pass | Regression | — | Run `node todo/tests/issue-15/run.js` (runs issue-14 and issue-7) | All pass with their evals | — | e2e | ✅ |
| TC-32 | The search entry is logged before the next action (code review #1) | Regression | Tasks exist, one open "Milk" | Type `milk` and tick "Milk" within 100 ms; separately, type `milk` and reload within 100 ms | The log has `ui.filter_search` `set` before `task.complete`; after the quick reload, the `set` entry is in the log | ui.filter_search@user, task.complete@user | e2e | ✅ |
| TC-33 | Clearing with ✕ logs at once (code review #2) | Regression | Search `milk` active and logged | Clear with the box's ✕ (the native `search` event), then change Due within 100 ms | `ui.filter_search` `cleared` is logged before `ui.filter_due` | ui.filter_search@user, ui.filter_due@user | e2e | ✅ |
| TC-34 | A bare `#` is no search (code review #3) | Edge | Tagged and untagged tasks; "Report" tagged `work` | Search `#`, then `#   `, then `# work` | `#` and `#   ` show every task with no "showing N"; `# work` shows only "Report" | ui.filter_search@user | e2e | ✅ |
| TC-35 | Matching doesn't depend on the browser's locale (code review #4) | Edge | Browser locale `tr-TR`; task "IDEA" tagged `inbox` | Search `#INBOX`, then `idea` | Both find the task | ui.filter_search@user | e2e | ✅ |
| TC-36 | Log entries keep the order things happened (code review round 2 #1) | Regression | Tasks exist | Add a task, type `milk`, and hide the page (visibilitychange) within 400 ms; separately, type `milk` and press **Clear log** within 400 ms | First: `task.add` is logged before `ui.filter_search`. Second: after the clear, the log holds only `log.clear`, with no search entry written before or after it | task.add@user, ui.filter_search@user | e2e | ✅ |
| TC-37 | A search typed during a failed reload still applies (code review round 2 #2) | Regression | Tasks "Milk" and "Bread"; the next `TodoDB.all()` rejects | Tick "Bread" (starts a reload that fails), then type `milk` straight away | The list shows only "Milk", filtered from the last loaded tasks, and the page error box explains the load failure | task.complete@user, ui.filter_search@user | e2e | ✅ |
| TC-38 | The Activity panel shows filter entries at once (code review round 3 #1) | Regression | Activity log panel open; tasks exist | Change Due to Overdue; then type `milk` in the search box | The panel lists the new `ui.filter_due` entry, then the `ui.filter_search` `set` entry, without any other action | ui.filter_due@user, ui.filter_search@user | e2e | ✅ |
| TC-39 | A failed first load isn't retried on every keystroke (code review round 3 #2) | Regression | The first `TodoDB.all()` rejects | Type `groceries` | `TodoDB.all()` is called no more than once more in total, and the error box shows one message (not one per key) | ui.filter_search@user | e2e | ✅ |
| TC-40 | A task being edited is never hidden by a filter (code review round 4) | Regression | Open tasks "Milk" and "Bread" | Edit "Milk" and type "Draft" in its title; then search `bread`; then set Due = Overdue | "Milk" stays listed with its edit form open showing "Draft" (alongside "Bread" for the search); Save then stores "Draft" and the filters apply to it normally | ui.filter_search@user, ui.filter_due@user, task.edit@user | e2e | ✅ |

## Coverage

| Ticket requirement | Cases |
|---|---|
| "a search box … filters tasks by title" | TC-01, TC-02, TC-04, TC-06, TC-21, TC-22 |
| "… and tag" | TC-03, TC-05 |
| "as I type" | TC-02, TC-19, TC-26 |
| "combine with the existing filters (status, tag, due date)" | TC-11–TC-18, TC-28 |
| "Clearing the box shows everything again" | TC-07, TC-08, TC-09 |
| Plan: logging without user text | TC-25, TC-26, TC-27 |
| Plan: security and regression | TC-20, TC-23, TC-24, TC-29, TC-30, TC-31 |

## How to run (once implemented)

```
node todo/tests/issue-25/run.js                    # this suite + the earlier suites (TC-31); writes eval/eval-report.md
node todo/tests/issue-25/run.js --skip-regression
```
