import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastApi {
  show: (tone: ToastTone, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** `const toast = useToast(); toast.success('Published v3')` — needs <ToastProvider> above. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
