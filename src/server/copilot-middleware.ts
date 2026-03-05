import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stat } from 'node:fs/promises';

// Lazy-import the SDK so the module only loads when the middleware is hit.
// This avoids top-level ESM issues during Vite config resolution.
async function loadSdk() {
  const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
  return { CopilotClient, approveAll };
}

interface ManagedSession {
  client: InstanceType<Awaited<ReturnType<typeof loadSdk>>['CopilotClient']>;
  session: Awaited<ReturnType<InstanceType<Awaited<ReturnType<typeof loadSdk>>['CopilotClient']>['createSession']>>;
}

const sessions = new Map<string, ManagedSession>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function copilotPlugin(): Plugin {
  return {
    name: 'copilot-api',
    configureServer(server) {
      // ── Return default repo path from env var ───────────────────────
      server.middlewares.use('/copilot-api/repo-path', (_req, res) => {
        json(res, 200, { repoPath: process.env.ADO_PR_REPO_PATH ?? '' });
      });

      // ── Create session ──────────────────────────────────────────────
      server.middlewares.use('/copilot-api/session', async (req, res) => {
        if (req.method === 'DELETE') {
          // Destroy session
          const body = JSON.parse(await readBody(req));
          const id: string = body.sessionId;
          const managed = sessions.get(id);
          if (managed) {
            try { await managed.session.destroy(); } catch { /* ignore */ }
            try { await managed.client.stop(); } catch { /* ignore */ }
            sessions.delete(id);
          }
          json(res, 200, { ok: true });
          return;
        }

        if (req.method !== 'POST') {
          json(res, 405, { error: 'Method not allowed' });
          return;
        }

        try {
          const { CopilotClient, approveAll } = await loadSdk();
          const body = JSON.parse(await readBody(req));
          const prContext: string = body.prContext ?? '';
          const repoPath: string | undefined = body.repoPath;

          // Validate the repo path if provided
          let useLocalRepo = false;
          if (repoPath) {
            try {
              const s = await stat(repoPath);
              useLocalRepo = s.isDirectory();
            } catch {
              // Path doesn't exist or isn't accessible — fall back to no local context
            }
          }

          const client = new CopilotClient();
          await client.start();

          // const systemContent = useLocalRepo
          //   ? `${prContext}\n\n## Local Repository\nThe local repository is available at: ${repoPath}\nYou can explore files, search code, and read file contents from this directory to provide deeper code review insights.`
          //   : prContext;

          const session = await client.createSession({
            model: body.model ?? 'claude-opus-4.6',
            streaming: true,
            onPermissionRequest: approveAll,
            systemMessage: {
              mode: 'append',
              content: prContext,
            },
            // When a local repo path is provided, allow the SDK's built-in tools
            // so Copilot can explore files on demand. Otherwise disable tools.
            ...(useLocalRepo ? { workingDirectory: repoPath } : { availableTools: [] }),
            infiniteSessions: { enabled: false },
          });

          const id = session.sessionId;
          sessions.set(id, { client, session });

          json(res, 200, { sessionId: id });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          json(res, 500, { error: msg });
        }
      });

      // ── Send message (SSE streaming) ────────────────────────────────
      server.middlewares.use('/copilot-api/message', async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'Method not allowed' });
          return;
        }

        try {
          const body = JSON.parse(await readBody(req));
          const id: string = body.sessionId;
          const prompt: string = body.prompt;

          const managed = sessions.get(id);
          if (!managed) {
            json(res, 404, { error: 'Session not found' });
            return;
          }

          // SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          const { session } = managed;

          function sse(type: string, payload: Record<string, unknown>) {
            res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
          }

          const unsubs: Array<() => void> = [];

          // Turn lifecycle
          unsubs.push(session.on('assistant.turn_start', () => {
            sse('turn_start', {});
          }));

          unsubs.push(session.on('assistant.turn_end', () => {
            sse('turn_end', {});
          }));

          // Intent
          unsubs.push(session.on('assistant.intent', (event) => {
            sse('intent', { intent: event.data.intent });
          }));

          // Reasoning (extended thinking)
          unsubs.push(session.on('assistant.reasoning', (event) => {
            sse('reasoning', { content: event.data.content });
          }));

          unsubs.push(session.on('assistant.reasoning_delta', (event) => {
            sse('reasoning_delta', { delta: event.data.deltaContent });
          }));

          // Message content streaming
          unsubs.push(session.on('assistant.message_delta', (event) => {
            sse('message_delta', { delta: event.data.deltaContent });
          }));

          // Tool execution
          unsubs.push(session.on('tool.execution_start', (event) => {
            sse('tool_start', {
              toolName: event.data.toolName,
              toolCallId: event.data.toolCallId,
            });
          }));

          unsubs.push(session.on('tool.execution_complete', (event) => {
            sse('tool_complete', {
              toolName: event.data.toolName,
              toolCallId: event.data.toolCallId,
              result: typeof event.data.result === 'string'
                ? event.data.result.slice(0, 2000)
                : JSON.stringify(event.data.result).slice(0, 2000),
            });
          }));

          // Session error
          unsubs.push(session.on('session.error', (event) => {
            sse('session_error', { message: event.data.message });
          }));

          // Wait for completion
          const finalMsg = await session.sendAndWait(
            { prompt },
            120_000, // 2 min timeout
          );

          for (const unsub of unsubs) unsub();

          // Send final message
          sse('done', { content: finalMsg?.data.content ?? '' });
          res.end();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // If headers already sent, write error as SSE event
          if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
            res.end();
          } else {
            json(res, 500, { error: msg });
          }
        }
      });
    },
  };
}
