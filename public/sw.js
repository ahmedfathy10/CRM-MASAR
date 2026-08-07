self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { body: event.data?.text() }; }
  const title = data.title || 'إشعار';
  const options = { body: data.body || '', data: data, tag: data.conversationId ? `chat-${data.conversationId}` : undefined };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.conversationId ? `/chat?conversation=${data.conversationId}` : '/chat';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (let client of windowClients) {
      if (client.url.includes('/chat') && 'focus' in client) {
        client.postMessage({ type: 'openConversation', conversationId: data.conversationId });
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
