
/**
 * In-app notifications.
 *
 * The game runs inside a cross-origin iframe, where `window.alert` is blocked by the
 * sandbox and the player never sees the message (Chrome logs "Ignored call to 'alert()'"
 * and execution continues). Every important message - a failed save, a refused action,
 * a rejected import - goes through this tiny event bus instead, and the host component
 * renders it as a dismissible toast.
 */

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface GameNotification {
  id: number;
  message: string;
  kind: NotificationKind;
}

type NotificationListener = (notification: GameNotification) => void;

const listeners = new Set<NotificationListener>();
let nextNotificationId = 1;

/** Broadcast a message to every mounted host. Returns the notification id. */
export function notify(message: string, kind: NotificationKind = 'info'): number {
  const text = typeof message === 'string' ? message.trim() : String(message ?? '').trim();
  if (!text) return 0;
  const notification: GameNotification = { id: nextNotificationId++, message: text, kind };
  if (listeners.size === 0) {
    // Nothing is mounted yet (very early boot, tests): keep the message visible.
    console.warn(`[notification:${kind}] ${text}`);
    return notification.id;
  }
  for (const listener of [...listeners]) {
    try { listener(notification); } catch (error) { console.error('Notification listener failed', error); }
  }
  return notification.id;
}

export const notifyError = (message: string): number => notify(message, 'error');
export const notifySuccess = (message: string): number => notify(message, 'success');
export const notifyWarning = (message: string): number => notify(message, 'warning');

export function subscribeToNotifications(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Drops every subscriber; used by tests that mount and unmount hosts. */
export function resetNotificationBusForTests(): void {
  listeners.clear();
  nextNotificationId = 1;
}
