import { useState, useCallback } from 'react';

export interface InputModalOptions {
  title?: string;
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface InputModalState extends Required<InputModalOptions> {
  resolve: (value: string | null) => void;
}

export const useInputModal = () => {
  const [inputModalState, setInputModalState] = useState<InputModalState | null>(null);
  const [inputModalValue, setInputModalValue] = useState('');

  const prompt = useCallback((defaultValue = '', options: InputModalOptions = {}): Promise<string | null> => {
    return new Promise(resolve => {
      setInputModalValue(defaultValue);
      setInputModalState({
        title: options.title ?? 'Introduzir valor',
        label: options.label ?? 'Valor:',
        confirmLabel: options.confirmLabel ?? 'OK',
        cancelLabel: options.cancelLabel ?? 'Cancelar',
        resolve,
      });
    });
  }, []);

  const handleInputModalClose = useCallback((result: string | null) => {
    setInputModalState(prev => {
      prev?.resolve(result);
      return null;
    });
  }, []);

  return { prompt, inputModalState, inputModalValue, setInputModalValue, handleInputModalClose };
};
