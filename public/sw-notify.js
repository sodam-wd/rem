/* R.E.M. : Recovery Terminal — imported into the generated service worker (workbox importScripts).
 * Notification click → focus an open app window and tell it which incident to open,
 * or open a new window on the incident route. No push handling (external push is on hold). */
self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      const target = sessionId ? scope + '#/alert/' + encodeURIComponent(sessionId) : scope;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((c) => c.url.indexOf(scope) === 0) || windows[0];
      if (client) {
        try {
          await client.focus();
        } catch (e) {
          /* focus may be refused; still deliver the message */
        }
        client.postMessage({ type: 'rem-open', sessionId: sessionId });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
