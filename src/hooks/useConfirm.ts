import { useState, useCallback } from 'react';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  detail?: string;
}

export interface ConfirmState extends Required<Omit<ConfirmOptions, 'detail'>> {
  message: string;
  detail?: string;
  resolve: (value: boolean) => void;
}

export const useConfirm = () => {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({
        message,
        detail: options.detail,
        title: options.title ?? 'Confirmar',
        confirmLabel: options.confirmLabel ?? 'Confirmar',
        cancelLabel: options.cancelLabel ?? 'Cancelar',
        variant: options.variant ?? 'default',
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = useCallback((result: boolean) => {
    setConfirmState(prev => {
      prev?.resolve(result);
      return null;
    });
  }, []);

  return { confirm, confirmState, handleConfirmClose };
};
