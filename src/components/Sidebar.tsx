import React from 'react';
import {
  Briefcase,
  Calculator,
  FolderTree,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Mail,
  ReceiptEuro,
  Settings,
  Shield,
  Upload,
  Users,
} from 'lucide-react';
import { ensureStoreClient } from '../services';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  logo: string;
  onLogoUpload: (file: File) => void | Promise<void>;
  canUploadLogo: boolean;
  allowedViews: string[];
  userEmail?: string;
}

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onChangeView,
  logo,
  onLogoUpload,
  canUploadLogo,
  allowedViews,
  userEmail,
}) => {
  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clientes', shortLabel: 'Clientes', icon: Users },
    { id: 'billing', label: 'Faturação', shortLabel: 'Faturação', icon: ReceiptEuro },
    { id: 'groups', label: 'Grupos Avenças', shortLabel: 'Grupos', icon: FolderTree },
    { id: 'insurance', label: 'Seguros', shortLabel: 'Seguros', icon: Shield },
    { id: 'sht', label: 'SHT', shortLabel: 'SHT', icon: HeartPulse },
    { id: 'cashier', label: 'Caixa Numerário', shortLabel: 'Caixa', icon: Landmark },
    { id: 'irs-control', label: 'Controlo IRS', shortLabel: 'IRS', icon: Landmark },
    { id: 'emails', label: 'Email Marketing', shortLabel: 'Email', icon: Mail },
    { id: 'team', label: 'Equipa', shortLabel: 'Equipa', icon: Briefcase },
    { id: 'tasks', label: 'Catálogo Tarefas', shortLabel: 'Tarefas', icon: ListTodo },
    { id: 'calculator', label: 'Orçamentador', shortLabel: 'Orçamento', icon: Calculator },
    { id: 'settings', label: 'Configurações', shortLabel: 'Config.', icon: Settings },
  ];

  const menuItems = allMenuItems.filter(item => allowedViews.includes(item.id));

  const handleLogout = async () => {
    const supabase = ensureStoreClient();
    await supabase.auth.signOut();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onLogoUpload(file);
    event.target.value = '';
  };

  const accountInitials = (userEmail || 'CMR').slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2 px-2 md:gap-4 md:px-4">
        <div className="group relative flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 shadow-sm">
          {canUploadLogo && (
            <input
              type="file"
              id="header-logo-upload"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          )}
          <label
            htmlFor={canUploadLogo ? 'header-logo-upload' : undefined}
            className={`relative flex h-8 w-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white md:w-24 ${canUploadLogo ? 'cursor-pointer' : ''}`}
            title={canUploadLogo ? 'Alterar logótipo' : undefined}
          >
            {logo ? (
              <img src={logo} alt="MPR Negócios" className="h-full w-full object-contain p-1" />
            ) : (
              <span className="text-xs font-bold text-emerald-700">MPR</span>
            )}
            {canUploadLogo && (
              <span className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Upload size={13} />
              </span>
            )}
          </label>
          <div className="hidden leading-none md:block">
            <div className="text-sm font-semibold text-emerald-700">CMR</div>
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400">Gestão</div>
          </div>
        </div>

        <nav className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center gap-0.5">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  title={item.label}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon size={14} />
                  <span className="hidden 2xl:inline">{item.label}</span>
                  <span className="2xl:hidden">{item.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
            {accountInitials}
          </div>
          <div className="hidden max-w-[150px] lg:block">
            <p className="truncate text-xs font-medium text-slate-900">{userEmail || 'Utilizador CMR'}</p>
            <p className="truncate text-[10px] text-slate-500">Base local MPR</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            title="Terminar sessão"
            aria-label="Terminar sessão"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Sidebar;
