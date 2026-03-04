import { defineConfig } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copilotPlugin } from './src/server/copilot-middleware'

async function proxyRequest(req: IncomingMessage, res: ServerResponse, targetUrl: string) {
  const headers: Record<string, string> = {};
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization as string;
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
