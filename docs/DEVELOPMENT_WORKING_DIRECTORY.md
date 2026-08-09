# Tetamu POS development working directory

## Canonical repository

The only canonical local development repository is:

```text
C:\CodexTetamuP0
```

- Do not develop inside OneDrive.
- Do not use `.p0-testing-deploy` as the source repository.
- GitHub committed source is the committed source of truth.
- Uncommitted work must be preserved before moving or replacing a working directory.

## Mandatory check at the start of every Codex task

PowerShell:

```powershell
Set-Location "C:\CodexTetamuP0"
git rev-parse --show-toplevel
git branch --show-current
git status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/assert-canonical-working-directory.ps1
```

Command Prompt equivalent:

```cmd
cd /d C:\CodexTetamuP0
git rev-parse --show-toplevel
git branch --show-current
git status
```

Stop immediately with `WRONG WORKING DIRECTORY` when:

- the real repository root contains `OneDrive`;
- the real repository root contains `.p0-testing-deploy`;
- `C:\CodexTetamuP0` is a Junction, symbolic link or another reparse point;
- `git rev-parse --show-toplevel` does not resolve to `C:\CodexTetamuP0`.

The guard is developer-only. It is not part of Railway or Production startup/build commands.

## Legacy repositories

Old OneDrive repositories, restored worktrees, patches and source snapshots are recovery references only. Do not merge or delete them without an explicit source decision.
