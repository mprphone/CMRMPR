
import React, { useState, useEffect, useMemo } from 'react';
import { Client, Staff, Task, TurnoverBracket, ClientTaskOverride, TaskArea, AiAnalysis, InsurancePolicy } from '../types';
import { calculateClientProfitability } from '../services/calculator';
import { analyzeClientWithAI } from '../services/geminiService';
import { 
  ArrowLeft, BrainCircuit, Activity, Building, University, Wallet, AlertCircle, CheckCircle, Phone, MapPin, FileText, Plus, Trash2, Save, User, Clock, Users, RefreshCcw, BadgeEuro, Shield,
  FileCheck, Receipt, BarChart3, Building2, Target, Globe, MessageSquare, PieChart, Presentation, TrendingUp
} from 'lucide-react';

interface ClientDetailProps {
  client: Client;
  tasks: Task[];
  areaCosts: Record<string, number>;
  staff: Staff[];
  turnoverBrackets: TurnoverBracket[];
  onBack: () => void;
  onUpdateClient: (client: Client) => Promise<void>;
  insurancePolicies: InsurancePolicy[];
  userRole: 'admin' | 'user' | null;
}

const ClientDetail: React.FC<ClientDetailProps> = ({ client, tasks, areaCosts, staff, turnoverBrackets, onBack, onUpdateClient, insurancePolicies, userRole }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'tasks'>('general');
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(client.aiAnalysisCache || null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  
  // Local state for editing tasks
  const [editedClient, setEditedClient] = useState<Client>(client);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sync when prop changes
  useEffect(() => {
    setEditedClient(client);
    setAiAnalysis(client.aiAnalysisCache || null);
    setIsDirty(false);
  }, [client]);

  // Real-time calculation based on edited state
  const stats = calculateClientProfitability(editedClient, tasks, areaCosts as Record<TaskArea, number>, staff, turnoverBrackets);

  // Group tasks by Area for rendering
  const tasksByArea = useMemo(() => {
    return tasks.reduce((acc, task) => {
        if (!acc[task.area]) acc[task.area] = [];
        acc[task.area].push(task);
        return acc;
    }, {} as Record<string, Task[]>);
  }, [tasks]);

  const responsibleStaffName = useMemo(() => {
    if (!client.responsibleStaff) return 'Não Atribuído';
    // After import, responsibleStaff can be a UUID. We need to find the name.
    // A simple check for UUID is the presence of a hyphen.
    if (client.responsibleStaff.includes('-')) {
        const s = staff.find(s => s.id === client.responsibleStaff);
        return s?.name || 'Responsável Desconhecido';
    }
    return client.responsibleStaff; // It's already a name.
  }, [client.responsibleStaff, staff]);

  const insuranceCount = useMemo(() => {
    return insurancePolicies.filter(p => p.clientId === client.id).length;
  }, [insurancePolicies, client.id]);

  // Calculate Staff Distribution for this Client
  const staffDistribution = useMemo(() => {
    const distribution: Record<string, { name: string, hours: number }> = {};
    
    // Initialize with 0
    staff.forEach(s => {
      distribution[s.id] = { name: s.name, hours: 0 };
    });

    // 1. Task Hours
    editedClient.tasks.forEach(ct => {
      const task = tasks.find(t => t.id === ct.taskId);
      if (task) {
        const hours = (task.defaultTimeMinutes * ct.multiplier * ct.frequencyPerYear) / 60;
        let staffIdToCredit: string | undefined = undefined;
        
        if (ct.assignedStaffId) {
          staffIdToCredit = ct.assignedStaffId;
        } else {
          const responsible = staff.find(s => s.id === editedClient.responsibleStaff || s.name === editedClient.responsibleStaff);
          if (responsible) staffIdToCredit = responsible.id;
        }
        
        if (staffIdToCredit && distribution[staffIdToCredit]) {
          distribution[staffIdToCredit].hours += hours;
        }
      }
    });

    // 2. Operational Hours (Calls/Travel) -> Default to Responsible
    const responsible = staff.find(s => s.id === editedClient.responsibleStaff || s.name === editedClient.responsibleStaff);
    if (responsible) {
      const opHours = (editedClient.callTimeBalance * 12 / 60) + editedClient.travelCount;
      if (distribution[responsible.id]) distribution[responsible.id].hours += opHours;
    }

    // Filter out zero entries and sort
    return Object.entries(distribution)
      .map(([id, data]) => ({ id, ...data }))
      .filter(item => item.hours > 0)
      .sort((a, b) => b.hours - a.hours);
  }, [editedClient, tasks, staff]);

  const handleAiAnalysis = async () => {
    setIsLoadingAi(true);
    setAiAnalysis(null);
    // Pass a client object to the AI with the resolved staff name, not the ID
    const clientForAI = {
      ...editedClient,
      responsibleStaff: responsibleStaffName
    };
    try {
        const advice = await analyzeClientWithAI(clientForAI, stats);
        setAiAnalysis(advice);
        setEditedClient(prev => ({ ...prev, aiAnalysisCache: advice }));
        setIsDirty(true);
    } catch (err: any) {
        alert("Falha na IA: " + err.message + "\nVerifique se a chave GEMINI_API_KEY foi configurada nos 'Secrets' do seu projeto Supabase.");
        console.error(err);
    } finally {
        setIsLoadingAi(false);
    }
  };

  // --- Task Editing Handlers ---

  const handleUpdateTask = (taskId: string, field: keyof ClientTaskOverride, value: any) => {
    const existingOverride = editedClient.tasks.find(t => t.taskId === taskId);
    let newTasks = [...editedClient.tasks];

    if (existingOverride) {
      // Update existing override
      newTasks = newTasks.map(t => t.taskId === taskId ? { ...t, [field]: value } : t);
    } else {
      // Create new override if it doesn't exist
      const taskDef = tasks.find(t => t.id === taskId);
      if (!taskDef) return;

      const newOverride: ClientTaskOverride = {
        taskId: taskId,
        frequencyPerYear: taskDef.defaultFrequencyPerYear,
        multiplier: 0, // Start with 0, the edit will set the first value
        assignedStaffId: undefined,
      };
      
      (newOverride as any)[field] = value;
      newTasks.push(newOverride);
    }
    
    setEditedClient({ ...editedClient, tasks: newTasks });
    setIsDirty(true);
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      await onUpdateClient(editedClient);
      setIsDirty(false);
      // The success message is good, but an alert is fine for now.
      alert('Alterações salvas com sucesso!');
    } catch (error) {
      // Error is handled in App.tsx, but good to log it here too.
      console.error("Save failed in ClientDetail:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{client.name}</h2>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">{client.id}</span>
              <span>• {client.sector}</span>
              <span>• {client.nif}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <MapPin size={12} />
              <span>{editedClient.address || 'Morada não definida'}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isDirty && (
            <button 
              onClick={handleSaveChanges}
              disabled={isSaving}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:animate-none animate-pulse"
            >
              {isSaving ? <RefreshCcw size={18} className="animate-spin"/> : <Save size={18} />} {isSaving ? 'Gravando...' : 'Salvar Alterações'}
            </button>
          )}
          <div className="text-right">
             <p className="text-xs text-slate-400">Responsável Principal</p>
             <p className="font-bold text-slate-700">{responsibleStaffName}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('general')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'general'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Visão Geral e Rentabilidade
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tasks'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Tarefas & Equipa Executante
          </button>
        </nav>
      </div>

      {/* TAB 1: GENERAL */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {userRole === 'admin' && (
            /* KPI Cards */
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 font-medium">Receita Anual</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{stats.totalAnnualRevenue.toFixed(0)}€</p>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 font-medium">Custo Operacional</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{stats.totalAnnualCost.toFixed(0)}€</p>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500 font-medium">Horas Anuais</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{stats.totalAnnualHours.toFixed(1)}h</p>
              </div>
              <div className={`p-4 rounded-xl shadow-sm border ${stats.profitability < 15 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                <p className={`text-xs font-medium ${stats.profitability < 15 ? 'text-red-600' : 'text-green-600'}`}>Margem de Lucro</p>
                <p className={`text-xl font-bold mt-1 ${stats.profitability < 15 ? 'text-red-700' : 'text-green-700'}`}>
                  {stats.profitability.toFixed(1)}%
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Operational Data */}
            <div className={`lg:col-span-${userRole === 'admin' ? '1' : '3'} bg-white p-6 rounded-xl shadow-sm border border-slate-100`}>
               <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                 <Activity size={18} className="text-slate-500"/> Dados Operacionais
               </h3>
               <div className="space-y-4 mb-6">
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><Wallet size={14}/> Avença Mensal</span>
                    <input 
                      type="number" 
                      value={editedClient.monthlyFee} 
                      onChange={e => {setEditedClient({...editedClient, monthlyFee: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-24 text-right border border-slate-200 rounded px-2 py-1 text-sm font-bold text-blue-600"
                    />
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><BadgeEuro size={14}/> Vol. Negócios Anual</span>
                    <input 
                      type="number" 
                      value={editedClient.turnover} 
                      onChange={e => {setEditedClient({...editedClient, turnover: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-24 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
               </div>
               <div className="space-y-1 mb-4">
                  <label className="text-sm text-slate-500 flex items-center gap-2"><MapPin size={14}/> Morada</label>
                  <input 
                    type="text" 
                    placeholder="Rua, Nº, Código Postal"
                    value={editedClient.address || ''} 
                    onChange={e => {setEditedClient({...editedClient, address: e.target.value}); setIsDirty(true);}}
                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm font-medium"
                  />
               </div>
               <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><FileText size={14}/> Docs Mensais</span>
                    <input 
                      type="number" 
                      value={editedClient.documentCount} 
                      onChange={e => {setEditedClient({...editedClient, documentCount: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><Building size={14}/> Estabelecimentos</span>
                    <input 
                      type="number" 
                      value={editedClient.establishments} 
                      onChange={e => {setEditedClient({...editedClient, establishments: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><University size={14}/> Bancos</span>
                    <input 
                      type="number" 
                      value={editedClient.banks} 
                      onChange={e => {setEditedClient({...editedClient, banks: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><Users size={14}/> N.º Funcionários</span>
                    <input 
                      type="number" 
                      value={editedClient.employeeCount} 
                      onChange={e => {setEditedClient({...editedClient, employeeCount: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><Shield size={14}/> N.º Seguros</span>
                    <span className="w-20 text-right font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded text-sm">
                      {insuranceCount}
                    </span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><Phone size={14}/> Apoio (min/mês)</span>
                    <input 
                      type="number" 
                      value={editedClient.callTimeBalance} 
                      onChange={e => {setEditedClient({...editedClient, callTimeBalance: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500 flex items-center gap-2"><MapPin size={14}/> Deslocações/Ano</span>
                    <input 
                      type="number" 
                      value={editedClient.travelCount} 
                      onChange={e => {setEditedClient({...editedClient, travelCount: Number(e.target.value)}); setIsDirty(true);}}
                      className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    />
                 </div>

                 <div className="border-t border-slate-100 my-4"></div>

                 <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-2"><Building2 size={14}/> N.º Fornecedores</span>
                      <input type="number" value={editedClient.supplierCount || 0} onChange={e => {setEditedClient({...editedClient, supplierCount: Number(e.target.value)}); setIsDirty(true);}} className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium" />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-2"><Users size={14}/> N.º Clientes</span>
                      <input type="number" value={editedClient.customerCount || 0} onChange={e => {setEditedClient({...editedClient, customerCount: Number(e.target.value)}); setIsDirty(true);}} className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium" />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-2"><MessageSquare size={14}/> Comunicações/mês</span>
                      <input type="number" value={editedClient.communicationCount || 0} onChange={e => {setEditedClient({...editedClient, communicationCount: Number(e.target.value)}); setIsDirty(true);}} className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium" />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-2"><Presentation size={14}/> Reuniões/ano</span>
                      <input type="number" value={editedClient.meetingCount || 0} onChange={e => {setEditedClient({...editedClient, meetingCount: Number(e.target.value)}); setIsDirty(true);}} className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium" />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-2"><TrendingUp size={14}/> Lucro Ano Anterior</span>
                      <input type="number" value={editedClient.previousYearProfit || 0} onChange={e => {setEditedClient({...editedClient, previousYearProfit: Number(e.target.value)}); setIsDirty(true);}} className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-sm font-medium" />
                    </div>
                 </div>

                 <div className="border-t border-slate-100 my-4"></div>

                 <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><FileCheck size={14}/> Docs Organizados</span>
                        <input type="checkbox" checked={editedClient.deliversOrganizedDocs ?? true} onChange={e => {setEditedClient({...editedClient, deliversOrganizedDocs: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><Receipt size={14}/> Reembolsos IVA</span>
                        <input type="checkbox" checked={editedClient.vatRefunds ?? false} onChange={e => {setEditedClient({...editedClient, vatRefunds: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><BarChart3 size={14}/> Reporte INE</span>
                        <input type="checkbox" checked={editedClient.hasIneReport ?? false} onChange={e => {setEditedClient({...editedClient, hasIneReport: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><Target size={14}/> Centros de Custo</span>
                        <input type="checkbox" checked={editedClient.hasCostCenters ?? false} onChange={e => {setEditedClient({...editedClient, hasCostCenters: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><Globe size={14}/> Op. Internacionais</span>
                        <input type="checkbox" checked={editedClient.hasInternationalOps ?? false} onChange={e => {setEditedClient({...editedClient, hasInternationalOps: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-sm cursor-pointer">
                        <span className="text-slate-500 flex items-center gap-2"><PieChart size={14}/> Mapas de Gestão</span>
                        <input type="checkbox" checked={editedClient.hasManagementReports ?? false} onChange={e => {setEditedClient({...editedClient, hasManagementReports: e.target.checked}); setIsDirty(true);}} className="rounded text-blue-600 focus:ring-blue-500" />
                    </label>
                 </div>
               </div>
            </div>

            {userRole === 'admin' && (
              <div className="lg:col-span-2 space-y-6">
                {/* Turnover / Fair Value Analysis */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Wallet size={18} className="text-blue-500"/> Análise de Ajuste da Avença
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Volume de Negócios (Editável)</p>
                      <p className="text-2xl font-bold text-slate-700 mb-4">{editedClient.turnover.toLocaleString()}€</p>
                      
                      <p className="text-xs text-slate-400 mb-1">Avença (Editável)</p>
                      <p className="text-xl font-semibold text-slate-700">{editedClient.monthlyFee.toFixed(2)}€ <span className="text-xs font-normal text-slate-400">/mês</span></p>
                    </div>
                    
                    <div className="bg-slate-50 p-4 rounded-lg">
                      {stats.turnoverAnalysis ? (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-600">Diagnóstico:</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              stats.turnoverAnalysis.status === 'Subavaliado' ? 'bg-red-100 text-red-600' :
                              stats.turnoverAnalysis.status === 'Acima da Média' ? 'bg-green-100 text-green-600' :
                              'bg-blue-100 text-blue-600'
                            }`}>
                              {stats.turnoverAnalysis.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mb-3">
                            Com base no volume de negócios, a tabela recomenda:
                          </p>
                          <div className="flex justify-between items-end border-b border-slate-200 pb-2 mb-2">
                            <span className="text-xs text-slate-500">Mínimo Recomendado:</span>
                            <span className="font-bold text-slate-700">{stats.turnoverAnalysis.minRecommendedFee.toFixed(2)}€</span>
                          </div>
                          <div className="flex justify-between items-end">
                            <span className="text-xs text-slate-500">Máximo Recomendado:</span>
                            <span className="font-bold text-slate-700">{stats.turnoverAnalysis.maxRecommendedFee.toFixed(2)}€</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400 italic">Sem dados de tabela para este volume de negócios.</p>
                      )}
                    </div>
                  </div>
                </div>
                {/* AI Advisor */}
                <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-6 rounded-xl border border-indigo-100">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                      <BrainCircuit size={20} className="text-indigo-600"/> AccounTech AI Advisor
                    </h3>
                    <button 
                      onClick={handleAiAnalysis}
                      disabled={isLoadingAi}
                      className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {isLoadingAi ? 'Analisando...' : (aiAnalysis ? 'Gerar Nova Análise' : 'Gerar Análise')}
                    </button>
                  </div>
                  
                  {aiAnalysis ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                      <div className="md:col-span-2 prose prose-sm text-slate-700 max-w-none">
                        <p className="whitespace-pre-line leading-relaxed">{aiAnalysis.parecer}</p>
                      </div>
                      <div className="bg-white/50 p-4 rounded-lg border border-indigo-200 text-center">
                        <p className="text-[10px] font-bold text-indigo-500 uppercase">Avença Sugerida pela IA</p>
                        <p className="text-3xl font-black text-indigo-800 my-1">{aiAnalysis.avenca_sugerida.toFixed(0)}€</p>
                        <p className="text-[10px] text-indigo-400">Valor mensal, sem IVA</p>
                      </div>
                    </div>
                  ) : (
                    !isLoadingAi && (
                      <p className="text-sm text-indigo-400 italic">
                        Clique para obter um parecer estratégico e uma sugestão de avença. A análise será guardada.
                      </p>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TASK MANAGEMENT */}
      {activeTab === 'tasks' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
           {/* Left Column: Task List */}
           <div className={`lg:col-span-${userRole === 'admin' ? '3' : '4'} space-y-4`}>
              {Object.entries(tasksByArea).map(([area, areaTasks]) => (
                <div key={area} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b border-slate-100">
                      <h3 className="font-bold text-slate-700">{area}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                        <tr>
                          <th className="px-4 py-3">Tarefa</th>
                          <th className="px-4 py-3 text-center">Freq/Ano</th>
                          <th className="px-4 py-3 text-center">Multiplicador</th>
                          <th className="px-4 py-3">Funcionário Executante</th>
                          <th className="px-4 py-3 text-right">Horas/Ano</th>
                          {userRole === 'admin' && <th className="px-4 py-3 text-right">Custo/Ano</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {areaTasks.map((taskDef) => {
                          const ct = editedClient.tasks.find(t => t.taskId === taskDef.id);
                          
                          let effectiveMultiplier = 0;
                          const isLogicBased = !ct?.multiplier && taskDef.multiplierLogic && taskDef.multiplierLogic !== 'manual';

                          if (isLogicBased) {
                            effectiveMultiplier = (editedClient[taskDef.multiplierLogic as keyof Client] as number) || 0;
                          } else {
                            effectiveMultiplier = ct?.multiplier || 0;
                          }
                          
                          let hourlyRate = 0;
                          if (ct?.assignedStaffId) {
                              const s = staff.find(st => st.id === ct.assignedStaffId);
                              hourlyRate = s ? s.hourlyCost : (areaCosts[taskDef.area] || 25);
                          } else {
                              const responsible = staff.find(s => s.id === editedClient.responsibleStaff || s.name === editedClient.responsibleStaff);
                              hourlyRate = responsible ? responsible.hourlyCost : (areaCosts[taskDef.area] || 25);
                          }

                          const currentMultiplier = effectiveMultiplier;
                          const currentFrequency = ct?.frequencyPerYear || taskDef.defaultFrequencyPerYear;
                          const annualHours = (taskDef.defaultTimeMinutes * currentMultiplier * currentFrequency) / 60;
                          const annualCost = annualHours * hourlyRate;

                          return (
                            <tr key={taskDef.id} className={`hover:bg-slate-50 transition-opacity ${currentMultiplier === 0 ? 'opacity-50' : ''}`}>
                              <td className="px-4 py-3 font-medium text-slate-700">
                                {taskDef.name}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <input 
                                  type="number" 
                                  min="0"
                                  className="w-16 text-center border border-slate-200 rounded py-1 text-xs"
                                  value={currentFrequency}
                                  onChange={(e) => handleUpdateTask(taskDef.id, 'frequencyPerYear', Number(e.target.value))}
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                  <input 
                                  type="number" 
                                  min="0"
                                  className={`w-20 text-center border rounded py-1 text-xs ${isLogicBased ? 'bg-slate-100 text-slate-500 italic' : 'bg-white'}`}
                                  value={currentMultiplier}
                                  onChange={(e) => handleUpdateTask(taskDef.id, 'multiplier', Number(e.target.value))}
                                  title={isLogicBased ? `Valor automático: ${taskDef.multiplierLogic}` : 'Multiplicador manual'}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <select
                                    className={`text-xs border-slate-200 rounded py-1 max-w-[180px] ${ct?.assignedStaffId ? 'bg-blue-50 font-medium text-blue-700 border-blue-200' : 'text-slate-500'}`}
                                    value={ct?.assignedStaffId || ''}
                                    onChange={(e) => handleUpdateTask(taskDef.id, 'assignedStaffId', e.target.value || undefined)}
                                  >
                                    <option value="">{responsibleStaffName} (Padrão)</option>
                                    {staff.map(s => (
                                      <option key={s.id} value={s.id}>{s.name} ({s.hourlyCost.toFixed(0)}€/h)</option>
                                    ))}
                                  </select>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600">
                                {annualHours.toFixed(1)} h
                              </td>
                              {userRole === 'admin' && (
                                <td className="px-4 py-3 text-right font-medium text-slate-700">
                                  {annualCost.toFixed(0)} €
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Operational Tasks Table */}
              {(editedClient.callTimeBalance > 0 || editedClient.travelCount > 0) && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b border-slate-100">
                    <h3 className="font-bold text-slate-700">Operacional</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                        <tr>
                          <th className="px-4 py-3">Tarefa</th>
                          <th className="px-4 py-3 text-center">Freq/Ano</th>
                          <th className="px-4 py-3 text-center">Multiplicador</th>
                          <th className="px-4 py-3">Funcionário Executante</th>
                          <th className="px-4 py-3 text-right">Horas/Ano</th>
                          {userRole === 'admin' && <th className="px-4 py-3 text-right">Custo/Ano</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {editedClient.callTimeBalance > 0 && (
                          <tr className="bg-slate-50/50 italic text-slate-500">
                            <td className="px-4 py-3">Apoio Telefónico ({editedClient.callTimeBalance} min/mês)</td>
                            <td className="px-4 py-3 text-center">12</td>
                            <td className="px-4 py-3 text-center">{editedClient.callTimeBalance} min</td>
                            <td className="px-4 py-3">{responsibleStaffName}</td>
                            <td className="px-4 py-3 text-right">{((editedClient.callTimeBalance * 12) / 60).toFixed(1)} h</td>
                            {userRole === 'admin' && (
                              <td className="px-4 py-3 text-right">{(((editedClient.callTimeBalance * 12) / 60) * stats.usedHourlyRate).toFixed(0)} €</td>
                            )}
                          </tr>
                        )}
                        {editedClient.travelCount > 0 && (
                          <tr className="bg-slate-50/50 italic text-slate-500">
                            <td className="px-4 py-3">Deslocações ({editedClient.travelCount}/ano)</td>
                            <td className="px-4 py-3 text-center">{editedClient.travelCount}</td>
                            <td className="px-4 py-3 text-center">60 min</td>
                            <td className="px-4 py-3">{responsibleStaffName}</td>
                            <td className="px-4 py-3 text-right">{(editedClient.travelCount).toFixed(1)} h</td>
                            {userRole === 'admin' && (
                              <td className="px-4 py-3 text-right">{(editedClient.travelCount * stats.usedHourlyRate).toFixed(0)} €</td>
                            )}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
           </div>

           {/* Right Column: Summaries & Distribution */}
           {userRole === 'admin' && (
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-blue-500"/> Métricas de Tempo
                  </h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                      <span className="text-sm text-slate-500">Total Horas Anuais</span>
                      <span className="font-bold text-slate-700 text-lg">{stats.totalAnnualHours.toFixed(1)} h</span>
                    </div>
                    <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg">
                      <span className="text-sm font-bold text-blue-700">Média Horas / Mês</span>
                      <span className="font-bold text-blue-800 text-xl">{(stats.totalAnnualHours / 12).toFixed(1)} h</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-tight">
                      Utilize a média mensal para comparar com o valor da avença e verificar se o preço/hora é justo.
                    </p>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Users size={18} className="text-green-600"/> Distribuição Equipa
                  </h3>
                  <div className="space-y-3">
                    {staffDistribution.length > 0 ? (
                      staffDistribution.map(item => {
                        const percent = (item.hours / stats.totalAnnualHours) * 100;
                        return (
                          <div key={item.id}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-medium text-slate-700">{item.name}</span>
                              <span className="text-slate-500">{item.hours.toFixed(1)}h ({percent.toFixed(0)}%)</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5">
                              <div 
                                className="bg-green-500 h-1.5 rounded-full" 
                                style={{ width: `${percent}%` }}
                              ></div>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-xs text-slate-400 italic">Sem horas atribuídas.</p>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-4 italic">
                    * Horas anuais estimadas por funcionário baseadas nas tarefas atribuídas.
                  </p>
                </div>

                {isDirty && (
                  <button 
                    onClick={handleSaveChanges}
                    disabled={isSaving}
                    className="w-full bg-green-600 text-white px-4 py-3 rounded-xl hover:bg-green-700 flex justify-center items-center gap-2 shadow-lg disabled:opacity-50 disabled:animate-none animate-pulse font-bold"
                  >
                    {isSaving ? <RefreshCcw size={20} className="animate-spin"/> : <Save size={20} />} {isSaving ? 'Gravando...' : 'Salvar Alterações'}
                  </button>
                )}
            </div>
           )}
        </div>
      )}
    </div>
  );
};

export default ClientDetail;
