import { useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

export const useToast = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, type, message }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toast = {
    success: (msg: string) => add('success', msg, 4000),
    error: (msg: string, duration = 7000) => add('error', msg, duration),
    warning: (msg: string) => add('warning', msg, 5000),
    info: (msg: string) => add('info', msg, 4000),
  };

  return { toast, toasts, dismiss };
};
