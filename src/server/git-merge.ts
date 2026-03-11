import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile as execFileCb } from 'node:child_process';
import { writeFile as writeFileCb } from 'node:fs';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const writeFile = promisify(writeFileCb);

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

async function gitAllowFailure(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { ...result, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

function branchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

export function gitMergePlugin(): Plugin {
  return {
    name: 'git-merge',
    configureServer(server) {

      // ── POST /git/merge/start ──────────────────────────────────────
      server.middlewares.use('/git/merge/start', async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
        try {
          const body = JSON.parse(await readBody(req)) as {
            repoPath: string;
            sourceBranch: string;
            targetBranch: string;
          };
          const cwd = body.repoPath;
          const source = branchName(body.sourceBranch);
          const target = branchName(body.targetBranch);

          // Fetch latest
          await git(cwd, ['fetch', 'origin']);

          // Checkout source branch
          await git(cwd, ['checkout', source]);

          // Pull latest source
          await gitAllowFailure(cwd, ['pull', 'origin', source]);

          // Attempt merge
          const mergeResult = await gitAllowFailure(cwd, ['merge', `origin/${target}`, '--no-edit']);

          if (mergeResult.code === 0) {
            json(res, 200, { status: 'clean', message: 'Merge completed without conflicts.' });
            return;
          }

          // Check for conflicts
          const { stdout: conflictFiles } = await gitAllowFailure(cwd, ['diff', '--name-only', '--diff-filter=U']);
          const conflicts = conflictFiles.trim().split('\n').filter(Boolean);

          if (conflicts.length > 0) {
            json(res, 200, { status: 'conflicts', conflicts });
          } else {
            // Merge failed but no conflicts — some other error
            json(res, 200, { status: 'error', message: mergeResult.stderr || mergeResult.stdout });
          }
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /git/merge/conflicts ──────────────────────────────────
      server.middlewares.use('/git/merge/conflicts', async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
        try {
          const body = JSON.parse(await readBody(req)) as { repoPath: string };
          const cwd = body.repoPath;

          const { stdout: conflictList } = await gitAllowFailure(cwd, ['diff', '--name-only', '--diff-filter=U']);
          const paths = conflictList.trim().split('\n').filter(Boolean);

          const files = await Promise.all(paths.map(async (path) => {
            const [base, ours, theirs] = await Promise.all([
              gitAllowFailure(cwd, ['show', `:1:${path}`]),
              gitAllowFailure(cwd, ['show', `:2:${path}`]),
              gitAllowFailure(cwd, ['show', `:3:${path}`]),
            ]);
            return {
              path,
              baseContent: base.stdout,
              oursContent: ours.stdout,
              theirsContent: theirs.stdout,
            };
          }));

          json(res, 200, { files });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /git/merge/resolve-file ───────────────────────────────
      server.middlewares.use('/git/merge/resolve-file', async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
        try {
          const body = JSON.parse(await readBody(req)) as {
            repoPath: string;
            filePath: string;
            resolution: 'ours' | 'theirs' | 'manual';
            content?: string;
          };
          const cwd = body.repoPath;

          if (body.resolution === 'ours') {
            await git(cwd, ['checkout', '--ours', body.filePath]);
          } else if (body.resolution === 'theirs') {
            await git(cwd, ['checkout', '--theirs', body.filePath]);
          } else if (body.resolution === 'manual' && body.content != null) {
            const { join } = await import('node:path');
            await writeFile(join(cwd, body.filePath), body.content, 'utf-8');
          } else {
            json(res, 400, { error: 'Manual resolution requires content field' });
            return;
          }

          await git(cwd, ['add', body.filePath]);
          json(res, 200, { resolved: true, path: body.filePath });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /git/merge/complete ───────────────────────────────────
      server.middlewares.use('/git/merge/complete', async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
        try {
          const body = JSON.parse(await readBody(req)) as {
            repoPath: string;
            commitMessage?: string;
          };
          const cwd = body.repoPath;

          // Commit — use provided message or let git use default merge message
          if (body.commitMessage) {
            await git(cwd, ['commit', '-m', body.commitMessage]);
          } else {
            await git(cwd, ['commit', '--no-edit']);
          }

          // Push
          await git(cwd, ['push', 'origin', 'HEAD']);

          json(res, 200, { completed: true });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // ── POST /git/merge/abort ──────────────────────────────────────
      server.middlewares.use('/git/merge/abort', async (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
        try {
          const body = JSON.parse(await readBody(req)) as { repoPath: string };
          await git(body.repoPath, ['merge', '--abort']);
          json(res, 200, { aborted: true });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
