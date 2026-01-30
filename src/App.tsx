import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ClientList from './components/ClientList';
import ClientDetail from './components/ClientDetail';
import StaffTeam from './components/StaffTeam';
import StaffDetail from './components/StaffDetail';
import Tasks from './components/Tasks';
import Calculator from './components/Calculator';
import Settings from './components/Settings';
import EmailCampaigns from './components/EmailCampaigns';
import FeeGroups from './components/FeeGroups';
import { DEFAULT_TASKS, DEFAULT_AREA_COSTS, DEFAULT_TURNOVER_BRACKETS } from './constants';
import { Client, Staff, Task, GlobalSettings, FeeGroup, EmailTemplate, CampaignHistory, TurnoverBracket, QuoteHistory } from './types';
import { clientService, staffService, groupService, templateService, campaignHistoryService, turnoverBracketService, quoteHistoryService, initSupabase } from './services/supabase';
import { RefreshCcw, DownloadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [groups, setGroups] = useState<FeeGroup[]>([]);
  const [tasks, setTasks] = useState<Task[]>(DEFAULT_TASKS);
  const [areaCosts, setAreaCosts] = useState<Record<string, number>>(DEFAULT_AREA_COSTS);
  const [turnoverBrackets, setTurnoverBrackets] = useState<TurnoverBracket[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistory[]>([]);
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistory[]>([]);
  const [logo, setLogo] = useState(() => localStorage.getItem('appLogo') || '');

  const handleLogoUpload = (newLogo: string) => {
    setLogo(newLogo);
    localStorage.setItem('appLogo', newLogo);
  };

  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(() => {
    const saved = localStorage.getItem('globalSettings');
    return saved ? JSON.parse(saved) : {
      supabaseImportUrl: import.meta.env.VITE_SUPABASE_URL_IMPORT || '',
      supabaseImportKey: import.meta.env.VITE_SUPABASE_KEY_IMPORT || '',
      supabaseStoreUrl: import.meta.env.VITE_SUPABASE_URL_CMR || '',
      supabaseStoreKey: import.meta.env.VITE_SUPABASE_KEY_CMR || '',
      payrollUnitCost: 2.5,
      documentUnitCost: 0.15,
      resendApiKey: '',
      fromEmail: '',
      fromName: '',
      emailSignature: ''
    };
  });

  useEffect(() => {
    initSupabase(globalSettings);
    fetchData();
  }, [globalSettings]);

  useEffect(() => {
    localStorage.setItem('globalSettings', JSON.stringify(globalSettings));
  }, [globalSettings]);

  const fetchData = async () => {
    setIsLoadingData(true);
    try {
      // Forçar leitura limpa do servidor de GESTÃO
      const [c, s, g, t, h, b, qh] = await Promise.all([
        clientService.getAll(),
        staffService.getAll(),
        groupService.getAll(),
        templateService.getAll(),
        campaignHistoryService.getAll(),
        turnoverBracketService.getAll(),
        quoteHistoryService.getAll()
      ]);
      setClients(c || []);
      setStaff(s || []);
      setGroups(g || []);
      setTemplates(t || []);
      setCampaignHistory(h || []);
      setQuoteHistory(qh || []);
      if (b && b.length > 0) {
        setTurnoverBrackets(b);
      } else {
        setTurnoverBrackets(DEFAULT_TURNOVER_BRACKETS);
      }
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleUpdateClient = async (updatedClient: Client) => {
    try {
      const savedClient = await clientService.upsert(updatedClient);
      // Update the local state for immediate UI feedback
      setClients(clients.map(c => c.id === savedClient.id ? savedClient : c));
      // Also update the selectedClient to reflect the changes if it's the one being edited
      setSelectedClient(savedClient);
    } catch (err: any) {
      console.error("Erro ao gravar cliente:", err);
      alert("Falha ao gravar as alterações do cliente: " + err.message);
    }
  };

  const handleUpdateStaff = async (updatedStaff: Staff) => {
    try {
      const savedStaff = await staffService.upsert(updatedStaff);
      setStaff(staff.map(s => s.id === savedStaff.id ? savedStaff : s));
      setSelectedStaff(savedStaff); // Keep the detail view open with updated data
    } catch (err: any) {
      console.error("Erro ao gravar funcionário:", err);
      alert("Falha ao gravar as alterações do funcionário: " + err.message);
    }
  };

  const handleFullSync = async () => {
    setIsSyncing(true);
    try {
      // 1. Staff
      const externalStaff = await staffService.importExternalStaff();
      if (externalStaff.length > 0) await staffService.bulkUpsert(externalStaff);

      // 2. Clientes
      const externalClients = await clientService.importExternalClients();
      if (externalClients.length > 0) {
        await clientService.bulkUpsert(externalClients);
      }
      
      // 3. AGUARDAR E RECARREGAR
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fetchData();
      
      setSyncSuccess(`Sucesso! ${externalClients.length} clientes processados.`);
      setTimeout(() => setSyncSuccess(null), 5000);
    } catch (err: any) {
      alert("Falha na sincronização: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar 
        currentView={currentView} 
        onChangeView={(view) => { setCurrentView(view); setSelectedClient(null); setSelectedStaff(null); }}
        logo={logo} onLogoUpload={handleLogoUpload}
      />

      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-end mb-6 gap-2">
            <button 
              onClick={handleFullSync}
              disabled={isSyncing}
              className="flex items-center gap-2 text-[10px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 hover:bg-blue-100 uppercase shadow-sm"
            >
              {isSyncing ? <RefreshCcw size={14} className="animate-spin"/> : <DownloadCloud size={14}/>}
              Sincronizar Agora
            </button>
            <button onClick={fetchData} className="p-2 bg-white border border-slate-100 rounded-xl text-slate-400 hover:text-blue-600 transition-colors">
              <RefreshCcw size={14} />
            </button>
          </div>

          {syncSuccess && (
            <div className="mb-4 p-4 bg-green-50 border border-green-100 text-green-700 rounded-xl text-xs font-bold flex items-center gap-2 animate-bounce">
              <CheckCircle2 size={16} /> {syncSuccess}
            </div>
          )}

          {/* Fallback se a lista estiver vazia */}
          {isLoadingData && !isSyncing ? (
            <div className="bg-white border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
              <RefreshCcw className="mx-auto text-blue-500 mb-4 animate-spin" size={40} />
              <h3 className="text-lg font-bold text-slate-800">A carregar dados...</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
                A ligar ao servidor de gestão para obter a informação mais recente.
              </p>
            </div>
          ) : clients.length === 0 && !isSyncing && (
            <div className="bg-white border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
              <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
              <h3 className="text-lg font-bold text-slate-800">Ainda não há clientes visíveis</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
                Se já sincronizou os seus clientes, clique no botão de recarregar. Se o problema persistir, verifique as suas configurações de ligação ao Supabase.
              </p>
              <button onClick={fetchData} className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 mx-auto">
                <RefreshCcw size={14} /> Tentar recarregar dados
              </button>
            </div>
          )}

          {selectedClient ? (
            <ClientDetail 
              client={selectedClient} 
              onBack={() => setSelectedClient(null)} 
              staff={staff} tasks={tasks} areaCosts={areaCosts}
              turnoverBrackets={turnoverBrackets}
              onUpdateClient={handleUpdateClient}
            />
          ) : selectedStaff ? (
            <StaffDetail
              staffMember={selectedStaff}
              onBack={() => setSelectedStaff(null)}
              clients={clients}
              tasks={tasks}
              staff={staff}
              areaCosts={areaCosts}
              onUpdateStaff={handleUpdateStaff}
            />
          ) : (
            <>
              {currentView === 'dashboard' && <Dashboard clients={clients} tasks={tasks} areaCosts={areaCosts} staff={staff} />}
              {currentView === 'clients' && (
                <ClientList 
                  clients={clients} setClients={setClients}
                  staff={staff} groups={groups} tasks={tasks} areaCosts={areaCosts}
                  onSelectClient={setSelectedClient}
                  onSyncClientsRequest={handleFullSync}
                />
              )}
              {currentView === 'emails' && (
                <EmailCampaigns 
                  clients={clients} groups={groups} staff={staff} 
                  templates={templates} setTemplates={setTemplates}
                  globalSettings={globalSettings}
                  history={campaignHistory} setHistory={setCampaignHistory}
                />
              )}
              {currentView === 'groups' && (
                <FeeGroups 
                  groups={groups} setGroups={setGroups} 
                  clients={clients} setClients={setClients} 
                  onSelectClient={setSelectedClient}
                  tasks={tasks} staff={staff} areaCosts={areaCosts}
                />
              )}
              {currentView === 'team' && (
                <StaffTeam 
                  staff={staff} setStaff={setStaff} 
                  clients={clients} tasks={tasks} 
                  onSelectStaff={setSelectedStaff}
                  onSyncRequest={handleFullSync}
                  areaCosts={areaCosts}
                />
              )}
              {currentView === 'tasks' && <Tasks tasks={tasks} setTasks={setTasks} />}
              {currentView === 'calculator' && (
                <Calculator 
                  tasks={tasks} firmHourlyCost={40} logo={logo} 
                  turnoverBrackets={turnoverBrackets} 
                  globalSettings={globalSettings}
                  quoteHistory={quoteHistory}
                  setQuoteHistory={setQuoteHistory}
                />
              )}
              {currentView === 'settings' && (
                <Settings 
                  areaCosts={areaCosts} setAreaCosts={setAreaCosts}
                  turnoverBrackets={turnoverBrackets} setTurnoverBrackets={setTurnoverBrackets}
                  globalSettings={globalSettings} setGlobalSettings={setGlobalSettings}
                  logo={logo} setLogo={handleLogoUpload}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Overlay de carregamento */}
      {isSyncing && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
            <RefreshCcw className="animate-spin text-blue-600" size={40} />
            <p className="font-black text-slate-800 uppercase tracking-tight">A atualizar a sua base de gestão...</p>
          </div>
        </div>
      )}
    </div>
  );
}