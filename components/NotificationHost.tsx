import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameNotification, NotificationKind, subscribeToNotifications } from '../utils/notifications';

const AUTO_DISMISS_MS: Record<NotificationKind, number> = {
  info: 6000,
  success: 5000,
  warning: 9000,
  error: 12000,
};

const MAX_VISIBLE = 4;

const kindStyles: Record<NotificationKind, string> = {
  info: 'bg-gray-800/95 border-cyan-500/60 text-gray-100',
  success: 'bg-gray-800/95 border-green-500/60 text-green-100',
  warning: 'bg-gray-800/95 border-yellow-500/70 text-yellow-100',
  error: 'bg-gray-800/95 border-red-500/70 text-red-100',
};

/**
 * Renders app notifications as toasts. `alert()` is unusable inside the Arena iframe,
 * so every user-facing message is delivered here instead.
 */
const NotificationHost: React.FC = () => {
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications(current => current.filter(notification => notification.id !== id));
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToNotifications(notification => {
      setNotifications(current => {
        if (current.some(existing => existing.id === notification.id)) return current;
        return [...current, notification].slice(-MAX_VISIBLE);
      });
      const timer = setTimeout(() => dismiss(notification.id), AUTO_DISMISS_MS[notification.kind]);
      timersRef.current.set(notification.id, timer);
    });
    const timers = timersRef.current;
    return () => {
      unsubscribe();
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, [dismiss]);

  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-auto"
      data-testid="notification-host"
      aria-live="polite"
    >
      {notifications.map(notification => (
        <div
          key={notification.id}
          role={notification.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${kindStyles[notification.kind]}`}
        >
          <span className="flex-1 whitespace-pre-wrap break-words">{notification.message}</span>
          <button
            type="button"
            onClick={() => dismiss(notification.id)}
            className="text-gray-400 hover:text-white leading-none"
            aria-label="Dismiss notification"
            title="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default NotificationHost;
