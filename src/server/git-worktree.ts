import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const WORKTREE_PREFIX = 'ado-pr-wt-';

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Create an isolated git worktree for the given branch.
 * Uses --detach to avoid "branch already checked out" conflicts.
 * Fetches latest from origin before creating the worktree.
 */
export async function createWorktree(repoPath: string, branch: string): Promise<string> {
  const worktreePath = await mkdtemp(join(tmpdir(), WORKTREE_PREFIX));

  await git(repoPath, ['fetch', 'origin']);
  await git(repoPath, ['worktree', 'add', '--detach', worktreePath, `origin/${branch}`]);

  return worktreePath;
}

/**
 * Remove a git worktree and clean up its temp directory.
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    await git(repoPath, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    try { await git(repoPath, ['worktree', 'prune']); } catch { /* ignore */ }
  }
  try { await rm(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Clean up stale ado-pr worktree temp directories older than 1 hour.
 * Call on server startup to handle leftovers from previous crashes.
 */
export function cleanupStaleWorktrees(): void {
  try {
    const tmp = tmpdir();
    for (const entry of readdirSync(tmp)) {
      if (!entry.startsWith(WORKTREE_PREFIX)) continue;
      const fullPath = join(tmp, entry);
      try {
        if (Date.now() - statSync(fullPath).mtimeMs > 60 * 60 * 1000) {
          rm(fullPath, { recursive: true, force: true }).catch(() => {});
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
