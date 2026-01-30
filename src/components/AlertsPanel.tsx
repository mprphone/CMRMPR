import React from 'react';
import { AppNotification } from '../types';
import { AlertTriangle, Info, BellRing, Calendar, ChevronRight } from 'lucide-react';

interface AlertsPanelProps {
  notifications: AppNotification[];
}

const AlertsPanel: React.FC<AlertsPanelProps> = ({ notifications }) => {
  if (notifications.length === 0) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertTriangle className="text-red-500" size={20} />;
      case 'warning': return <BellRing className="text-orange-500" size={20} />;
      case 'info': return <Calendar className="text-blue-500" size={20} />;
      case 'success': return <Info className="text-green-500" size={20} />;
      default: return <Info className="text-slate-500" size={20} />;
    }
  };

  const getBgColor = (type: string) => {
    switch (type) {
      case 'critical': return 'bg-red-50 border-red-100';
      case 'warning': return 'bg-orange-50 border-orange-100';
      case 'info': return 'bg-blue-50 border-blue-100';
      case 'success': return 'bg-green-50 border-green-100';
      default: return 'bg-slate-50 border-slate-100';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <BellRing size={18} className="text-slate-500" />
          Alertas e Notificações
          <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{notifications.length}</span>
        </h3>
      </div>
      
      <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto custom-scrollbar">
        {notifications.map((note) => (
          <div key={note.id} className={`p-4 hover:bg-slate-50 transition-colors flex gap-4 ${getBgColor(note.type)} border-l-4`}>
            <div className="mt-0.5 flex-shrink-0">
              {getIcon(note.type)}
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                 <h4 className="text-sm font-semibold text-slate-800">{note.title}</h4>
                 <span className="text-[10px] text-slate-400">{note.date}</span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{note.message}</p>
              {note.actionLabel && (
                <button className="text-xs font-medium text-blue-600 mt-2 hover:underline flex items-center">
                  {note.actionLabel} <ChevronRight size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertsPanel;