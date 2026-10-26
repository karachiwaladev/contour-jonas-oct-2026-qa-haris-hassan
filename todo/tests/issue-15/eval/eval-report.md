# Eval report: issue-15

**Result: FAIL**. 2 passed, 20 not executed, 1 incomplete, 0 with unexpected failures, 0 unit, 2 skipped. 5 log entries read, 0 malformed, 0 unknown case tags.
Generated 2026-10-26T11:54:29.252Z.

| Case | Auto | Status | Missing actions / note |
|------|------|--------|------------------------|
| TC-01 | e2e | ✅ pass |  |
| TC-02 | e2e | ❌ incomplete | missing: task.add@user |
| TC-03 | e2e | ❌ not-executed | missing: task.add@user |
| TC-04 | e2e | ❌ not-executed | missing: ui.filter_priority@user |
| TC-05 | e2e | ❌ not-executed | missing: ui.filter_priority@user, ui.filter_status@user, ui.filter_tag@user |
| TC-06 | e2e | ❌ not-executed |  |
| TC-07 | e2e | ❌ not-executed |  |
| TC-08 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-09 | e2e | ❌ not-executed |  |
| TC-10 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-11 | e2e | ❌ not-executed |  |
| TC-12 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-13 | e2e | ❌ not-executed |  |
| TC-14 | e2e | ❌ not-executed | missing: task.complete@user, task.spawn@user |
| TC-15 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-16 | e2e | ❌ not-executed | missing: task.edit@api |
| TC-17 | e2e | ✅ pass |  |
| TC-18 | e2e | ❌ not-executed |  |
| TC-19 | e2e | ❌ not-executed |  |
| TC-20 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-21 | e2e | ❌ not-executed | missing: task.edit@user, task.spawn@user |
| TC-22 | e2e | ❌ not-executed | missing: task.edit:error@api |
| TC-23 | e2e | ❌ not-executed | missing: task.edit@user |
| TC-24 | e2e | ➖ skipped | runs the issue-7 and issue-14 suites in their own browsers; they write their own eval reports |
| TC-25 | e2e | ➖ skipped | a console check across the whole run, not an app action |
