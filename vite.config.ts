import { defineConfig } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copilotPlugin } from './src/server/copilot-middleware'
import { getAzAccessToken } from './src/server/az-token'

async function proxyRequest(req: IncomingMessage, res: ServerResponse, targetUrl: string) {
  let token: string;
  try {
    token = await getAzAccessToken();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Azure CLI authentication failed: ${msg}`,
      hint: 'Run `az login` in your terminal, then retry.',
    }));
    return;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;

  try {
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
      });
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const ct = upstream.headers.get('content-type');
    const resHeaders: Record<string, string> = {};
    if (ct) resHeaders['Content-Type'] = ct;
    res.writeHead(upstream.status, resHeaders);

    const data = Buffer.from(await upstream.arrayBuffer());
    res.end(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Proxy error: ${msg}`,
      targetUrl,
      hint: 'Check that the Organization URL is correct and reachable from this machine.',
    }));
  }
}

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    copilotPlugin(),
    {
      name: 'ado-proxy',
      configureServer(server) {
        // Auth status endpoint: verifies az CLI is logged in and can reach ADO
        server.middlewares.use('/auth/status', async (req, res) => {
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const orgUrl = url.searchParams.get('orgUrl');
          if (!orgUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: false, error: 'Missing orgUrl query parameter' }));
            return;
          }

          try {
            const token = await getAzAccessToken();
            const adoRes = await fetch(
              `${orgUrl.replace(/\/$/, '')}/_apis/connectionData?api-version=7.1-preview`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!adoRes.ok) {
              const detail = await adoRes.text().catch(() => '');
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                authenticated: false,
                error: `ADO returned ${adoRes.status}: ${detail}`,
              }));
              return;
            }
            const data = await adoRes.json() as {
              authenticatedUser?: { id: string; providerDisplayName: string };
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              authenticated: true,
              profile: {
                id: data.authenticatedUser?.id,
                displayName: data.authenticatedUser?.providerDisplayName,
              },
            }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              authenticated: false,
              error: msg,
            }));
          }
        });

        // Dynamic proxy: reads the target ADO org URL from the X-Ado-Org-Url header
        server.middlewares.use('/ado-proxy', async (req, res) => {
          const adoOrgUrl = req.headers['x-ado-org-url'] as string | undefined;
          if (!adoOrgUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing X-Ado-Org-Url header' }));
            return;
          }

          const targetUrl = `${adoOrgUrl.replace(/\/$/, '')}${req.url}`;
          await proxyRequest(req, res, targetUrl);
        });

        // VSSPS proxy: rewrites dev.azure.com → vssps.dev.azure.com for Graph APIs
        server.middlewares.use('/ado-vssps-proxy', async (req, res) => {
          const adoOrgUrl = req.headers['x-ado-org-url'] as string | undefined;
          if (!adoOrgUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing X-Ado-Org-Url header' }));
            return;
          }

          const vsspsUrl = adoOrgUrl.replace(/\/$/, '').replace('://dev.azure.com', '://vssps.dev.azure.com');
          const targetUrl = `${vsspsUrl}${req.url}`;
          await proxyRequest(req, res, targetUrl);
        });
      },
    },
  ],
})
