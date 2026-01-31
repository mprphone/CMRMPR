
import React from 'react';
import { LayoutDashboard, Users, Calculator, Settings, ListTodo, Briefcase, Upload, FolderTree, Mail, Shield, HeartPulse, LogOut } from 'lucide-react';
import { ensureStoreClient } from '../services/supabase';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  logo: string;
  onLogoUpload: (logo: string) => void;
  userRole: 'admin' | 'user' | null;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, logo, onLogoUpload, userRole }) => {
  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin'] },
    { id: 'clients', label: 'Clientes', icon: Users, roles: ['admin', 'user'] },
    { id: 'groups', label: 'Grupos Avenças', icon: FolderTree, roles: ['admin'] },
    { id: 'insurance', label: 'Seguros', icon: Shield, roles: ['admin', 'user'] },
    { id: 'sht', label: 'SHT', icon: HeartPulse, roles: ['admin', 'user'] },
    { id: 'emails', label: 'Email Marketing', icon: Mail, roles: ['admin'] },
    { id: 'team', label: 'Equipa', icon: Briefcase, roles: ['admin'] },
    { id: 'tasks', label: 'Catálogo Tarefas', icon: ListTodo, roles: ['admin', 'user'] },
    { id: 'calculator', label: 'Orçamentador', icon: Calculator, roles: ['admin'] },
  ];

  const menuItems = allMenuItems.filter(item => userRole && item.roles.includes(userRole));

  const handleLogout = async () => {
    const supabase = ensureStoreClient();
    await supabase.auth.signOut();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { if (reader.result) onLogoUpload(reader.result as string); };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen flex flex-col fixed left-0 top-0 z-10">
      <div className="h-24 border-b border-slate-800 bg-white relative group">
        <input type="file" id="sidebar-logo-upload" accept="image/*" className="hidden" onChange={handleFileChange} />
        <label htmlFor="sidebar-logo-upload" className="w-full h-full flex items-center justify-center p-4 cursor-pointer">
          {logo && <img src={logo} alt="Logo" className="max-h-full max-w-full object-contain transition-opacity group-hover:opacity-50" />}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
             <div className="bg-slate-900/80 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1">
               <Upload size={10} /> Alterar Logo
             </div>
          </div>
        </label>
      </div>
      
      <nav className="flex-1 py-6">
        <ul className="space-y-1 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onChangeView(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon size={20} />
                  <span className="font-medium text-sm">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-slate-800">
        {userRole === 'admin' && (
          <button onClick={() => onChangeView('settings')} className={`w-full flex items-center space-x-3 px-4 py-2 rounded ${currentView === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <Settings size={18} />
            <span className="text-xs font-medium">Configurações</span>
          </button>
        )}
        <button onClick={handleLogout} className="w-full flex items-center space-x-3 px-4 py-2 rounded text-slate-400 hover:text-white hover:bg-slate-800 mt-2">
          <LogOut size={18} />
          <span className="text-xs font-medium">Sair</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
