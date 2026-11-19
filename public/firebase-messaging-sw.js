/* eslint-disable no-undef */
/**
 * EMG Web Solutions — Firebase Cloud Messaging Service Worker
 * Handles background Web Push delivery on Chromebook and supported mobile/desktop browsers,
 * plus notification click deep-linking back to the exact dashboard record.
 */

importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging-compat.js');

(function initEmgSw() {
  try {
    const swUrl = new URL(self.location.href);
    const params = swUrl.searchParams;
    const apiKey = params.get('apiKey') || '';
    const authDomain = params.get('authDomain') || '';
    const projectId = params.get('projectId') || '';
    const storageBucket = params.get('storageBucket') || '';
    const messagingSenderId = params.get('messagingSenderId') || '';
    const appId = params.get('appId') || '';

    if (apiKey && projectId && messagingSenderId && appId) {
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey,
          authDomain,
          projectId,
          storageBucket,
          messagingSenderId,
          appId,
        });
      }

      const messaging = firebase.messaging();
      messaging.onBackgroundMessage((payload) => {
        const data = payload.data || {};
        const notif = payload.notification || {};
        const title = notif.title || data.title || 'EMG Web Solutions Alert';
        const body = notif.body || data.message || 'An administrative alert requires your attention.';
        const priority = data.priority || 'Info';
        const dedupeKey = data.dedupeKey || payload.messageId || `emg_${Date.now()}`;

        return self.registration.showNotification(title, {
          body,
          tag: dedupeKey,
          renotify: false,
          requireInteraction: priority === 'Critical',
          data: {
            targetSection: data.targetSection || 'reminders',
            recordId: data.recordId || '',
            dedupeKey,
          },
        });
      });
    }
  } catch (err) {
    console.error('EMG FCM Service Worker initialization warning:', err);
  }
})();

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawData = event.notification.data || {};
  const fcmData = rawData.FCM_MSG && rawData.FCM_MSG.data ? rawData.FCM_MSG.data : {};
  const targetSection = rawData.targetSection || fcmData.targetSection || 'reminders';
  const recordId = rawData.recordId || fcmData.recordId || '';
  const dedupeKey = rawData.dedupeKey || fcmData.dedupeKey || '';

  const qs = new URLSearchParams();
  qs.set('section', targetSection);
  if (recordId) qs.set('recordId', recordId);
  const targetUrl = `/?${qs.toString()}`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'EMG_NOTIFICATION_CLICK',
            targetSection,
            recordId,
            dedupeKey,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
