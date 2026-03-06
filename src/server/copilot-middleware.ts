import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { chmodSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';

// node-pty's prebuilt spawn-helper may lack +x after npm install on macOS.
try {
  const helper = resolve(process.cwd(), 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
  chmodSync(helper, 0o755);
} catch { /* not on darwin-arm64, or already fine */ }

// Lazy-load node-pty to avoid native-module issues at config-resolution time
async function loadPty() {
  const mod = await import('node-pty');
  return mod.default ?? mod;
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Resolve the copilot binary. node-pty can't exec Node wrapper scripts,
 * so we use the platform-specific native binary when available.
 */
function copilotBin(): { file: string; prefixArgs: string[] } {
  const platformBin = `copilot-${process.platform}-${process.arch}`;
  const nativePath = resolve(process.cwd(), 'node_modules/.bin', platformBin);
  try {
    chmodSync(nativePath, 0o755); // ensure executable
    return { file: nativePath, prefixArgs: [] };
  } catch {
    // Fallback: run the Node wrapper via the node executable
    return {
      file: process.execPath,
      prefixArgs: [resolve(process.cwd(), 'node_modules/.bin/copilot')],
    };
  }
}

export function copilotPlugin(): Plugin {
  return {
    name: 'copilot-pty',
    configureServer(server) {
      // ── Return default repo path from env var ───────────────────────
      server.middlewares.use('/copilot-api/repo-path', (_req, res) => {
        json(res, 200, { repoPath: process.env.ADO_PR_REPO_PATH ?? '' });
      });

      // ── WebSocket server for PTY sessions ───────────────────────────
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url === '/copilot-pty') {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
      });

      wss.on('connection', (ws: WebSocket) => {
        let ptyProcess: ReturnType<Awaited<ReturnType<typeof loadPty>>['spawn']> | null = null;
        let initialized = false;

        ws.on('message', async (raw) => {
          const msg = raw.toString();

          // First message must be the init payload with config
          if (!initialized) {
            try {
              const config = JSON.parse(msg) as {
                prContext?: string;
                repoPath?: string;
                cols?: number;
                rows?: number;
              };
              initialized = true;

              const pty = await loadPty();
              const copilotArgs: string[] = ['--allow-all'];
              const cwd = config.repoPath || process.cwd();

              if (config.repoPath) {
                copilotArgs.push('--add-dir', config.repoPath);
              }

              // Inject PR context via -i so Copilot absorbs it as the first
              // interactive prompt without modifying any repo files.
              if (config.prContext) {
                const preamble = [
                  'Below is context about the current Azure DevOps pull request.',
                  'Read and remember it. Do NOT summarize, review, or take any action.',
                  'Just respond with "Ready." and wait for my next message.',
                  '',
                  config.prContext,
                ].join('\n');
                copilotArgs.push('-i', preamble);
              }

              const { file, prefixArgs } = copilotBin();
              ptyProcess = pty.spawn(file, [...prefixArgs, ...copilotArgs], {
                name: 'xterm-256color',
                cols: config.cols ?? 120,
                rows: config.rows ?? 30,
                cwd,
                env: { ...process.env } as Record<string, string>,
              });

              // Pipe PTY output → WebSocket
              ptyProcess.onData((data: string) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'output', data }));
                }
              });

              ptyProcess.onExit(({ exitCode, signal }) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
                  ws.close();
                }
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              ws.send(JSON.stringify({ type: 'error', message: errMsg }));
              ws.close();
            }
            return;
          }

          // Subsequent messages are either stdin input or control commands
          try {
            const parsed = JSON.parse(msg) as
              | { type: 'input'; data: string }
              | { type: 'resize'; cols: number; rows: number };

            if (parsed.type === 'input' && ptyProcess) {
              ptyProcess.write(parsed.data);
            } else if (parsed.type === 'resize' && ptyProcess) {
              ptyProcess.resize(parsed.cols, parsed.rows);
            }
          } catch {
            // If not JSON, treat as raw stdin
            if (ptyProcess) {
              ptyProcess.write(msg);
            }
          }
        });

        ws.on('close', () => {
          if (ptyProcess) {
            try { ptyProcess.kill(); } catch { /* ignore */ }
            ptyProcess = null;
          }
        });
      });
    },
  };
}
