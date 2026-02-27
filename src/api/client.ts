import type { AdoConfig } from '../types';

function formatFetchError(err: unknown, url: string): Error {
  if (err instanceof TypeError && (err.message === 'Failed to fetch' || err.message.includes('NetworkError'))) {
    return new Error(
      `Network error fetching ${url} — this is likely a CORS issue. ` +
      `The browser blocks direct requests to Azure DevOps. ` +
      `Make sure you are running the Vite dev server (npm run dev) which proxies API calls. ` +
      `Original error: ${err.message}`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

class AdoClient {
  private _orgUrl = '';
  private project = '';
  private _projectId = '';
  private _headers: Record<string, string> = {};

  configure(config: AdoConfig) {
    this._orgUrl = config.orgUrl.replace(/\/$/, '');
    this.project = config.project;
    const token = btoa(`:${config.pat}`);
    this._headers = {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    };
  }

  get isConfigured() {
    return !!this._orgUrl && !!this.project;
  }

  get orgUrl() {
    return this._orgUrl;
  }

  get projectName() {
    return this.project;
  }

  get projectId() {
    return this._projectId;
  }

  get headers() {
    return this._headers;
  }

  /** Project-scoped API base, routed through the Vite proxy */
  get baseUrl() {
    return `/ado-proxy/${encodeURIComponent(this.project)}/_apis`;
  }

  /** Org-level API base, routed through the Vite proxy */
  get orgBaseUrl() {
    return '/ado-proxy/_apis';
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      ...this._headers,
      'X-Ado-Org-Url': this._orgUrl,
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw formatFetchError(err, url);
    }

    if (!res.ok) {
      let detail: string;
      try {
        detail = await res.text();
      } catch {
        detail = '(could not read response body)';
      }
      throw new Error(
        `ADO API error ${res.status} ${res.statusText} — ${method} ${url}\n${detail}`,
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return res.text() as unknown as T;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${window.location.origin}${this.baseUrl}${path}`);
    url.searchParams.set('api-version', '7.1');
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return this.request<T>('GET', url.toString());
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${window.location.origin}${this.baseUrl}${path}`);
    url.searchParams.set('api-version', '7.1');
    return this.request<T>('POST', url.toString(), body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${window.location.origin}${this.baseUrl}${path}`);
    url.searchParams.set('api-version', '7.1');
    return this.request<T>('PATCH', url.toString(), body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${window.location.origin}${this.baseUrl}${path}`);
    url.searchParams.set('api-version', '7.1');
    return this.request<T>('PUT', url.toString(), body);
  }

  async delete(path: string): Promise<void> {
    const url = new URL(`${window.location.origin}${this.baseUrl}${path}`);
    url.searchParams.set('api-version', '7.1');
    await this.request<void>('DELETE', url.toString());
  }

  async getText(fullUrl: string): Promise<string> {
    return this.request<string>('GET', fullUrl);
  }

  /** Org-level GET (e.g. connectionData) */
  async getOrg<T>(path: string, apiVersion = '7.1-preview'): Promise<T> {
    const url = `${window.location.origin}${this.orgBaseUrl}${path}?api-version=${apiVersion}`;
    return this.request<T>('GET', url);
  }

  /** Org-level GET with query params */
  async getOrgParams<T>(path: string, params?: Record<string, string>, apiVersion: string | null = '7.1-preview'): Promise<T> {
    const url = new URL(`${window.location.origin}${this.orgBaseUrl}${path}`);
    if (apiVersion) url.searchParams.set('api-version', apiVersion);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return this.request<T>('GET', url.toString());
  }

  /** Resolve project name to GUID via the Projects API */
  async resolveProjectId(): Promise<void> {
    const data = await this.getOrg<{ id: string }>(`/projects/${encodeURIComponent(this.project)}`);
    this._projectId = data.id;
  }
}

export const adoClient = new AdoClient();
