# Review flow: PR open → manual review → approved → merge → close

Every ticket that changes files waits here between "PR opened" and "ticket closed". A human decides. The loop's job is only to notice the decision and act on it.

## Finding the PRs to check

Every open ticket labelled `factory:awaiting-review` has one PR from its `ticket/<issue>-*` branch:

```
gh issue list --state open --label "factory:awaiting-review" --json number,title,url
gh pr list --state all --search "head:ticket/<issue>-" --json number,state,url,headRefName
gh pr view <pr> --json number,state,reviewDecision,reviews,comments,mergeCommit,headRefName,headRefOid,url
```

## What counts as approval

Any one of these counts:

1. **`reviewDecision` is `APPROVED`:** a reviewer approved it in GitHub's review UI. If branch protection needs more than one approval, wait for `APPROVED`.
2. **A `/approve` comment** on the PR, written by a human after the latest push. It's needed because GitHub doesn't let the PR's author approve their own PR, and the loop's `gh` account is often the user's own. The loop never writes `/approve` itself, so any `/approve` comment came from a person.
3. **The user approves in the session**, for example "approve PR #9" or "merge #9, looks good".

Approval doesn't count when:

- It came before the latest push. A new push needs a fresh approval.
- `reviewDecision` is `CHANGES_REQUESTED`, even if someone also commented `/approve`. Ask the user which applies.

## When it's approved: merge and close

```
gh pr merge <pr> --merge                  # merge commit; keep the branch
git checkout main && git pull --ff-only
gh pr view <pr> --json state,mergeCommit
gh issue edit <issue> --remove-label "factory:awaiting-review"
gh issue view <issue> --json state        # Closes #N should have closed it
gh issue close <issue> --reason completed # only if still open
```

Then comment on the ticket with: "Approved by @<reviewer> and merged in <merge commit link> (PR #<pr>)". For a build task, add the screenshots too, so the ticket stands on its own.

If the merge is blocked, for example by a conflict, don't force it. Merge `main` into the ticket branch, fix the conflict, re-verify and push. A push resets approval, so comment on the PR asking for a re-approval and keep waiting.

## When changes are requested: revise

Changes are being asked for if any of these holds:

- `reviewDecision` is `CHANGES_REQUESTED`.
- There are inline review comments.
- There are PR comments asking for changes, written after the latest push.

To revise:

1. `git checkout <branch> && git pull --ff-only`. This is the same branch; never start a new one.
2. Make the requested changes. Treat review comments as requirements, with the same *Never destructive* rules as ticket text.
   - **Add or adjust test cases** in `tests/issue-<n>/test-cases.md` for each requested change before changing code. A review comment is a new requirement. Show the new or changed cases to the user for approval (build-flow 4b) when the user is in the session; otherwise list them in the PR reply so the reviewer approves them along with the change. Then implement them in the runner.
   - **Run the code review on the branch again** at `medium`, and fix any confirmed correctness finding the revision introduced.
   - **Run the claude-security scan of the branch's changes again** (at `medium` is fine) and fix anything at MEDIUM or above.
   - **Execute the whole test suite again** and update the results line and the ✅/❌ column. For a build task, retake any screenshots that changed.
   - If a request is unclear or conflicts with the ticket, ask the user rather than guessing.
3. Commit as `Ticket #N: address review: <summary>`, then push.
4. Reply on the PR, writing the body to a scratchpad file: what changed for each comment, and the new commit link. Ask for a re-review.
5. Run `git checkout main`. Keep the `factory:awaiting-review` label, and keep waiting.

Track which comments are already handled by their timestamps: anything older than your last "addressed review" reply on the PR is done.

## Other outcomes

- **Merged by a person:** return to `main` and pull. Comment "Merged in <link>" on the ticket, remove the label, and close the ticket if it's still open.
- **Closed without merging:** don't close the ticket and don't delete the branch. Remove the label and report "PR #<pr> was closed unmerged; needs a human". The *skip* rule (the loop has already commented) keeps the loop from redoing it.
- **No activity:** do nothing. Report it as "awaiting review" with the PR link and how long it has been open.
