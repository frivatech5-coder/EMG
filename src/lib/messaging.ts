import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ENV_VAPID_KEY, firebaseApp, firebaseWebConfig } from './firebase';
import { saveFcmToken } from '../services/notificationsEngine';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export interface PushEnableResult {
  ok: boolean;
  permission: BrowserNotificationPermission;
  token?: string;
  reason?:
    | 'unsupported'
    | 'permission_denied'
    | 'permission_dismissed'
    | 'missing_vapid_key'
    | 'sw_failed'
    | 'token_error';
  message: string;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function isWebPushSupported(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {
    return false;
  }
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export function buildServiceWorkerUrl(): string {
  const qs = new URLSearchParams({
    apiKey: firebaseWebConfig.apiKey || '',
    authDomain: firebaseWebConfig.authDomain || '',
    projectId: firebaseWebConfig.projectId || '',
    storageBucket: firebaseWebConfig.storageBucket || '',
    messagingSenderId: firebaseWebConfig.messagingSenderId || '',
    appId: firebaseWebConfig.appId || '',
  });
  return `/firebase-messaging-sw.js?${qs.toString()}`;
}

export const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  const swUrl = buildServiceWorkerUrl();
  const registration = await navigator.serviceWorker.register(swUrl, {
    scope: FCM_SW_SCOPE,
  });
  return registration;
}

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent;
  if (/CrOS/i.test(ua)) return 'Chromebook (ChromeOS)';
  if (/Android/i.test(ua)) return 'Android Browser';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Safari / Web App';
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//i.test(ua)) return 'Google Chrome';
  if (/Firefox\//i.test(ua)) return 'Mozilla Firefox';
  if (/Safari\//i.test(ua)) return 'Apple Safari';
  return 'Desktop Browser';
}

export async function enableBrowserPushNotifications(options: {
  vapidPublicKey?: string;
  deviceLabel?: string;
}): Promise<PushEnableResult> {
  const supported = await isWebPushSupported();
  if (!supported) {
    return {
      ok: false,
      permission: getBrowserNotificationPermission(),
      reason: 'unsupported',
      message:
        'Web Push (FCM) requires a modern HTTPS browser with Service Workers and Push API support (e.g. Chrome on Chromebook or Android).',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission === 'denied') {
    return {
      ok: false,
      permission,
      reason: 'permission_denied',
      message:
        'Browser notifications are blocked. Click the lock/site-settings icon in the address bar and allow Notifications for this site.',
    };
  }

  if (permission !== 'granted') {
    return {
      ok: false,
      permission,
      reason: 'permission_dismissed',
      message: 'Notification permission prompt was dismissed. Click Enable Push to try again.',
    };
  }

  let registration: ServiceWorkerRegistration | null = null;
  try {
    registration = await registerPushServiceWorker();
    if (!registration) {
      throw new Error('Service Worker registration returned null.');
    }
  } catch (err) {
    return {
      ok: false,
      permission,
      reason: 'sw_failed',
      message: `Service worker registration failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const resolvedVapidKey = (options.vapidPublicKey || ENV_VAPID_KEY || '').trim();
  if (!resolvedVapidKey) {
    return {
      ok: false,
      permission,
      reason: 'missing_vapid_key',
      message:
        'Browser permission granted and Service Worker active, but the Firebase Web Push Certificate (VAPID) public key is not configured yet. Add it below in Settings to generate an FCM device token.',
    };
  }

  try {
    const messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: resolvedVapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      return {
        ok: false,
        permission,
        reason: 'token_error',
        message: 'Firebase Cloud Messaging did not return a device token. Verify your VAPID key.',
      };
    }

    await saveFcmToken(token, options.deviceLabel || detectDeviceLabel());

    return {
      ok: true,
      permission,
      token,
      message: 'Device registered for Firebase Cloud Messaging Web Push.',
    };
  } catch (err) {
    return {
      ok: false,
      permission,
      reason: 'token_error',
      message:
        err instanceof Error
          ? `FCM token generation failed: ${err.message}`
          : 'FCM token generation failed.',
    };
  }
}

export async function subscribeForegroundPushMessages(
  handler: (payload: MessagePayload) => void
): Promise<() => void> {
  const supported = await isWebPushSupported();
  if (!supported || Notification.permission !== 'granted') {
    return () => undefined;
  }
  try {
    const messaging = getMessaging(firebaseApp);
    return onMessage(messaging, handler);
  } catch {
    return () => undefined;
  }
}

export async function sendLocalBrowserNotificationPreview(params: {
  title: string;
  body: string;
  targetSection?: string;
  recordId?: string;
}): Promise<{ ok: boolean; via: 'service_worker' | 'window_notification' | 'unavailable'; message: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      ok: false,
      via: 'unavailable',
      message: 'This browser does not support the Notification API.',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      via: 'unavailable',
      message: 'Notification permission must be granted before showing a system notification.',
    };
  }

  try {
    const reg = await registerPushServiceWorker();
    if (reg) {
      await reg.showNotification(params.title, {
        body: params.body,
        tag: `emg_preview_${Date.now()}`,
        data: {
          targetSection: params.targetSection || 'reminders',
          recordId: params.recordId || '',
        },
      });
      return {
        ok: true,
        via: 'service_worker',
        message: 'Displayed local Service Worker system notification preview.',
      };
    }
  } catch {
    // Fallback to Notification constructor below
  }

  new Notification(params.title, { body: params.body });
  return {
    ok: true,
    via: 'window_notification',
    message: 'Displayed local browser notification.',
  };
}

export async function triggerServerTestFcmPush(token: string): Promise<{ sent: boolean; message: string }> {
  const functions = getFunctions(firebaseApp);
  const callTestPush = httpsCallable<{ token: string }, { success: boolean; messageId?: string }>(
    functions,
    'sendTestPushNotification'
  );
  const result = await callTestPush({ token });
  return {
    sent: Boolean(result.data?.success),
    message: result.data?.messageId
      ? `FCM push delivered by Cloud Functions (Message ID: ${result.data.messageId}).`
      : 'FCM push request accepted by Cloud Functions.',
  };
}
