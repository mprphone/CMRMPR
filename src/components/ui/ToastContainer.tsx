import React from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastItem, ToastType } from '../../hooks/useToast';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="flex-shrink-0" />,
  error: <AlertCircle size={18} className="flex-shrink-0" />,
  warning: <AlertTriangle size={18} className="flex-shrink-0" />,
  info: <Info size={18} className="flex-shrink-0" />,
};

const styles: Record<ToastType, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-slate-800 text-white',
};

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg pointer-events-auto ${styles[t.type]}`}
        >
          {icons[t.type]}
          <span className="text-sm font-medium flex-1 leading-snug">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="opacity-70 hover:opacity-100 flex-shrink-0 mt-0.5">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
