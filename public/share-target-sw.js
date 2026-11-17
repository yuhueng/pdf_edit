// Web Share Target: Android's Share sheet posts a PDF here. Keep it in Cache Storage, then open the app,
// which reads it (src/lib/launch.ts) and opens it in Edit. Loaded into the Workbox service worker with importScripts.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;
  event.respondWith(
    (async () => {
      try {
        const data = await event.request.formData();
        const file = data.getAll('pdf').find((f) => f && typeof f !== 'string');
        if (file) {
          const cache = await caches.open('yh-share');
          await cache.put(
            '/shared-file',
            new Response(file, { headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(file.name || 'shared.pdf') } }),
          );
        }
      } catch {
        /* nothing usable was shared: just open the app */
      }
      return Response.redirect('/?shared=1', 303);
    })(),
  );
});
