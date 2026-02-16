import React, { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
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
import Login from './components/Login';
import FeeGroups from './components/FeeGroups';
import { DEFAULT_TASKS, DEFAULT_AREA_COSTS, DEFAULT_TURNOVER_BRACKETS, DEFAULT_STAFF } from './constants';
import { 
  Client, Staff, Task, GlobalSettings, FeeGroup, EmailTemplate, CampaignHistory, TurnoverBracket, QuoteHistory, InsurancePolicy, WorkSafetyService, CashPayment, CashAgreement, CashOperation
} from './types';
import { 
  clientService, staffService, groupService, templateService, campaignHistoryService, turnoverBracketService, quoteHistoryService, insuranceService, workSafetyService, initSupabase, storeClient, cashPaymentService, cashAgreementService, cashOperationService, brandingService
} from './services/supabase';
import { RefreshCcw, DownloadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';
import Insurance from './components/Insurance';
import WorkSafety from './components/WorkSafety';
import Cashier from './components/Cashier';

// Polyfill for crypto.randomUUID for non-secure contexts or older browsers
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Basic fallback for environments where crypto.randomUUID is not available
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export default function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [groups, setGroups] = useState<FeeGroup[]>([]);
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('appTasks');
    return saved ? JSON.parse(saved) : DEFAULT_TASKS;
  });
  const [areaCosts, setAreaCosts] = useState<Record<string, number>>(DEFAULT_AREA_COSTS);
  const [turnoverBrackets, setTurnoverBrackets] = useState<TurnoverBracket[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistory[]>([]);
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistory[]>([]);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);
  const [workSafetyServices, setWorkSafetyServices] = useState<WorkSafetyService[]>([]);
  const [cashPayments, setCashPayments] = useState<CashPayment[]>([]);
  const [cashAgreements, setCashAgreements] = useState<CashAgreement[]>([]);
  const [cashOperations, setCashOperations] = useState<CashOperation[]>([]);
  const [logo, setLogo] = useState(() => localStorage.getItem('appLogo') || '');

  const handleLogoUpload = async (file: File) => {
    try {
      const remoteLogoUrl = await brandingService.uploadLogo(file);
      setLogo(remoteLogoUrl);
      localStorage.setItem('appLogo', remoteLogoUrl);
    } catch (err: any) {
      console.error('Erro ao enviar logotipo para o servidor:', err);
      alert('Falha ao guardar logotipo no servidor: ' + (err?.message || 'erro desconhecido'));
    }
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

  // Auth listener
  useEffect(() => {
    if (!storeClient) return;

    const { data: { subscription } } = storeClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user?.email === 'mpr@mpr.pt') {
        setUserRole('admin');
      } else if (session) {
        setUserRole('user');
      } else {
        setUserRole(null);
      }
    });

    // Check for initial session
    storeClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [storeClient]);

  useEffect(() => {
    localStorage.setItem('appTasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (!session) return;
    let isMounted = true;

    const loadRemoteLogo = async () => {
      try {
        const remoteLogoUrl = await brandingService.getLogoUrl();
        if (!isMounted || !remoteLogoUrl) return;
        setLogo(remoteLogoUrl);
        localStorage.setItem('appLogo', remoteLogoUrl);
      } catch (err) {
        console.error('Erro ao carregar logotipo remoto:', err);
      }
    };

    loadRemoteLogo();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const fetchData = async () => {
    setIsLoadingData(true);

    if (!storeClient) {
      alert("ConfiguraÃ§Ã£o do Servidor de GestÃ£o em falta ou invÃ¡lida. Verifique as configuraÃ§Ãµes.");
      setIsLoadingData(false);
      return;
    }

    // Carregamos cada um individualmente para que se um falhar, os outros apareÃ§am
    const clientsPromise = clientService.getAll().catch(e => { console.error("Erro Clientes:", e); return []; });
    const staffPromise = staffService.getAll().catch(e => { console.error("Erro Staff:", e); return []; });
    const groupsPromise = groupService.getAll().catch(e => { console.error("Erro Grupos:", e); return []; });
    const templatesPromise = templateService.getAll().catch(e => { console.error("Erro Templates:", e); return []; });
    const campaignHistoryPromise = campaignHistoryService.getAll().catch(e => { console.error("Erro HistÃ³rico Campanhas:", e); return []; });
    const quoteHistoryPromise = quoteHistoryService.getAll().catch(e => { console.error("Erro HistÃ³rico Propostas:", e); return []; });
    const insurancePromise = insuranceService.getAll().catch(e => { console.error("Erro Seguros:", e); return []; });
    const shtPromise = workSafetyService.getAll().catch(e => { console.error("Erro SHT:", e); return []; });
    const bracketsPromise = turnoverBracketService.getAll().catch(e => { console.error("Erro Patamares:", e); return []; });
    const cashPaymentsPromise = cashPaymentService.getAll().catch(e => { console.error("Erro Pagamentos Caixa:", e); return []; });
    const cashAgreementsPromise = cashAgreementService.getAll().catch(e => { console.error("Erro Acordos Caixa:", e); return []; });
    const cashOperationsPromise = cashOperationService.getAll().catch(e => { console.error("Erro OperaÃ§Ãµes Caixa:", e); return []; });

    const [
      clientsData,
      staffData,
      groupsData,
      templatesData,
      campaignHistoryData,
      quoteHistoryData,
      insuranceData,
      shtData,
      bracketsData,
      cashPaymentsData,
      cashAgreementsData,
      cashOperationsData
    ] = await Promise.all([
      clientsPromise, staffPromise, groupsPromise, templatesPromise, 
      campaignHistoryPromise, quoteHistoryPromise, insurancePromise, shtPromise, bracketsPromise,
      cashPaymentsPromise, cashAgreementsPromise, cashOperationsPromise
    ]);

    setClients(clientsData);
    setStaff(staffData.length > 0 ? staffData : DEFAULT_STAFF);
    setGroups(groupsData);
    setTemplates(templatesData);
    setCampaignHistory(campaignHistoryData);
    setQuoteHistory(quoteHistoryData);
    setInsurancePolicies(insuranceData);
    setWorkSafetyServices(shtData);
    setCashPayments(cashPaymentsData);
    setCashAgreements(cashAgreementsData);
    setCashOperations(cashOperationsData);
    setTurnoverBrackets(
      bracketsData.length > 0 ? bracketsData : DEFAULT_TURNOVER_BRACKETS.map(b => ({ ...b, id: generateUUID() }))
    );

    setIsLoadingData(false);
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
      alert("Falha ao gravar as alteraÃ§Ãµes do cliente: " + err.message);
    }
  };

  const handleUpdateStaff = async (updatedStaff: Staff) => {
    try {
      const savedStaff = await staffService.upsert(updatedStaff);
      setStaff(staff.map(s => s.id === savedStaff.id ? savedStaff : s));
      setSelectedStaff(savedStaff); // Keep the detail view open with updated data
    } catch (err: any) {
      console.error("Erro ao gravar funcionÃ¡rio:", err);
      alert("Falha ao gravar as alteraÃ§Ãµes do funcionÃ¡rio: " + err.message);
    }
  };

  const handleFullSync = async () => {
    setIsSyncing(true);
    try {
      console.log("--- INÃCIO DA SINCROZINAÃ‡ÃƒO ---");
      // 1. Staff
      const externalStaff = await staffService.importExternalStaff();
      console.log("DEBUG: Staff importado (primeiros 3):", externalStaff.slice(0, 3));
      if (externalStaff.length > 0) await staffService.bulkUpsert(externalStaff);

      // 2. Clientes
      const externalClients = await clientService.importExternalClients();
      console.log("DEBUG: Clientes importados (primeiros 3):", externalClients.slice(0, 3));
      if (externalClients.length > 0) {
        // Map responsible staff from import to staff ID (ONLY when it's a valid staff UUID).
        // Rules:
        // - If import has empty responsible -> CLEAR (null)
        // - If import has a valid staff UUID that exists -> SET (uuid)
        // - If import has something else (name/code) -> KEEP existing (do not overwrite)
        const unmatchedRefs = new Set<string>();
        const clientsWithStaffId = externalClients.map(client => {
          const rawResponsible = (client.responsibleStaff || '').trim();

          // Decide action
          let responsibleStaffAction: 'set' | 'clear' | 'keep' = 'keep';
          let responsibleStaff: string = client.responsibleStaff || '';

          if (!rawResponsible) {
            responsibleStaffAction = 'clear';
            responsibleStaff = '';
          } else {
            // Import provides an ID; only accept if it matches a staff member we imported
            const responsible = externalStaff.find(s => s.id === rawResponsible);
            if (responsible) {
              responsibleStaffAction = 'set';
              responsibleStaff = responsible.id;
            } else {
              // Non-empty but not a known UUID -> do not overwrite
              responsibleStaffAction = 'keep';
              unmatchedRefs.add(rawResponsible);
              // Keep whatever was there, but action 'keep' ensures DB won't overwrite
              responsibleStaff = rawResponsible;
            }
          }

          return {
            ...client,
            responsibleStaff,
            // Extra field consumed by clientService.bulkUpsert (not used elsewhere)
            responsibleStaffAction
          } as any;
        });
        await clientService.bulkUpsert(clientsWithStaffId);

        let successMessage = `Sucesso! ${externalClients.length} clientes processados.`;
        if (unmatchedRefs.size > 0) {
          successMessage += ` AtenÃ§Ã£o: os seguintes responsÃ¡veis vindos da origem nÃ£o foram reconhecidos e foram ignorados (mantive o responsÃ¡vel atual no CRM): ${Array.from(unmatchedRefs).join(', ')}`;
        }
        setSyncSuccess(successMessage);
        setTimeout(() => setSyncSuccess(null), 15000); // Longer timeout to read the message
      } else {
        setSyncSuccess(`Sucesso! Nenhum cliente novo para sincronizar.`);
        setTimeout(() => setSyncSuccess(null), 5000);
      }
      
      // 3. AGUARDAR E RECARREGAR
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log("--- FIM DA SINCROZINAÃ‡ÃƒO, A RECARREGAR DADOS ---");
      await fetchData();
    } catch (err: any) {
      alert("Falha na sincronizaÃ§Ã£o: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!session) {
    return <Login />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar 
        currentView={currentView} 
        onChangeView={(view) => { setCurrentView(view); setSelectedClient(null); setSelectedStaff(null); }}
        logo={logo} onLogoUpload={handleLogoUpload}
        userRole={userRole}
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
                A ligar ao servidor de gestÃ£o para obter a informaÃ§Ã£o mais recente.
              </p>
            </div>
          ) : clients.length === 0 && !isSyncing && (
            <div className="bg-white border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
              <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
              <h3 className="text-lg font-bold text-slate-800">Ainda nÃ£o hÃ¡ clientes visÃ­veis</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
                Se jÃ¡ sincronizou os seus clientes, clique no botÃ£o de recarregar. Se o problema persistir, verifique as suas configuraÃ§Ãµes de ligaÃ§Ã£o ao Supabase.
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
              userRole={userRole}
              insurancePolicies={insurancePolicies}
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
              {currentView === 'insurance' && (
                <Insurance
                  policies={insurancePolicies} setPolicies={setInsurancePolicies}
                  clients={clients}
                />
              )}
              {currentView === 'sht' && (
                <WorkSafety
                  services={workSafetyServices} setServices={setWorkSafetyServices}
                  clients={clients}
                />
              )}
              {currentView === 'cashier' && (
                <Cashier
                  clients={clients}
                  groups={groups}
                  cashPayments={cashPayments}
                  setCashPayments={setCashPayments}
                  cashAgreements={cashAgreements}
                  setCashAgreements={setCashAgreements}
                  cashOperations={cashOperations}
                  setCashOperations={setCashOperations}
                />
              )}
              {currentView === 'groups' && (
                <FeeGroups 
                  groups={groups} setGroups={setGroups} 
                  clients={clients} setClients={setClients} 
                  onSelectClient={setSelectedClient}
                  tasks={tasks} staff={staff} areaCosts={areaCosts}
                  turnoverBrackets={turnoverBrackets}
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
                  tasks={tasks} logo={logo} 
                  turnoverBrackets={turnoverBrackets} 
                  areaCosts={areaCosts}
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
                  logo={logo}
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
            <p className="font-black text-slate-800 uppercase tracking-tight">A atualizar a sua base de gestÃ£o...</p>
          </div>
        </div>
      )}
    </div>
  );
}

