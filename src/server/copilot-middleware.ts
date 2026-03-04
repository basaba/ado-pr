import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

          const client = new CopilotClient();
          await client.start();

          const session = await client.createSession({
            model: body.model ?? 'claude-sonnet-4',
            streaming: true,
            onPermissionRequest: approveAll,
            systemMessage: {
              mode: 'append',
              content: prContext,
            },
            // Disable tools/file access since this is a review-only chat
            availableTools: [],
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

          // Stream deltas
          const unsub = session.on('assistant.message_delta', (event) => {
            const data = JSON.stringify({ delta: event.data.deltaContent });
            res.write(`data: ${data}\n\n`);
          });

          // Wait for completion
          const finalMsg = await session.sendAndWait(
            { prompt },
            120_000, // 2 min timeout
          );

          unsub();

          // Send final message
          const done = JSON.stringify({
            done: true,
            content: finalMsg?.data.content ?? '',
          });
          res.write(`data: ${done}\n\n`);
          res.end();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // If headers already sent, write error as SSE event
          if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
            res.end();
          } else {
            json(res, 500, { error: msg });
          }
        }
      });
    },
  };
}
