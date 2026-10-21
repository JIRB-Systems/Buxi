// Service worker de Buxmap: SOLO notificaciones push. No cachea nada ni
// intercepta pedidos, a propósito: la app no funciona sin conexión y un
// service worker que cachea mal deja a la gente con una versión vieja.
//
// Los mensajes los manda la función `push` de Supabase como JSON:
// { title, body, url, tag }.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { body: event.data ? event.data.text() : '' };
  }
  const titulo = datos.title || 'Buxmap';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: datos.body || '',
    tag: datos.tag || undefined,
    // Con el mismo tag, la nueva reemplaza a la vieja pero vuelve a sonar.
    renotify: !!datos.tag,
    icon: '/assets/icon/buxmap-icon-192.png',
    badge: '/assets/icon/buxmap-icon-192.png',
    data: { url: datos.url || '/passenger/map' },
    vibrate: [120, 60, 120],
  }));
});

// Tocar la notificación abre Buxmap en la ruta del aviso: si ya hay una
// pestaña abierta, la usa; si no, abre una.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/passenger/map', self.location.origin).href;
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
