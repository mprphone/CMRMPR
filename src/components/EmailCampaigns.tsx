import React, { useState, useMemo, useEffect } from 'react';
import { Client, FeeGroup, Staff, EmailTemplate, CampaignHistory, AiTemplateAnalysis, GlobalSettings } from '../types';
import { Mail, BrainCircuit, Send, Users, Plus, X, RefreshCcw, Save, Trash2, History, Edit2 } from 'lucide-react';
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
    } catch (error) {
      alert("Ocorreu um erro ao gerar o template com a IA.");
      console.error(error);
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
    if (!confirm(`Tem a certeza que deseja enviar esta campanha para ${selectedRecipients.length} cliente(s)?`)) {
      return;
    }

    setIsSending(true);
    
    const recipients = clients.filter(c => selectedRecipients.includes(c.id));
    let successCount = 0;
    let errorCount = 0;

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
        
        const { error } = await storeClient.functions.invoke('send-email', {
          body: { to: client.email, from: `${globalSettings.fromName} <${globalSettings.fromEmail}>`, subject: finalSubject, html: finalBody.replace(/\n/g, '<br>') + `<br><br>${globalSettings.emailSignature || ''}` },
        });

        if (error) { errorCount++; console.error(`Falha ao enviar para ${client.email}:`, error); } 
        else { successCount++; }
      } catch (err) {
        errorCount++;
        console.error(`Falha ao enviar para ${client.email}:`, err);
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5s delay between emails
    }

    const group = groups.find(g => g.id === selectedGroupId);
    const groupName = selectedGroupId === 'all' ? 'Todos os Clientes' : group?.name || 'Grupo Desconhecido';
    const newHistoryRecord: Partial<CampaignHistory> = { subject, body, recipient_count: successCount, group_name: groupName, status: `Enviada (${successCount} sucesso, ${errorCount} falhas)` };

    try {
      const savedRecord = await campaignHistoryService.create(newHistoryRecord);
      setHistory([savedRecord, ...history]);
    } catch (err: any) {
      alert("Falha ao gravar o histórico da campanha: " + err.message);
    }

    alert(`Campanha concluída. ${successCount} emails enviados com sucesso. ${errorCount} falhas.`);
    setIsSending(false);
    setSelectedRecipients([]);
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

    const confirmationMessage = `Isto irá enviar um email de teste REAL para 'mpr@mpr.pt' a partir de '${globalSettings.fromEmail}'.\n\nAssunto: ${testSubject}\n\nDeseja continuar?`;

    if (!confirm(confirmationMessage)) return;

    setIsSending(true);
    try {
      if (!storeClient) throw new Error("Cliente Supabase não inicializado.");
      const { error } = await storeClient.functions.invoke('send-email', {
        body: { to: 'mpr@mpr.pt', from: `${globalSettings.fromName} <${globalSettings.fromEmail}>`, subject: testSubject, html: testBody.replace(/\n/g, '<br>') + `<br><br>${globalSettings.emailSignature || ''}` },
      });
      if (error) throw error;
      alert("Email de teste enviado com sucesso!");
    } catch (err: any) {
      alert(`Erro ao enviar email de teste: ${err.message}`);
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
            <div className="mt-2 text-xs text-slate-500">
              <span className="font-bold">Variáveis disponíveis:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {allVariables.map(variable => (
                  <code key={variable} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-md font-mono">{`{{${variable}}}`}</code>
                ))}
              </div>
            </div>
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
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-bold text-slate-500">{selectedRecipients.length} de {availableRecipients.length} selecionados</p>
                <button
                  onClick={() => {
                    if (selectedRecipients.length === availableRecipients.length) {
                      setSelectedRecipients([]);
                    } else {
                      setSelectedRecipients(availableRecipients.map(c => c.id));
                    }
                  }}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  {selectedRecipients.length === availableRecipients.length ? 'Desselecionar Todos' : 'Selecionar Todos'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto border rounded-lg bg-slate-50/50 p-2 space-y-1">
                {availableRecipients.map(client => (
                  <label key={client.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-100 cursor-pointer text-xs">
                    <input 
                      type="checkbox" 
                      className="rounded"
                      checked={selectedRecipients.includes(client.id)}
                      onChange={() => {
                        setSelectedRecipients(prev => 
                          prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]
                        );
                      }}
                    />
                    <span className="font-medium text-slate-700">{client.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Send size={18} /> Envio</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Velocidade de Envio</label>
                <select className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Imediato</option>
                  <option>Lento (1 email / 5 seg)</option>
                  <option>Muito Lento (1 email / 15 seg)</option>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {history.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(item.sent_at).toLocaleString('pt-PT')}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{item.subject}</td>
                  <td className="px-4 py-3 text-xs">{item.group_name}</td>
                  <td className="px-4 py-3 text-center font-bold">{item.recipient_count}</td>
                </tr>
              ))}
              {history.length === 0 && ( <tr><td colSpan={4} className="text-center italic text-slate-400 py-10">Nenhuma campanha enviada ainda.</td></tr> )}
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
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 mb-1">Nome do Template</label>
                  <input type="text" required value={editingTemplate.name || ''} onChange={e => setEditingTemplate({...editingTemplate, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <button type="button" onClick={() => setIsAiModalOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
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
    </div>
  );
};

export default EmailCampaigns;