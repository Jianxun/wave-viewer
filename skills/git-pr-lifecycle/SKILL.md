---
name: git-pr-lifecycle
description: Create a feature branch from main, commit all current local changes, open a GitHub pull request to main, merge the PR, and prune the merged branch. Use when a user asks for end-to-end git delivery of the current workspace state with non-interactive CLI commands.
---

# Git Pr Lifecycle

## Overview

Execute a deterministic git release sequence for the current working tree: branch, commit, PR, merge, and cleanup. Use `git` and `gh` with non-interactive commands and report exact outputs (branch name, PR number/URL, merge commit).

## Inputs
- Require `branch_name` (example: `feature/t-020-loaded-registry`).
- Require `commit_message` (single-line summary).
- Require `pr_title`.
- Require `pr_body` (short markdown summary + testing notes).

## Preconditions
- Ensure repository has a clean `main` base point before branching:
  1. `git checkout main`
  2. `git pull --ff-only origin main`
- Ensure tools exist:
  1. `git --version`
  2. `gh --version`
- Ensure GitHub auth is valid:
  1. `gh auth status`

## Workflow
1. Create feature branch from updated `main`.
```bash
git checkout -b <branch_name>
```

2. Stage all current changes and commit.
```bash
git add -A
git commit -m "<commit_message>"
```

3. Push branch and set upstream.
```bash
git push -u origin <branch_name>
```

4. Create PR to `main`.
```bash
gh pr create --base main --head <branch_name> --title "<pr_title>" --body "<pr_body>"
```

5. Merge PR and delete remote branch.
```bash
gh pr merge <branch_name> --squash --delete-branch
```

6. Prune local branch and sync local `main`.
```bash
git checkout main
git pull --ff-only origin main
git branch -d <branch_name>
git fetch --prune origin
```

## Verification and Report
- Confirm merge state:
  1. `gh pr view <branch_name> --json number,url,state,mergedAt`
  2. `git log --oneline -n 1`
- Report:
  1. branch name used
  2. commit SHA + message
  3. PR number + URL
  4. merge method used
  5. confirmation that local and remote feature branches were deleted

## Failure Handling
- If `git commit` fails due to no staged changes, stop and report that there is nothing to commit.
- If `gh pr create` fails because a PR already exists, run `gh pr view <branch_name>` and continue with merge if appropriate.
- If `gh pr merge` is blocked by required checks/reviews, stop and report blocker details instead of forcing merge.
