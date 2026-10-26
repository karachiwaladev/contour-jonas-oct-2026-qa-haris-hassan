# Eval report: issue-14

**Result: FAIL**. 18 passed, 3 not executed, 6 incomplete, 8 unit, 3 skipped. 129 log entries read, 0 malformed, 0 unknown case tags.
Generated 2026-10-26T11:31:10.557Z.

| Case | Auto | Status | Missing actions / note |
|------|------|--------|------------------------|
| TC-01 | e2e | ❌ incomplete | missing: task.add@user |
| TC-02 | e2e | ❌ incomplete | missing: task.complete@user, task.reopen@user |
| TC-03 | e2e | ✅ pass |  |
| TC-04 | e2e | ✅ pass |  |
| TC-05 | e2e | ❌ incomplete | missing: task.delete@user |
| TC-06 | e2e | ❌ incomplete | missing: task.add@api, task.complete@api, task.add@user |
| TC-07 | e2e | ✅ pass |  |
| TC-08 | e2e | ✅ pass |  |
| TC-09 | e2e | ✅ pass |  |
| TC-10 | e2e | ✅ pass |  |
| TC-11 | e2e | ✅ pass |  |
| TC-12 | e2e | ✅ pass |  |
| TC-13 | e2e | ✅ pass |  |
| TC-14 | e2e | ✅ pass |  |
| TC-15 | e2e | ✅ pass |  |
| TC-16 | e2e | ➖ skipped | logging is made unavailable in this case on purpose, so it can leave no entries |
| TC-17 | e2e | ✅ pass |  |
| TC-18 | e2e | ✅ pass |  |
| TC-19 | e2e | ✅ pass |  |
| TC-20 | e2e | ✅ pass |  |
| TC-21 | unit | ➖ unit | unit: no app actions |
| TC-22 | unit | ➖ unit | unit: no app actions |
| TC-23 | unit | ➖ unit | unit: no app actions |
| TC-24 | unit | ➖ unit | unit: no app actions |
| TC-25 | unit | ➖ unit | unit: no app actions |
| TC-26 | e2e | ➖ skipped | runs the issue-7 suite in its own browser; that run writes its own eval report |
| TC-27 | e2e | ➖ skipped | a console check across the whole run, not an app action |
| TC-28 | unit | ➖ unit | unit: no app actions |
| TC-29 | e2e | ❌ incomplete | missing: task.delete@api |
| TC-30 | e2e | ✅ pass |  |
| TC-31 | e2e | ✅ pass |  |
| TC-32 | e2e | ✅ pass |  |
| TC-33 | e2e | ❌ incomplete | missing: task.delete@api |
| TC-34 | unit | ➖ unit | unit: no app actions |
| TC-35 | unit | ➖ unit | unit: no app actions |
| TC-36 | e2e | ❌ not-executed | missing: task.add@user |
| TC-37 | e2e | ❌ not-executed |  |
| TC-38 | e2e | ❌ not-executed | missing: task.delete:error@user |
