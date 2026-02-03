import React, { useState, useMemo, useEffect } from 'react';
import { Client, FeeGroup, Staff, EmailTemplate, CampaignHistory, GlobalSettings } from '../types';
import { Mail, BrainCircuit, Send, Users, Plus, X, RefreshCcw, Save, Trash2, History, Edit2, Search, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { generateTemplateWithAI } from '../services/geminiService';
import { templateService, campaignHistoryService, storeClient } from '../services/supabase';

const clientVariables: (keyof Client)[] = [
  'name', 'nif', 'email', 'phone', 'address', 'sector', 'entityType', 'monthlyFee', 'turnover', 'status', 'contractRenewalDate'
];
const specialVariables = ['responsible_name', 'avenca_atual', 'nova_avenca'];
const allVariables = [...clientVariables, ...specialVariables];

interface EmailCampaignsProps {
  clients: Client[];
  groups: FeeGroup[];
  staff: Staff[];
  templates: EmailTemplate[];
  setTemplates: (templates: EmailTemplate[]) => void;
  history: CampaignHistory[];
  setHistory: (history: CampaignHistory[]) => void;
  globalSettings: GlobalSettings;
}

const EmailCampaigns: React.FC<EmailCampaignsProps> = ({ clients, groups, staff, templates, setTemplates, history, setHistory, globalSettings }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<EmailTemplate> | null>(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState('Profissional');

  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [isRecipientModalOpen, setIsRecipientModalOpen] = useState(false);
  // New states for guardrails
  const [sendDelay, setSendDelay] = useState(500); // Default 0.5s
  const [recipientSearch, setRecipientSearch] = useState('');
  const [campaignResult, setCampaignResult] = useState<{ successCount: number; errorCount: number; details: { name: string; email: string; status: 'success' | 'error'; error?: string }[] } | null>(null);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);

  useEffect(() => {
    // Set initial state from first template if available
    if (templates.length > 0 && !selectedTemplateId) {
      handleTemplateChange(templates[0].id);
    }
  }, [templates]);

  const availableRecipients = useMemo(() => {
    if (selectedGroupId === 'all') {
      return clients;
    }
    const group = groups.find(g => g.id === selectedGroupId);
    return group ? clients.filter(c => group.clientIds.includes(c.id)) : [];
  }, [selectedGroupId, clients, groups]);

  const filteredRecipients = useMemo(() => {
    if (!recipientSearch) return availableRecipients;
    return availableRecipients.filter(c => 
        c.name.toLowerCase().includes(recipientSearch.toLowerCase()) || 
        (c.email && c.email.toLowerCase().includes(recipientSearch.toLowerCase()))
    );
  }, [availableRecipients, recipientSearch]);

  const handleTemplateChange = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplateId(templateId);
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const handleAiAssist = async () => {
    if (!aiTopic) {
      alert("Por favor, insira um tópico para o email.");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateTemplateWithAI(aiTopic, aiTone);
      setEditingTemplate(prev => ({ ...prev, subject: result.subject, body: result.body }));
    } catch (err: any) {
      let detailedError = err.message;
      if (err.context && typeof err.context.json === 'function') {
        const functionError = await err.context.json().catch(() => null);
        if (functionError && functionError.error) detailedError = functionError.error;
        else if (functionError && functionError.message) detailedError = functionError.message;
      }
      if (detailedError.includes('Invalid JWT')) {
          alert("A sua sessão expirou. Por favor, recarregue a página e tente novamente.");
      } else {
        alert("Falha na IA: " + detailedError + "\n\nVerifique se a chave GEMINI_API_KEY foi configurada nos 'Secrets' do seu projeto Supabase.");
      }
      console.error(err);
    } finally {
      setIsGenerating(false);
      setIsAiModalOpen(false);
    }
  };

  const handleSendCampaign = async () => {
    if (selectedRecipients.length === 0) {
      alert("Selecione pelo menos um destinatário.");
      return;
    }
    if (!globalSettings.fromEmail || !globalSettings.fromName) {
      alert("Por favor, configure o seu Nome e Email de Remetente nas Configurações.");
      return;
    }

    // --- New Scheduling Logic ---
    if (isScheduled) {
      if (!scheduleDateTime) {
        alert("Por favor, selecione uma data e hora para o agendamento.");
        return;
      }
      const scheduleDate = new Date(scheduleDateTime);
      if (scheduleDate < new Date()) {
        alert("A data de agendamento não pode ser no passado.");
        return;
      }
      if (!confirm(`Tem a certeza que deseja agendar esta campanha para ${scheduleDate.toLocaleString('pt-PT')} para ${selectedRecipients.length} cliente(s)?`)) {
        return;
      }

      setIsSending(true); // Use isSending for loading state

      const group = groups.find(g => g.id === selectedGroupId);
      const groupName = selectedGroupId === 'all' ? 'Todos os Clientes' : group?.name || 'Grupo Desconhecido';

      // NOTE: The CampaignHistory type and 'campaign_history' table in Supabase
      // must be updated to include: recipient_ids (text[]), scheduled_at (timestamptz), send_delay (int4), template_id (uuid)
      const scheduledCampaign: Partial<CampaignHistory> = {
        subject,
        body,
        recipient_ids: selectedRecipients,
        group_name: groupName,
        status: 'Agendada',
        scheduled_at: scheduleDate.toISOString(),
        send_delay: sendDelay,
        template_id: selectedTemplateId || null,
        recipient_count: selectedRecipients.length,
      };

      try {
        const savedRecord = await campaignHistoryService.create(scheduledCampaign);
        setHistory([savedRecord, ...history]);
        alert(`Campanha agendada com sucesso para ${scheduleDate.toLocaleString('pt-PT')}.\n\nNOTA: É necessário um processo no servidor (cron job) para processar e enviar campanhas agendadas.`);
        setSelectedRecipients([]);
        setIsScheduled(false);
        setScheduleDateTime('');
      } catch (err: any) {
        alert("Falha ao agendar a campanha: " + err.message);
      } finally {
        setIsSending(false);
      }
      return; // End execution here for scheduled campaigns
    }
    
    // --- Existing Immediate Send Logic ---
    if (!confirm(`Tem a certeza que deseja enviar esta campanha para ${selectedRecipients.length} cliente(s)?`)) {
      return;
    }

    setIsSending(true);
    setValidationIssues([]); // Clear issues on send

    // Ensure Supabase session/auth is set for Edge Functions (prevents Invalid JWT / 401)
    try {
      if (!storeClient) throw new Error("Cliente Supabase não inicializado.");
      const { data: { session }, error: sessionErr } = await storeClient.auth.getSession();
      if (sessionErr) throw sessionErr;
      if (!session) throw new Error("Sessão inválida ou expirada. Faça login novamente.");
      storeClient.functions.setAuth(session.access_token);
    } catch (authErr: any) {
      alert(authErr?.message || "Sessão inválida ou expirada. Faça login novamente.");
      setIsSending(false);
      return;
    }

    const recipients = clients.filter(c => selectedRecipients.includes(c.id));
    const invalidEmails = recipients.filter(c => !c.email || !c.email.includes('@'));
    if (invalidEmails.length) {
      alert(`Existem ${invalidEmails.length} destinatário(s) sem email válido. Corrija antes de enviar.`);
      setIsSending(false);
      return;
    }
    let successCount = 0;
    let errorCount = 0;
    const campaignLogs: { name: string; email: string; status: 'success' | 'error'; error?: string }[] = [];
    let jwtError = false;

    const optOutFooter = `<br><br><p style="font-size:10px; color:#999;">Para deixar de receber comunicações de marketing, por favor responda a este email com o assunto "Remover".</p>`;
    for (const client of recipients) {
      // Personalize email for each client
      let responsibleName = 'N/A';
      if (client.responsibleStaff) {
        if (client.responsibleStaff.includes('-')) { const s = staff.find(s => s.id === client.responsibleStaff); responsibleName = s ? s.name : 'Desconhecido'; }
        else { responsibleName = client.responsibleStaff; }
      }
      
      let finalSubject = subject.replace(/{{name}}/g, client.name).replace(/{{responsible_name}}/g, responsibleName);
      let finalBody = body.replace(/{{name}}/g, client.name).replace(/{{responsible_name}}/g, responsibleName);

      try {
        if (!storeClient) throw new Error("Cliente Supabase não inicializado.");
        
        const finalHtml = finalBody.replace(/\n/g, '<br>') + `<br><br>${globalSettings.emailSignature || ''}` + optOutFooter;

        const { error } = await storeClient.functions.invoke('send-email', {
          body: { to: client.email, from: `${globalSettings.fromName} <${globalSettings.fromEmail}>`, subject: finalSubject, html: finalHtml },
        });

        if (error) throw error;

        successCount++;
        campaignLogs.push({ name: client.name, email: client.email, status: 'success' });
      } catch (err: any) {
        let detailedError = err.message;
        if (err.context && typeof err.context.json === 'function') {
          const funcError = await err.context.json().catch(() => null);
          if (funcError && funcError.error) detailedError = funcError.error;
        }

        if (detailedError.includes('Invalid JWT') || detailedError.includes('Sessão inválida')) {
          alert("A sua sessão expirou ou é inválida. A campanha foi interrompida. Por favor, recarregue a página e tente novamente.");
          jwtError = true;
          break; // Stop campaign on auth error
        }

        errorCount++;
        console.error(`Falha ao enviar para ${client.email}:`, detailedError, err);
        campaignLogs.push({ name: client.name, email: client.email, status: 'error', error: detailedError });
      }
      await new Promise(resolve => setTimeout(resolve, sendDelay)); // Use configurable delay
    }
    
    if (jwtError) {
      // Alert was shown in the loop. Just stop the loading state.
      setIsSending(false);
      return;
    }

    const group = groups.find(g => g.id === selectedGroupId);
    const groupName = selectedGroupId === 'all' ? 'Todos os Clientes' : group?.name || 'Grupo Desconhecido';
    const newHistoryRecord: Partial<CampaignHistory> = {
      subject,
      body,
      recipient_count: successCount,
      group_name: groupName,
      status: `Enviada (${successCount} sucesso, ${errorCount} falhas)`
    };

    try {
      const savedRecord = await campaignHistoryService.create(newHistoryRecord);
      // TODO: For more detailed logging, create a `campaign_recipient_logs` table
      // and save each entry from `campaignLogs` here, linked to `savedRecord.id`.
      setHistory([savedRecord, ...history]);
    } catch (err: any) {
      alert("Falha ao gravar o histórico da campanha: " + err.message);
    }

    setCampaignResult({ successCount, errorCount, details: campaignLogs });
    setIsSending(false);
  };

  const handleSendTestEmail = async () => {
    if (availableRecipients.length === 0) {
      alert("Não há clientes na lista de destinatários para usar como exemplo.");
      return;
    }
    if (!globalSettings.fromEmail || !globalSettings.fromName) {
      alert("Por favor, configure o seu Nome e Email de Remetente nas Configurações.");
      return;
    }

    const testClient = availableRecipients[0];
    
    let responsibleName = 'N/A';
    if (testClient.responsibleStaff) {
      if (testClient.responsibleStaff.includes('-')) { // It's a UUID
        const staffMember = staff.find(s => s.id === testClient.responsibleStaff);
        responsibleName = staffMember ? staffMember.name : 'Responsável Desconhecido';
      } else { // It's a name
        responsibleName = testClient.responsibleStaff;
      }
    }

    let testSubject = subject;
    let testBody = body;

    // Replace all standard client properties
    for (const key of clientVariables) {
      const value = (testClient as any)[key];
      const regex = new RegExp(`{{${key}}}`, 'g');
      if (value !== undefined && value !== null) {
        testSubject = testSubject.replace(regex, String(value));
        testBody = testBody.replace(regex, String(value));
      }
    }

    // Replace special variables
    testSubject = testSubject.replace(/{{responsible_name}}/g, responsibleName);
    testBody = testBody.replace(/{{responsible_name}}/g, responsibleName);

    // Replace aliased and new variables for "Avenças" group
    testSubject = testSubject.replace(/{{avenca_atual}}/g, String(testClient.monthlyFee));
    testBody = testBody.replace(/{{avenca_atual}}/g, String(testClient.monthlyFee));
    testSubject = testSubject.replace(/{{nova_avenca}}/g, '[VALOR NOVA AVENÇA]');
    testBody = testBody.replace(/{{nova_avenca}}/g, '[VALOR NOVA AVENÇA]');

    const optOutFooter = `<br><br><p style="font-size:10px; color:#999;">Para deixar de receber comunicações de marketing, por favor responda a este email com o assunto "Remover".</p>`;
    const finalHtml = testBody.replace(/\n/g, '<br>') + `<br><br>${globalSettings.emailSignature || ''}` + optOutFooter;

    const confirmationMessage = `Isto irá enviar um email de teste REAL para 'mpr@mpr.pt' a partir de '${globalSettings.fromEmail}'.\n\nAssunto: ${testSubject}\n\nDeseja continuar?`;

    if (!confirm(confirmationMessage)) return;

    setIsSending(true);
    try {
      if (!storeClient) throw new Error("Cliente Supabase não inicializado.");

      // Garante que o token de autenticação está atualizado
      const { data: { session } } = await storeClient.auth.getSession();
      if (!session) throw new Error("Sessão inválida ou expirada. Faça login novamente.");
      storeClient.functions.setAuth(session.access_token);

      const { error } = await storeClient.functions.invoke('send-email', {
        body: { to: 'mpr@mpr.pt', from: `${globalSettings.fromName} <${globalSettings.fromEmail}>`, subject: testSubject, html: finalHtml },
      });
      if (error) throw error;
      alert("Email de teste enviado com sucesso!");
    } catch (err: any) {
      let detailedError = err.message;
      if (err.context && typeof err.context.json === 'function') {
        const functionError = await err.context.json().catch(() => null);
        if (functionError && functionError.error) detailedError = functionError.error;
        else if (functionError && functionError.message) detailedError = functionError.message;
      }
      if (detailedError.includes('Invalid JWT') || detailedError.includes('Sessão inválida')) {
        alert("A sua sessão expirou ou é inválida. Por favor, recarregue a página e tente novamente.");
      } else {
        alert(`Erro ao enviar email de teste: ${detailedError}`);
      }
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !editingTemplate.name) {
      alert("O nome do template é obrigatório.");
      return;
    }

    try {
      const savedTemplate = await templateService.upsert(editingTemplate);
      if (editingTemplate.id) {
        // Update existing
        setTemplates(templates.map(t => t.id === savedTemplate.id ? savedTemplate : t));
      } else {
        // Add new
        setTemplates([...templates, savedTemplate]);
      }
      // TODO: Implement template versioning and approval flow.
      // A template should have a status (e.g., 'draft', 'approved').
      // Only 'approved' templates can be sent. An 'admin' role would be needed to change the status.
      setIsTemplateModalOpen(false);
      setEditingTemplate(null);
      handleTemplateChange(savedTemplate.id); // Select the new/edited template
    } catch (err: any) {
      alert("Erro ao gravar o template: " + err.message);
    }
  };

  const handleOpenEditModal = () => {
    const templateToEdit = templates.find(t => t.id === selectedTemplateId);
    if (templateToEdit) {
      setEditingTemplate(templateToEdit);
      setIsTemplateModalOpen(true);
    } else {
      alert("Por favor, selecione um template para editar.");
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) {
      alert("Nenhum template selecionado para apagar.");
      return;
    }
    if (confirm("Tem a certeza que deseja apagar este template? Esta ação não pode ser desfeita.")) {
      try {
        await templateService.delete(selectedTemplateId);
        const updatedTemplates = templates.filter(t => t.id !== selectedTemplateId);
        setTemplates(updatedTemplates);
        handleTemplateChange(updatedTemplates.length > 0 ? updatedTemplates[0].id : '');
        alert("Template apagado com sucesso.");
      } catch (err: any) {
        alert("Erro ao apagar o template: " + err.message);
      }
    }
  };

  const insertVariable = (variable: string) => {
    if (!editingTemplate) return;
    // This is a simplification. A real implementation would insert at the cursor position.
    // For now, we append to the body.
    setEditingTemplate(prev => ({ ...prev, body: (prev?.body || '') + `{{${variable}}}` }));
  };

  const validateCurrentTemplate = () => {
    setValidationIssues([]);
    const issues: string[] = [];
    const allContent = subject + ' ' + body;
    const variablesFound = allContent.match(/{{(.*?)}}/g) || [];
    
    variablesFound.forEach(variable => {
        const varName = variable.replace(/{{|}}/g, '');
        if (!allVariables.includes(varName as any)) {
            issues.push(`A variável ${variable} não é reconhecida.`);
        }
    });

    if (issues.length === 0) {
        alert("Nenhum problema encontrado. As variáveis parecem estar corretas.");
    }
    setValidationIssues(issues);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Campanhas de Email</h2>
          <p className="text-sm text-slate-500">Crie, personalize e envie comunicações para os seus clientes.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor Column */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-500">Modelo de Email</label>
              <div className="flex items-center gap-3">
                <button onClick={handleOpenEditModal} disabled={!selectedTemplateId} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Edit2 size={12} /> Editar
                </button>
                <button onClick={handleDeleteTemplate} disabled={!selectedTemplateId} className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Trash2 size={12} /> Apagar
                </button>
                <button onClick={() => { setEditingTemplate({ name: '', subject: '', body: '' }); setIsTemplateModalOpen(true); }} className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                  <Plus size={12} /> Novo Template
                </button>
              </div>
            </div>
            <select
              value={selectedTemplateId}
              onChange={e => handleTemplateChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50"
            >
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <input 
              type="text" 
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
              placeholder="Assunto do seu email"
            />
            <textarea 
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm h-80 font-mono"
              placeholder="Escreva o seu email aqui... Use {{client_name}} para personalizar."
            />
            <div className="flex justify-between items-start mt-2">
              <div className="text-xs text-slate-500">
                <span className="font-bold">Variáveis disponíveis:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {allVariables.map(variable => (
                    <code key={variable} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-md font-mono">{`{{${variable}}}`}</code>
                  ))}
                </div>
              </div>
              <button onClick={validateCurrentTemplate} className="text-xs font-bold bg-slate-100 text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-200 flex items-center gap-2">
                <CheckCircle size={14}/> Verificar Variáveis
              </button>
            </div>
            {validationIssues.length > 0 && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    <p className="font-bold mb-1 flex items-center gap-1"><AlertCircle size={14}/> Problemas Encontrados:</p>
                    <ul className="list-disc list-inside pl-2">
                    {validationIssues.map((issue, i) => <li key={i}>{issue}</li>)}
                    </ul>
                </div>
            )}
          </div>
        </div>

        {/* Settings & Recipients Column */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Users size={18} /> Destinatários</h3>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Enviar para o Grupo:</label>
              <select
                value={selectedGroupId}
                onChange={e => {
                  setSelectedGroupId(e.target.value);
                  setSelectedRecipients([]); // Reset selection on group change
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="all">Todos os Clientes</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="mt-4 border-t pt-4">
                <div className="flex justify-between items-center">
                    <p className="text-sm">
                        <span className="font-bold text-blue-600">{selectedRecipients.length}</span> destinatário(s) selecionado(s) de <span className="font-bold">{availableRecipients.length}</span>
                    </p>
                    <button onClick={() => setIsRecipientModalOpen(true)} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-100">
                        Selecionar
                    </button>
                </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Send size={18} /> Envio</h3>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input 
                        type="checkbox" 
                        checked={isScheduled} 
                        onChange={e => setIsScheduled(e.target.checked)} 
                        className="rounded h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    Agendar envio
                </label>
                {isScheduled && (
                    <div className="mt-2 pl-6">
                        <label className="block text-xs font-bold text-slate-500 mb-1">Data e Hora do Envio</label>
                        <input 
                            type="datetime-local" value={scheduleDateTime} onChange={e => setScheduleDateTime(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg text-sm bg-white" min={new Date().toISOString().slice(0, 16)}
                        />
                    </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Velocidade de Envio</label>
                <select value={sendDelay} onChange={e => setSendDelay(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value={200}>Muito Rápido (5/seg)</option>
                  <option value={500}>Rápido (2/seg)</option>
                  <option value={2000}>Lento (1/2 seg)</option>
                  <option value={5000}>Muito Lento (1/5 seg)</option>
                </select>
              </div>
              <button 
                type="button"
                onClick={handleSendTestEmail}
                className="w-full bg-white text-slate-700 border border-slate-300 py-2 rounded-xl font-bold hover:bg-slate-50 transition-all flex justify-center items-center gap-2"
              >
                <Mail size={16} /> Enviar Email de Teste
              </button>
              <button 
                onClick={handleSendCampaign}
                disabled={isSending || selectedRecipients.length === 0}
                className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-all flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {isSending ? <RefreshCcw size={18} className="animate-spin" /> : <Send size={18} />}
                {isSending ? 'A Enviar...' : `Enviar Campanha para ${selectedRecipients.length} Destinatários`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* History Section */}
      <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <History size={18} /> Histórico de Campanhas Enviadas
        </h3>
        <div className="overflow-x-auto max-h-96 custom-scrollbar">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Assunto</th>
                <th className="px-4 py-3">Grupo</th>
                <th className="px-4 py-3 text-center">Destinatários</th>
                <th className="px-4 py-3 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {history.map(item => {
                const isScheduled = item.status === 'Agendada' && item.scheduled_at;
                const displayDate = isScheduled ? new Date(item.scheduled_at) : new Date(item.sent_at);

                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{displayDate.toLocaleString('pt-PT')}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{item.subject}</td>
                    <td className="px-4 py-3 text-xs">{item.group_name}</td>
                    <td className="px-4 py-3 text-center font-bold">{item.recipient_count}</td>
                    <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full ${
                            isScheduled ? 'bg-yellow-100 text-yellow-700' 
                            : item.status.includes('falhas') ? 'bg-red-100 text-red-700' 
                            : 'bg-green-100 text-green-700'
                        }`}>
                            {isScheduled ? <Clock size={12} /> : <CheckCircle size={12} />}
                            {item.status}
                        </span>
                    </td>
                  </tr>
                )
              })}
              {history.length === 0 && ( <tr><td colSpan={5} className="text-center italic text-slate-400 py-10">Nenhuma campanha enviada ainda.</td></tr> )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Template Modal */}
      {isTemplateModalOpen && editingTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">{editingTemplate.id ? 'Editar Template' : 'Novo Template'}</h3>
              <button onClick={() => setIsTemplateModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveTemplate} className="space-y-4">
              <div className="flex gap-4 items-center">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 mb-1">Nome do Template</label>
                  <input type="text" required value={editingTemplate.name || ''} onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                {/* Placeholder for approval workflow */}
                <div className="text-xs mt-5">
                    <span className="font-bold text-slate-400">Estado:</span>
                    <span className="ml-1 bg-yellow-100 text-yellow-700 font-bold px-2 py-1 rounded-full">Rascunho</span>
                </div>
                <button type="button" onClick={() => setIsAiModalOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 mt-5">
                  <BrainCircuit size={16} /> Assistente IA
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Assunto</label>
                <input type="text" value={editingTemplate.subject || ''} onChange={e => setEditingTemplate({...editingTemplate, subject: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Corpo do Email</label>
                <textarea value={editingTemplate.body || ''} onChange={e => setEditingTemplate({...editingTemplate, body: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm h-40 font-mono" />
                <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Caixa de Variáveis (clique para inserir)</p>
                  <div className="flex flex-wrap gap-1">
                    {allVariables.map(variable => (
                      <button
                        key={variable}
                        type="button"
                        onClick={() => insertVariable(variable)}
                        className="text-[10px] bg-slate-200 text-slate-700 px-2 py-1 rounded-md font-mono hover:bg-slate-300"
                      >
                        {`{{${variable}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
                <button type="button" disabled title="Funcionalidade de aprovação futura" className="bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-bold cursor-not-allowed">Aprovar</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                  <Save size={16} /> Salvar Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Assistant Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-bold mb-4">Assistente IA para Templates</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tópico do Email</label>
                <input type="text" value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="Ex: Lembrete sobre o IES" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tom de Comunicação</label>
                <select value={aiTone} onChange={e => setAiTone(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Profissional</option>
                  <option>Informal</option>
                  <option>Informativo</option>
                  <option>Publicidade</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-6">
              <button onClick={() => setIsAiModalOpen(false)} className="px-4 py-2 text-slate-600">Cancelar</button>
              <button onClick={handleAiAssist} disabled={isGenerating} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
                {isGenerating ? <RefreshCcw size={16} className="animate-spin" /> : <BrainCircuit size={16} />} Gerar Conteúdo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Result Modal */}
      {campaignResult && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">Resultado da Campanha</h3>
                <button onClick={() => setCampaignResult(null)}><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center mb-4">
                <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-xs font-bold uppercase text-green-700">Sucessos</p>
                <p className="text-2xl font-bold">{campaignResult.successCount}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-lg">
                <p className="text-xs font-bold uppercase text-red-700">Falhas</p>
                <p className="text-2xl font-bold">{campaignResult.errorCount}</p>
                </div>
            </div>
            <div className="max-h-80 overflow-y-auto border rounded-lg custom-scrollbar">
                <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                    <tr>
                    <th className="p-2 text-left">Destinatário</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-center">Estado</th>
                    <th className="p-2 text-left">Detalhe</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {campaignResult.details.map((detail, i) => (
                    <tr key={i} className={detail.status === 'error' ? 'bg-red-50/50' : ''}>
                        <td className="p-2 font-medium">{detail.name}</td>
                        <td className="p-2 text-slate-500">{detail.email}</td>
                        <td className={`p-2 text-center font-bold ${detail.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>{detail.status === 'success' ? 'Enviado' : 'Falhou'}</td>
                        <td className="p-2 text-red-500 italic">{detail.error}</td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
            <div className="text-right mt-4"><button onClick={() => setCampaignResult(null)} className="bg-slate-700 text-white px-6 py-2 rounded-lg font-bold">Fechar</button></div>
            </div>
        </div>
      )}

      {/* Recipient Selection Modal */}
      {isRecipientModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh]">
                <div className="p-6 border-b flex justify-between items-center">
                    <h3 className="text-xl font-bold">Selecionar Destinatários</h3>
                    <button onClick={() => setIsRecipientModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                </div>
                
                <div className="p-4 border-b">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                            type="text"
                            placeholder="Pesquisar por nome ou email..."
                            value={recipientSearch}
                            onChange={e => setRecipientSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <div className="flex justify-between items-center mb-2 px-2">
                        <p className="text-xs font-bold text-slate-500">{selectedRecipients.length} de {filteredRecipients.length} selecionados</p>
                        <button
                            onClick={() => {
                                const allVisibleIds = filteredRecipients.map(c => c.id);
                                const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedRecipients.includes(id));

                                if (allVisibleSelected) {
                                    setSelectedRecipients(prev => prev.filter(id => !allVisibleIds.includes(id)));
                                } else {
                                    setSelectedRecipients(prev => Array.from(new Set([...prev, ...allVisibleIds])));
                                }
                            }}
                            className="text-xs font-medium text-blue-600 hover:underline"
                        >
                            {filteredRecipients.length > 0 && filteredRecipients.every(c => selectedRecipients.includes(c.id)) ? 'Desselecionar Visíveis' : 'Selecionar Visíveis'}
                        </button>
                    </div>
                    <div className="border rounded-lg bg-slate-50/50 p-2 space-y-1">
                        {filteredRecipients.map(client => (
                            <label key={client.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-100 cursor-pointer text-sm">
                                <input 
                                    type="checkbox" 
                                    className="rounded h-4 w-4 text-blue-600 focus:ring-blue-500"
                                    checked={selectedRecipients.includes(client.id)}
                                    onChange={() => {
                                        setSelectedRecipients(prev => 
                                            prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]
                                        );
                                    }}
                                />
                                <div>
                                    <span className="font-medium text-slate-800">{client.name}</span>
                                    <span className="text-xs text-slate-400 ml-2">{client.email}</span>
                                </div>
                            </label>
                        ))}
                        {filteredRecipients.length === 0 && <p className="text-center text-slate-400 italic py-4">Nenhum cliente encontrado.</p>}
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t flex justify-end"><button onClick={() => setIsRecipientModalOpen(false)} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">Confirmar Seleção</button></div>
            </div>
        </div>
      )}
    </div>
  );
};

export default EmailCampaigns;