import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Session } from '@supabase/supabase-js';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import MfaChallenge from './components/MfaChallenge';
import { DEFAULT_TASKS, DEFAULT_AREA_COSTS, DEFAULT_TURNOVER_BRACKETS } from './constants';
import {
  Client, Staff, Task, GlobalSettings, FeeGroup, EmailTemplate, CampaignHistory, TurnoverBracket, QuoteHistory, InsurancePolicy, WorkSafetyService, CashPayment, CashAgreement, CashOperation
} from './types';
import {
  clientService, staffService, groupService, templateService, campaignHistoryService, turnoverBracketService, quoteHistoryService, insuranceService, workSafetyService, initSupabase, storeClient, cashPaymentService, cashAgreementService, cashOperationService, brandingService, appConfigService, taskCatalogService, APP_CONFIG_GLOBAL_SETTINGS_KEY,
  syncWamprData, accessControlService, systemHealthService
} from './services';
import { RefreshCcw, DownloadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';
import { usePwaInstall } from './hooks/usePwaInstall';
import { getAccessibleViews, hasAppPermission, UserAccessProfile } from './accessControl';

const Dashboard = lazy(() => import('./components/Dashboard'));
const ClientList = lazy(() => import('./components/ClientList'));
const ClientDetail = lazy(() => import('./components/ClientDetail'));
const BillingControl = lazy(() => import('./components/BillingControl'));
const StaffTeam = lazy(() => import('./components/StaffTeam'));
const StaffDetail = lazy(() => import('./components/StaffDetail'));
const Tasks = lazy(() => import('./components/Tasks'));
const Calculator = lazy(() => import('./components/Calculator'));
const Settings = lazy(() => import('./components/Settings'));
const EmailCampaigns = lazy(() => import('./components/EmailCampaigns'));
const FeeGroups = lazy(() => import('./components/FeeGroups'));
const Insurance = lazy(() => import('./components/Insurance'));
const WorkSafety = lazy(() => import('./components/WorkSafety'));
const Cashier = lazy(() => import('./components/Cashier'));
const IrsControl = lazy(() => import('./components/IrsControl'));

const ViewLoadingFallback = () => (
  <div className="bg-white border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
    <RefreshCcw className="mx-auto text-blue-500 mb-4 animate-spin" size={40} />
    <h3 className="text-lg font-bold text-slate-800">A carregar...</h3>
  </div>
);

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
const isLegacySupabaseImportDisabled = String(import.meta.env.VITE_DISABLE_SUPABASE_IMPORT || '').toLowerCase() === 'true';

const mergeRemoteGlobalSettings = (localSettings: GlobalSettings, remoteSettings: Partial<GlobalSettings>): GlobalSettings => ({
  ...localSettings,
  ...remoteSettings,
  supabaseImportUrl: isLegacySupabaseImportDisabled ? '' : localSettings.supabaseImportUrl,
  supabaseImportKey: isLegacySupabaseImportDisabled ? '' : localSettings.supabaseImportKey,
  supabaseStoreUrl: localSettings.supabaseStoreUrl,
  supabaseStoreKey: localSettings.supabaseStoreKey,
});

const readJsonStorage = <T,>(key: string, fallback: T): T => {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) as T : fallback;
  } catch (error) {
    console.error(`Valor inválido em localStorage["${key}"]; a usar fallback:`, error);
    return fallback;
  }
};

export default function App() {
  const { canInstall, isInstalled, install } = usePwaInstall();
  const [showInstallTip, setShowInstallTip] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');
  const [session, setSession] = useState<Session | null>(null);
  const [accessProfile, setAccessProfile] = useState<UserAccessProfile | null>(null);
  const [isLoadingAccess, setIsLoadingAccess] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<'checking' | 'required' | 'satisfied'>('checking');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [groups, setGroups] = useState<FeeGroup[]>([]);
  const [tasks, setTasks] = useState<Task[]>(() => readJsonStorage('appTasks', DEFAULT_TASKS));
  const [areaCosts, setAreaCosts] = useState<Record<string, number>>(DEFAULT_AREA_COSTS);
  const [turnoverBrackets, setTurnoverBrackets] = useState<TurnoverBracket[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [systemWarning, setSystemWarning] = useState<string | null>(null);
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
    if (!canEditSettings) {
      alert('Esta conta não tem permissão para alterar o logótipo.');
      return;
    }
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
    const settings = readJsonStorage('globalSettings', {
      supabaseImportUrl: import.meta.env.VITE_SUPABASE_URL_IMPORT || '',
      supabaseImportKey: import.meta.env.VITE_SUPABASE_KEY_IMPORT || '',
      supabaseStoreUrl: import.meta.env.VITE_SUPABASE_URL_CMR || '',
      supabaseStoreKey: import.meta.env.VITE_SUPABASE_KEY_CMR || '',
      payrollUnitCost: 2.5,
      documentUnitCost: 0.15,
      fromEmail: '',
      fromName: '',
      emailSignature: ''
    });
    return isLegacySupabaseImportDisabled
      ? { ...settings, supabaseImportUrl: '', supabaseImportKey: '' }
      : settings;
  });
  const [isGlobalSettingsHydrated, setIsGlobalSettingsHydrated] = useState(false);
  const [isGlobalSettingsDbAvailable, setIsGlobalSettingsDbAvailable] = useState(true);
  const [isTaskCatalogHydrated, setIsTaskCatalogHydrated] = useState(false);
  const [isTaskCatalogDbAvailable, setIsTaskCatalogDbAvailable] = useState(true);
  const allowedViews = React.useMemo(() => getAccessibleViews(accessProfile), [accessProfile]);
  const isInsuranceScopedUser = accessProfile?.dataScope === 'insurance_own';
  const activeView = allowedViews.includes(currentView) ? currentView : (allowedViews[0] || currentView);
  const userRole: 'admin' | 'user' | null = accessProfile
    ? (accessProfile.canViewFinancial ? 'admin' : 'user')
    : null;
  const canEditSettings = hasAppPermission(accessProfile, 'settings', 'edit');
  const canViewSettings = hasAppPermission(accessProfile, 'settings', 'view');

  useEffect(() => {
    initSupabase(globalSettings);
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
  const verifiedSessionUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!storeClient) return;

    const { data: { subscription } } = storeClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      const nextUserId = session?.user?.id ?? null;
      // Só reinicia a verificação de MFA quando o utilizador da sessão muda
      // de facto (novo login/logout). Qualquer outro evento do Supabase
      // Auth para a MESMA sessão (refresh de token automático, o browser a
      // voltar a ficar visível/em foco, etc.) não deve voltar a mostrar o
      // ecrã "A verificar a segurança da sessão..." nem desmontar a app —
      // isso já foi verificado e perdia formulários/ecrãs abertos.
      if (nextUserId !== verifiedSessionUserIdRef.current) {
        verifiedSessionUserIdRef.current = nextUserId;
        setMfaState(session ? 'checking' : 'checking');
      }
      if (!session) {
        setAccessProfile(null);
        setAccessError(null);
        setIsLoadingAccess(false);
        setIsLoadingData(false);
      }
    });

    // Check for initial session
    storeClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      verifiedSessionUserIdRef.current = session?.user?.id ?? null;
      setMfaState(session ? 'checking' : 'checking');
      if (!session) {
        setIsLoadingAccess(false);
        setIsLoadingData(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [storeClient]);

  useEffect(() => {
    if (!session || !storeClient) return;
    let cancelled = false;
    storeClient.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data, error }) => {
        if (error) throw error;
        if (!cancelled) {
          setMfaState(data.nextLevel === 'aal2' && data.currentLevel !== 'aal2' ? 'required' : 'satisfied');
        }
      })
      .catch(error => {
        console.error('Erro ao verificar MFA:', error);
        if (!cancelled) setMfaState('required');
      });
    return () => { cancelled = true; };
  }, [session?.access_token, storeClient]);

  useEffect(() => {
    if (!session || mfaState !== 'satisfied') return;
    let cancelled = false;

    const loadAccessAndData = async () => {
      setIsLoadingAccess(true);
      setAccessError(null);
      try {
        const profile = await accessControlService.getMyProfile();
        if (!profile?.active) {
          throw new Error('Esta conta não tem acesso ativo ao CMR. Contacte um administrador.');
        }
        if (cancelled) return;
        setAccessProfile(profile);
        const views = getAccessibleViews(profile);
        if (views.length === 0) {
          throw new Error('Esta conta não tem módulos autorizados. Contacte um administrador.');
        }
        setCurrentView(previous => views.includes(previous) ? previous : views[0]);
        await fetchData();
      } catch (error: any) {
        if (cancelled) return;
        setAccessProfile(null);
        setAccessError(error?.message || 'Não foi possível validar as permissões desta conta.');
        setIsLoadingData(false);
      } finally {
        if (!cancelled) setIsLoadingAccess(false);
      }
    };

    void loadAccessAndData();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, mfaState]);

  useEffect(() => {
    if (!session || !accessProfile || !canViewSettings || mfaState !== 'satisfied') {
      setSystemWarning(null);
      return;
    }
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const health = await systemHealthService.get();
        if (!cancelled) {
          setSystemWarning(health.warnings.length > 0
            ? `${health.warnings[0]} Consulte Configurações → Estado e proteção dos dados.`
            : null);
        }
      } catch (error) {
        console.error('Erro ao verificar o estado do sistema:', error);
        if (!cancelled) setSystemWarning('Não foi possível verificar o backup e a ligação ao WAPRO. Consulte Configurações.');
      }
    };
    void checkHealth();
    const timer = window.setInterval(() => void checkHealth(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.access_token, accessProfile?.updatedAt, canViewSettings, mfaState]);

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
    if (!session || !canEditSettings || !isGlobalSettingsHydrated || !isGlobalSettingsDbAvailable) return;
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
  }, [session, canEditSettings, globalSettings, isGlobalSettingsHydrated, isGlobalSettingsDbAvailable]);

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
    if (!accessProfile) return;
    if (!allowedViews.includes(currentView) && allowedViews[0]) {
      setCurrentView(allowedViews[0]);
      setSelectedClient(null);
      setSelectedStaff(null);
    }
  }, [accessProfile, allowedViews, currentView]);

  const fetchData = async () => {
    setIsLoadingData(true);

    if (!storeClient) {
      alert("Configuração do Servidor de Gestão em falta ou inválida. Verifique as configurações.");
      setIsLoadingData(false);
      return;
    }

    // Carregamos cada um individualmente para que se um falhar, os outros apareçam
    const clientsPromise = clientService.getAll().catch(e => { console.error("Erro Clientes:", e); return []; });
    const staffPromise = staffService.getAll().catch(e => { console.error("Erro Staff:", e); return []; });
    const groupsPromise = groupService.getAll().catch(e => { console.error("Erro Grupos:", e); return []; });
    const templatesPromise = templateService.getAll().catch(e => { console.error("Erro Templates:", e); return []; });
    const campaignHistoryPromise = campaignHistoryService.getAll().catch(e => { console.error("Erro Histórico Campanhas:", e); return []; });
    const quoteHistoryPromise = quoteHistoryService.getAll().catch(e => { console.error("Erro Histórico Propostas:", e); return []; });
    const insurancePromise = insuranceService.getAll().catch(e => { console.error("Erro Seguros:", e); return []; });
    const shtPromise = workSafetyService.getAll().catch(e => { console.error("Erro SHT:", e); return []; });
    const bracketsPromise = turnoverBracketService.getAll().catch(e => { console.error("Erro Patamares:", e); return []; });
    const cashPaymentsPromise = cashPaymentService.getAll().catch(e => { console.error("Erro Pagamentos Caixa:", e); return []; });
    const cashAgreementsPromise = cashAgreementService.getAll().catch(e => { console.error("Erro Acordos Caixa:", e); return []; });
    const cashOperationsPromise = cashOperationService.getAll().catch(e => { console.error("Erro Operações Caixa:", e); return []; });

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
    setStaff(staffData);
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
    if (!accessProfile?.canSyncWampr) {
      alert('Esta conta não tem permissão para executar a sincronização WAPRO → CMR.');
      return;
    }
    setIsSyncing(true);
    try {
      const result = await syncWamprData();
      const clientsProcessed = Number(result?.counts?.clients || 0);
      const staffProcessed = Number(result?.counts?.staff || 0);
      setSyncSuccess(`Sincronização direta concluída: ${clientsProcessed} clientes e ${staffProcessed} funcionários processados.`);
      setTimeout(() => setSyncSuccess(null), 10000);
      await fetchData();
    } catch (err: any) {
      alert("Falha na sincronização: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!session) {
    return <Login />;
  }

  if (mfaState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 p-8 rounded-2xl shadow-sm text-center">
          <RefreshCcw className="mx-auto text-blue-500 mb-4 animate-spin" size={36} />
          <p className="font-bold text-slate-800">A verificar a segurança da sessão...</p>
        </div>
      </div>
    );
  }

  if (mfaState === 'required') {
    return <MfaChallenge onVerified={() => setMfaState('satisfied')} />;
  }

  if (isLoadingAccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 p-8 rounded-2xl shadow-sm text-center">
          <RefreshCcw className="mx-auto text-blue-500 mb-4 animate-spin" size={36} />
          <p className="font-bold text-slate-800">A validar permissões...</p>
        </div>
      </div>
    );
  }

  if (accessError || !accessProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg bg-white border border-red-100 p-8 rounded-2xl shadow-sm text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-4" size={36} />
          <h2 className="text-lg font-bold text-slate-800">Acesso não autorizado</h2>
          <p className="text-sm text-slate-500 mt-2">{accessError || 'Não foi possível validar esta conta.'}</p>
          <button
            onClick={() => void storeClient?.auth.signOut()}
            className="mt-6 bg-slate-900 text-white px-5 py-2 rounded-lg text-sm font-bold"
          >
            Voltar ao início de sessão
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <Sidebar 
        currentView={activeView} 
        onChangeView={(view) => {
          if (!allowedViews.includes(view)) return;
          setCurrentView(view);
          setSelectedClient(null);
          setSelectedStaff(null);
        }}
        logo={logo} onLogoUpload={handleLogoUpload}
        canUploadLogo={canEditSettings}
        allowedViews={allowedViews}
        userEmail={session.user.email}
      />

      <main className="flex-1 p-2 md:p-4">
        <div className="w-full max-w-[1800px] mx-auto">
          {!isInsuranceScopedUser && activeView !== 'clients' && activeView !== 'insurance' && activeView !== 'billing' && (
            <div className="mb-4 flex justify-end gap-2">
              {!isInstalled && (
                <div className="relative">
                  <button
                    onClick={async () => {
                      if (canInstall) {
                        await install();
                        return;
                      }
                      setShowInstallTip(true);
                      setTimeout(() => setShowInstallTip(false), 6000);
                    }}
                    className="flex items-center gap-2 text-[10px] font-black text-slate-700 bg-white px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 uppercase shadow-sm"
                  >
                    Instalar aplicação
                  </button>
                  {showInstallTip && (
                    <div className="absolute right-0 top-10 z-50 w-72 bg-slate-800 text-white text-xs rounded-xl px-4 py-3 shadow-xl">
                      <p className="font-bold mb-1">Para instalar como app:</p>
                      <p className="text-slate-300 mt-1">{'Abra o menu do browser e escolha "Instalar aplicacao", ou clique no icone de instalacao na barra de enderecos.'}</p>
                    </div>
                  )}
                </div>
              )}
              {accessProfile.canSyncWampr && (
                <button
                  onClick={handleFullSync}
                  disabled={isSyncing}
                  className="flex items-center gap-2 text-[10px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 hover:bg-blue-100 uppercase shadow-sm"
                >
                  {isSyncing ? <RefreshCcw size={14} className="animate-spin"/> : <DownloadCloud size={14}/>}
                  Sincronizar Agora
                </button>
              )}
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

          {systemWarning && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertTriangle size={16} /> {systemWarning}
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
          ) : clients.length === 0 && !isSyncing && !isInsuranceScopedUser && (
            <div className="bg-white border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
              <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
              <h3 className="text-lg font-bold text-slate-800">Ainda não há clientes visíveis</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
                Se os clientes já existem no WAPRO, clique em recarregar. Se o problema persistir, confirme a sincronização local WAPRO → CMR.
              </p>
              <button onClick={fetchData} className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 mx-auto">
                <RefreshCcw size={14} /> Tentar recarregar dados
              </button>
            </div>
          )}

          <Suspense fallback={<ViewLoadingFallback />}>
          {!isInsuranceScopedUser && selectedClient ? (
            <ClientDetail
              client={selectedClient} 
              onBack={() => setSelectedClient(null)} 
              staff={staff} tasks={tasks} areaCosts={areaCosts}
              turnoverBrackets={turnoverBrackets}
              onUpdateClient={handleUpdateClient}
              userRole={userRole}
              insurancePolicies={insurancePolicies}
            />
          ) : !isInsuranceScopedUser && selectedStaff ? (
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
                  canSyncWampr={accessProfile.canSyncWampr}
                  canViewFinancial={accessProfile.canViewFinancial}
                  canCreateClients={hasAppPermission(accessProfile, 'clients', 'create')}
                  isSyncingClients={isSyncing}
                  ownStaffId={accessProfile.staffId}
                  isResponsibleStaffLocked={accessProfile.dataScope === 'assigned'}
                />
              )}
              {activeView === 'billing' && <BillingControl clients={clients} setClients={setClients} />}
              {activeView === 'emails' && (
                <EmailCampaigns
                  clients={clients} groups={groups} staff={staff}
                  templates={templates} setTemplates={setTemplates}
                  globalSettings={globalSettings}
                  history={campaignHistory} setHistory={setCampaignHistory}
                  accessProfile={accessProfile}
                />
              )}
              {activeView === 'insurance' && (
                <Insurance
                  policies={insurancePolicies} setPolicies={setInsurancePolicies}
                  clients={clients}
                  forcedAgent={isInsuranceScopedUser ? accessProfile.insuranceAgent || undefined : undefined}
                  canViewCommissions={accessProfile.canViewCommissions}
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
              {activeView === 'irs-control' && (
                <IrsControl
                  clients={clients}
                  setClients={setClients}
                  groups={groups}
                  setGroups={setGroups}
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
                  clients={clients}
                  groups={groups}
                  staff={staff}
                  currentAccessProfile={accessProfile}
                  onCurrentAccessProfileChanged={setAccessProfile}
                />
              )}
            </>
          )}
          </Suspense>
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
