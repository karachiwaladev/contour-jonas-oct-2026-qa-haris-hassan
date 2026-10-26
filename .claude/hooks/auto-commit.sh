#!/usr/bin/env bash
# Stop hook: commit any pending changes and push them, so work never sits only
# on this machine. Never destructive: no force-push, no reset, no rebase. If
# anything unexpected happens, it stops and tells the user instead of guessing.

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

say() { printf '{"systemMessage": "auto-commit: %s"}\n' "$1"; exit 0; }

gitdir=$(git rev-parse --git-dir)
# Don't touch a repo that is in the middle of a merge, rebase or cherry-pick.
for f in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  [ -e "$gitdir/$f" ] && say "skipped, a git operation is in progress"
done

branch=$(git symbolic-ref --quiet --short HEAD) || say "skipped, HEAD is detached"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  files=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
  n=$(git diff --cached --name-only | wc -l | tr -d ' ')
  git commit -q -m "Auto-commit on stop: $n file(s) changed" \
    -m "Files: ${files}$([ "$n" -gt 5 ] && echo '...')" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || say "commit failed"
fi

# Push only if there is something the remote doesn't have yet.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -n "$upstream" ] && [ "$(git rev-list --count "$upstream..HEAD" 2>/dev/null)" = "0" ]; then
  exit 0
fi

git push -q origin "$branch" 2>/dev/null && exit 0

# Rejected, usually because the remote has new commits. Merge them (never
# rebase or force) and retry once; on a conflict, back out and leave it to the user.
if git pull -q --no-rebase --no-edit origin "$branch" 2>/dev/null; then
  git push -q origin "$branch" 2>/dev/null && exit 0
  say "push failed after merging origin/$branch, please push manually"
fi
git merge --abort 2>/dev/null
say "could not merge origin/$branch automatically; local commits are kept, please resolve and push"
