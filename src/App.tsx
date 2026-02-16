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
  clientService, staffService, groupService, templateService, campaignHistoryService, turnoverBracketService, quoteHistoryService, insuranceService, workSafetyService, initSupabase, storeClient, cashPaymentService, cashAgreementService, cashOperationService, brandingService, appConfigService, taskCatalogService, APP_CONFIG_GLOBAL_SETTINGS_KEY
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

const areSettingsEqual = (a: GlobalSettings, b: GlobalSettings) => JSON.stringify(a) === JSON.stringify(b);
const areTasksEqual = (a: Task[], b: Task[]) => JSON.stringify(a) === JSON.stringify(b);

const mergeRemoteGlobalSettings = (localSettings: GlobalSettings, remoteSettings: Partial<GlobalSettings>): GlobalSettings => ({
  ...localSettings,
  ...remoteSettings,
  supabaseImportUrl: localSettings.supabaseImportUrl,
  supabaseImportKey: localSettings.supabaseImportKey,
  supabaseStoreUrl: localSettings.supabaseStoreUrl,
  supabaseStoreKey: localSettings.supabaseStoreKey,
});

const PAULA_INSURANCE_ONLY_EMAIL = 'paula.ernestina@hotmail.com';

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
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
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
  const globalSettingsVersionRef = React.useRef<string | null>(null);
  const taskCatalogVersionRef = React.useRef<string | null>(null);
  const skipNextGlobalSettingsSaveRef = React.useRef(false);
  const skipNextTaskCatalogSaveRef = React.useRef(false);
  const warningTimeoutRef = React.useRef<number | null>(null);
  const realtimeSettingsRefreshTimerRef = React.useRef<number | null>(null);
  const realtimeTasksRefreshTimerRef = React.useRef<number | null>(null);

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

  const showSyncWarning = (message: string) => {
    setSyncWarning(message);
    if (warningTimeoutRef.current) {
      window.clearTimeout(warningTimeoutRef.current);
    }
    warningTimeoutRef.current = window.setTimeout(() => setSyncWarning(null), 12000);
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
  const [isGlobalSettingsHydrated, setIsGlobalSettingsHydrated] = useState(false);
  const [isGlobalSettingsDbAvailable, setIsGlobalSettingsDbAvailable] = useState(true);
  const [isTaskCatalogHydrated, setIsTaskCatalogHydrated] = useState(false);
  const [isTaskCatalogDbAvailable, setIsTaskCatalogDbAvailable] = useState(true);
  const currentUserEmail = (session?.user?.email || '').trim().toLowerCase();
  const isPaulaInsuranceOnlyUser = currentUserEmail === PAULA_INSURANCE_ONLY_EMAIL;
  const allowedViews = isPaulaInsuranceOnlyUser ? ['insurance'] : undefined;
  const activeView = isPaulaInsuranceOnlyUser ? 'insurance' : currentView;

  useEffect(() => {
    initSupabase(globalSettings);
    fetchData();
  }, [
    globalSettings.supabaseImportUrl,
    globalSettings.supabaseImportKey,
    globalSettings.supabaseStoreUrl,
    globalSettings.supabaseStoreKey,
  ]);

  useEffect(() => {
    localStorage.setItem('globalSettings', JSON.stringify(globalSettings));
  }, [globalSettings]);

  useEffect(() => {
    return () => {
      if (warningTimeoutRef.current) {
        window.clearTimeout(warningTimeoutRef.current);
      }
      if (realtimeSettingsRefreshTimerRef.current) {
        window.clearTimeout(realtimeSettingsRefreshTimerRef.current);
      }
      if (realtimeTasksRefreshTimerRef.current) {
        window.clearTimeout(realtimeTasksRefreshTimerRef.current);
      }
    };
  }, []);

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
    if (!session) return;
    let isMounted = true;

    const hydrateSharedSettings = async () => {
      try {
        const remoteSettings = await appConfigService.getGlobalSettingsWithMeta();
        if (!isMounted) return;
        setIsGlobalSettingsDbAvailable(true);

        if (remoteSettings) {
          globalSettingsVersionRef.current = remoteSettings.updatedAt;
          setGlobalSettings(prev => {
            const mergedSettings = mergeRemoteGlobalSettings(prev, remoteSettings.value);
            if (areSettingsEqual(prev, mergedSettings)) return prev;
            skipNextGlobalSettingsSaveRef.current = true;
            return mergedSettings;
          });
        } else {
          const savedSettings = await appConfigService.upsertGlobalSettingsWithConflict(globalSettings, null);
          if (!isMounted) return;
          globalSettingsVersionRef.current = savedSettings.updatedAt;
        }
      } catch (err) {
        console.error('Erro ao sincronizar configurações globais:', err);
        if (isMounted) setIsGlobalSettingsDbAvailable(false);
      } finally {
        if (isMounted) setIsGlobalSettingsHydrated(true);
      }
    };

    const hydrateTaskCatalog = async () => {
      try {
        const remoteTasks = await taskCatalogService.getAllWithVersion();
        if (!isMounted) return;
        setIsTaskCatalogDbAvailable(true);

        if (remoteTasks.tasks.length > 0) {
          taskCatalogVersionRef.current = remoteTasks.version;
          setTasks(prev => {
            if (areTasksEqual(prev, remoteTasks.tasks)) return prev;
            skipNextTaskCatalogSaveRef.current = true;
            return remoteTasks.tasks;
          });
        } else {
          const savedTasks = await taskCatalogService.replaceAllWithConflict(tasks, null);
          if (!isMounted) return;
          taskCatalogVersionRef.current = savedTasks.version;
        }
      } catch (err) {
        console.error('Erro ao sincronizar catálogo de tarefas:', err);
        if (isMounted) setIsTaskCatalogDbAvailable(false);
      } finally {
        if (isMounted) setIsTaskCatalogHydrated(true);
      }
    };

    hydrateSharedSettings();
    hydrateTaskCatalog();

    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    localStorage.setItem('appTasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (!session || !isGlobalSettingsHydrated || !isGlobalSettingsDbAvailable) return;
    if (skipNextGlobalSettingsSaveRef.current) {
      skipNextGlobalSettingsSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const saveResult = await appConfigService.upsertGlobalSettingsWithConflict(
          globalSettings,
          globalSettingsVersionRef.current
        );
        globalSettingsVersionRef.current = saveResult.updatedAt;

        if (saveResult.conflict) {
          showSyncWarning('Conflito detetado nas configurações globais. Foram carregadas as alterações mais recentes.');
          setGlobalSettings(prev => {
            const merged = mergeRemoteGlobalSettings(prev, saveResult.value);
            if (areSettingsEqual(prev, merged)) return prev;
            skipNextGlobalSettingsSaveRef.current = true;
            return merged;
          });
        }
      } catch (err) {
        console.error('Erro ao gravar configurações globais na cloud:', err);
        setIsGlobalSettingsDbAvailable(false);
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [session, globalSettings, isGlobalSettingsHydrated, isGlobalSettingsDbAvailable]);

  useEffect(() => {
    if (!session || !isTaskCatalogHydrated || !isTaskCatalogDbAvailable) return;
    if (skipNextTaskCatalogSaveRef.current) {
      skipNextTaskCatalogSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const saveResult = await taskCatalogService.replaceAllWithConflict(tasks, taskCatalogVersionRef.current);
        taskCatalogVersionRef.current = saveResult.version;

        if (saveResult.conflict) {
          showSyncWarning('Conflito detetado no catálogo de tarefas. Foi carregada a versão mais recente.');
          setTasks(prev => {
            if (areTasksEqual(prev, saveResult.tasks)) return prev;
            skipNextTaskCatalogSaveRef.current = true;
            return saveResult.tasks;
          });
        }
      } catch (err) {
        console.error('Erro ao gravar catálogo de tarefas na cloud:', err);
        setIsTaskCatalogDbAvailable(false);
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [session, tasks, isTaskCatalogHydrated, isTaskCatalogDbAvailable]);

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

  useEffect(() => {
    if (!session || !storeClient || !isGlobalSettingsHydrated || !isTaskCatalogHydrated) return;

    const settingsChannel = storeClient
      .channel(`app-config-global-settings-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_config',
          filter: `key=eq.${APP_CONFIG_GLOBAL_SETTINGS_KEY}`,
        },
        () => {
          if (realtimeSettingsRefreshTimerRef.current) {
            window.clearTimeout(realtimeSettingsRefreshTimerRef.current);
          }

          realtimeSettingsRefreshTimerRef.current = window.setTimeout(async () => {
            try {
              const remoteSettings = await appConfigService.getGlobalSettingsWithMeta();
              if (!remoteSettings) return;

              setIsGlobalSettingsDbAvailable(true);
              globalSettingsVersionRef.current = remoteSettings.updatedAt;

              let didChange = false;
              setGlobalSettings(prev => {
                const merged = mergeRemoteGlobalSettings(prev, remoteSettings.value);
                if (areSettingsEqual(prev, merged)) return prev;
                didChange = true;
                skipNextGlobalSettingsSaveRef.current = true;
                return merged;
              });

              if (didChange) {
                showSyncWarning('Configurações globais atualizadas em tempo real.');
              }
            } catch (err) {
              console.error('Erro ao processar atualização realtime de configurações:', err);
            } finally {
              realtimeSettingsRefreshTimerRef.current = null;
            }
          }, 250);
        }
      )
      .subscribe();

    const tasksChannel = storeClient
      .channel(`app-tasks-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_tasks',
        },
        () => {
          if (realtimeTasksRefreshTimerRef.current) {
            window.clearTimeout(realtimeTasksRefreshTimerRef.current);
          }

          realtimeTasksRefreshTimerRef.current = window.setTimeout(async () => {
            try {
              const remoteTasks = await taskCatalogService.getAllWithVersion();
              setIsTaskCatalogDbAvailable(true);
              taskCatalogVersionRef.current = remoteTasks.version;

              let didChange = false;
              setTasks(prev => {
                if (areTasksEqual(prev, remoteTasks.tasks)) return prev;
                didChange = true;
                skipNextTaskCatalogSaveRef.current = true;
                return remoteTasks.tasks;
              });

              if (didChange) {
                showSyncWarning('Catálogo de tarefas atualizado em tempo real.');
              }
            } catch (err) {
              console.error('Erro ao processar atualização realtime de tarefas:', err);
            } finally {
              realtimeTasksRefreshTimerRef.current = null;
            }
          }, 250);
        }
      )
      .subscribe();

    return () => {
      if (realtimeSettingsRefreshTimerRef.current) {
        window.clearTimeout(realtimeSettingsRefreshTimerRef.current);
        realtimeSettingsRefreshTimerRef.current = null;
      }
      if (realtimeTasksRefreshTimerRef.current) {
        window.clearTimeout(realtimeTasksRefreshTimerRef.current);
        realtimeTasksRefreshTimerRef.current = null;
      }
      storeClient.removeChannel(settingsChannel);
      storeClient.removeChannel(tasksChannel);
    };
  }, [session, storeClient, isGlobalSettingsHydrated, isTaskCatalogHydrated]);

  useEffect(() => {
    if (!isPaulaInsuranceOnlyUser) return;
    if (currentView !== 'insurance') {
      setCurrentView('insurance');
    }
    if (selectedClient) {
      setSelectedClient(null);
    }
    if (selectedStaff) {
      setSelectedStaff(null);
    }
  }, [isPaulaInsuranceOnlyUser, currentView, selectedClient, selectedStaff]);

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
        currentView={activeView} 
        onChangeView={(view) => {
          if (allowedViews && !allowedViews.includes(view)) return;
          setCurrentView(view);
          setSelectedClient(null);
          setSelectedStaff(null);
        }}
        logo={logo} onLogoUpload={handleLogoUpload}
        userRole={userRole}
        allowedViews={allowedViews}
      />

      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">
          {!isPaulaInsuranceOnlyUser && (
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
          )}

          {syncSuccess && (
            <div className="mb-4 p-4 bg-green-50 border border-green-100 text-green-700 rounded-xl text-xs font-bold flex items-center gap-2 animate-bounce">
              <CheckCircle2 size={16} /> {syncSuccess}
            </div>
          )}

          {syncWarning && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-100 text-amber-700 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertTriangle size={16} /> {syncWarning}
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
          ) : clients.length === 0 && !isSyncing && !isPaulaInsuranceOnlyUser && (
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

          {!isPaulaInsuranceOnlyUser && selectedClient ? (
            <ClientDetail 
              client={selectedClient} 
              onBack={() => setSelectedClient(null)} 
              staff={staff} tasks={tasks} areaCosts={areaCosts}
              turnoverBrackets={turnoverBrackets}
              onUpdateClient={handleUpdateClient}
              userRole={userRole}
              insurancePolicies={insurancePolicies}
            />
          ) : !isPaulaInsuranceOnlyUser && selectedStaff ? (
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
              {activeView === 'dashboard' && <Dashboard clients={clients} tasks={tasks} areaCosts={areaCosts} staff={staff} />}
              {activeView === 'clients' && (
                <ClientList 
                  clients={clients} setClients={setClients}
                  staff={staff} groups={groups} tasks={tasks} areaCosts={areaCosts}
                  onSelectClient={setSelectedClient}
                  onSyncClientsRequest={handleFullSync}
                />
              )}
              {activeView === 'emails' && (
                <EmailCampaigns 
                  clients={clients} groups={groups} staff={staff} 
                  templates={templates} setTemplates={setTemplates}
                  globalSettings={globalSettings}
                  history={campaignHistory} setHistory={setCampaignHistory}
                />
              )}
              {activeView === 'insurance' && (
                <Insurance
                  policies={insurancePolicies} setPolicies={setInsurancePolicies}
                  clients={clients}
                  forcedAgent={isPaulaInsuranceOnlyUser ? 'Paula' : undefined}
                />
              )}
              {activeView === 'sht' && (
                <WorkSafety
                  services={workSafetyServices} setServices={setWorkSafetyServices}
                  clients={clients}
                />
              )}
              {activeView === 'cashier' && (
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
              {activeView === 'groups' && (
                <FeeGroups 
                  groups={groups} setGroups={setGroups} 
                  clients={clients} setClients={setClients} 
                  onSelectClient={setSelectedClient}
                  tasks={tasks} staff={staff} areaCosts={areaCosts}
                  turnoverBrackets={turnoverBrackets}
                />
              )}
              {activeView === 'team' && (
                <StaffTeam 
                  staff={staff} setStaff={setStaff} 
                  clients={clients} tasks={tasks} 
                  onSelectStaff={setSelectedStaff}
                  onSyncRequest={handleFullSync}
                  areaCosts={areaCosts}
                />
              )}
              {activeView === 'tasks' && <Tasks tasks={tasks} setTasks={setTasks} />}
              {activeView === 'calculator' && (
                <Calculator 
                  tasks={tasks} logo={logo} 
                  turnoverBrackets={turnoverBrackets} 
                  areaCosts={areaCosts}
                  globalSettings={globalSettings}
                  quoteHistory={quoteHistory}
                  setQuoteHistory={setQuoteHistory}
                />
              )}
              {activeView === 'settings' && (
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

