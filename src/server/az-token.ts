import { execFile } from 'node:child_process';

const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

interface AzToken {
  accessToken: string;
  expiresOn: string; // ISO 8601
}

let cached: { token: string; expiresAt: number } | null = null;

// 5-minute buffer before expiry to avoid using almost-expired tokens
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function execAz(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('az', args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        const hint = stderr?.includes('az login')
          ? 'Run `az login` to authenticate.'
          : stderr || err.message;
        reject(new Error(`az CLI error: ${hint}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function getAzAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const raw = await execAz([
    'account', 'get-access-token',
    '--resource', ADO_RESOURCE_ID,
    '--output', 'json',
  ]);

  const data: AzToken = JSON.parse(raw);
  const expiresAt = new Date(data.expiresOn).getTime() - EXPIRY_BUFFER_MS;

  cached = { token: data.accessToken, expiresAt };
  return data.accessToken;
}
