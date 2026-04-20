// Minimal service worker — required for Chrome's install prompt.
// No caching, just passthrough fetch so dev/proxy behavior is unchanged.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network-only */ });
