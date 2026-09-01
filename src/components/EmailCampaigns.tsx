import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, Ban, Bold, BrainCircuit, CalendarClock, Check, CheckCircle2,
  ChevronLeft, ChevronRight, Clock, Edit3, Eye, FileText, History, LayoutTemplate,
  Link2, List, Mail, Monitor, Pause, Play, Plus, RefreshCcw, Save, Search, Send,
  ShieldCheck, Smartphone, Trash2, Users, Workflow, X,
} from 'lucide-react';
import {
  CampaignHistory, CampaignRecipientResult, Client, EmailAutomation, EmailSuppression,
  EmailTemplate, FeeGroup, GlobalSettings, Staff,
} from '../types';
import { hasAppPermission, UserAccessProfile } from '../accessControl';
import { generateTemplateWithAI } from '../services/geminiService';
import {
  campaignHistoryService, emailAutomationService, emailSuppressionService, storeClient,
  templateService,
} from '../services';
import {
  ALL_EMAIL_VARIABLES, applyEmailVariables, buildEmailPreviewDocument,
  buildPersonalizedEmailHtml, getUnknownEmailVariables, isValidEmail, normalizeEmail,
} from './email/emailComposerUtils';

interface EmailCampaignsProps {
  clients: Client[];
  groups: FeeGroup[];
  staff: Staff[];
  templates: EmailTemplate[];
  setTemplates: (templates: EmailTemplate[]) => void;
  history: CampaignHistory[];
  setHistory: (history: CampaignHistory[]) => void;
  globalSettings: GlobalSettings;
  accessProfile: UserAccessProfile;
}

type EmailTab = 'compose' | 'scheduled' | 'history' | 'templates' | 'automations' | 'suppressions';
type Toast = { type: 'success' | 'error' | 'info'; message: string };

interface ComposerDraft {
  selectedTemplateId: string;
  subject: string;
  preheader: string;
  body: string;
  campaignType: 'service' | 'marketing';
  selectedGroupId: string;
  isScheduled: boolean;
  scheduleDateTime: string;
  requiresApproval: boolean;
}

const DRAFT_STORAGE_KEY = 'cmrmpr-email-composer-draft-v2';
const PAGE_SIZE = 20;

const emptyDraft: ComposerDraft = {
  selectedTemplateId: '',
  subject: '',
  preheader: '',
  body: '',
  campaignType: 'service',
  selectedGroupId: 'all',
  isScheduled: false,
  scheduleDateTime: '',
  requiresApproval: false,
};

const readDraft = (): ComposerDraft => {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? { ...emptyDraft, ...parsed } : emptyDraft;
  } catch {
    return emptyDraft;
  }
};

const localDateTimeMin = () => {
  const now = new Date(Date.now() + 60_000);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

const statusTone = (status?: string) => {
  switch (status) {
    case 'completed': return 'bg-emerald-100 text-emerald-800';
    case 'partial': return 'bg-amber-100 text-amber-800';
    case 'failed': return 'bg-red-100 text-red-800';
    case 'cancelled': return 'bg-slate-200 text-slate-700';
    case 'scheduled': return 'bg-violet-100 text-violet-800';
    case 'draft': return 'bg-yellow-100 text-yellow-800';
    case 'queued':
    case 'processing': return 'bg-blue-100 text-blue-800';
    default: return 'bg-slate-100 text-slate-700';
  }
};

const recipientStatusLabel: Record<string, string> = {
  success: 'Aceite', error: 'Erro', pending: 'Pendente', sending: 'A enviar', retry: 'Nova tentativa',
  accepted: 'Aceite pelo servidor', delivered: 'Entregue', bounced: 'Devolvido', complained: 'Spam',
  failed: 'Falhou', cancelled: 'Cancelado', suppressed: 'Suprimido', skipped: 'Excluído',
};

const EmailCampaigns: React.FC<EmailCampaignsProps> = ({
  clients, groups, staff, templates, setTemplates, history, setHistory, globalSettings, accessProfile,
}) => {
  const initialDraft = useMemo(readDraft, []);
  const [activeTab, setActiveTab] = useState<EmailTab>('compose');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialDraft.selectedTemplateId);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [preheader, setPreheader] = useState(initialDraft.preheader);
  const [body, setBody] = useState(initialDraft.body);
  const [campaignType, setCampaignType] = useState<'service' | 'marketing'>(initialDraft.campaignType);
  const [selectedGroupId, setSelectedGroupId] = useState(initialDraft.selectedGroupId);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [isScheduled, setIsScheduled] = useState(initialDraft.isScheduled);
  const [scheduleDateTime, setScheduleDateTime] = useState(initialDraft.scheduleDateTime);
  const [requiresApproval, setRequiresApproval] = useState(initialDraft.requiresApproval);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [isRecipientModalOpen, setIsRecipientModalOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewClientId, setPreviewClientId] = useState('');
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [testEmail, setTestEmail] = useState(accessProfile.email || '');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [suppressions, setSuppressions] = useState<EmailSuppression[]>([]);
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignTotal, setCampaignTotal] = useState(history.length);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignHistory | null>(null);
  const [recipientDetails, setRecipientDetails] = useState<CampaignRecipientResult[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<Partial<EmailTemplate> | null>(null);
  const [templateDeleteId, setTemplateDeleteId] = useState<string | null>(null);
  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState('Profissional');
  const [isGenerating, setIsGenerating] = useState(false);
  const [automations, setAutomations] = useState<EmailAutomation[]>([]);
  const [automationDraft, setAutomationDraft] = useState<Partial<EmailAutomation> | null>(null);
  const [newSuppressionEmail, setNewSuppressionEmail] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const templateBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const canCreate = hasAppPermission(accessProfile, 'emails', 'create');
  const canEdit = hasAppPermission(accessProfile, 'emails', 'edit');
  const canDelete = hasAppPermission(accessProfile, 'emails', 'delete');

  const notify = (type: Toast['type'], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast((current) => current?.message === message ? null : current), 7000);
  };

  const loadSuppressions = async () => {
    try { setSuppressions(await emailSuppressionService.getAll()); }
    catch (error: any) { notify('error', `Não foi possível carregar supressões: ${error.message}`); }
  };

  const loadCampaigns = async (page = campaignPage) => {
    try {
      const result = await campaignHistoryService.getPage(page, PAGE_SIZE);
      setHistory(result.campaigns);
      setCampaignTotal(result.total);
    } catch (error: any) {
      notify('error', `Não foi possível atualizar as campanhas: ${error.message}`);
    }
  };

  const loadAutomations = async () => {
    try { setAutomations(await emailAutomationService.getAll()); }
    catch (error: any) { notify('error', `Não foi possível carregar automatismos: ${error.message}`); }
  };

  useEffect(() => { void loadSuppressions(); }, []);

  useEffect(() => {
    if (activeTab === 'automations') void loadAutomations();
    if (activeTab === 'history' || activeTab === 'scheduled') void loadCampaigns(campaignPage);
  }, [activeTab, campaignPage]);

  useEffect(() => {
    const hasActiveCampaigns = history.some((campaign) => ['queued', 'processing', 'scheduled'].includes(campaign.delivery_status || ''));
    if (!hasActiveCampaigns) return;
    const timer = window.setInterval(() => void loadCampaigns(campaignPage), 10000);
    return () => window.clearInterval(timer);
  }, [history, campaignPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        selectedTemplateId, subject, preheader, body, campaignType, selectedGroupId,
        isScheduled, scheduleDateTime, requiresApproval,
      } satisfies ComposerDraft));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [selectedTemplateId, subject, preheader, body, campaignType, selectedGroupId, isScheduled, scheduleDateTime, requiresApproval]);

  useEffect(() => {
    if (templates.length && !selectedTemplateId && !subject && !body) selectTemplate(templates[0].id);
  }, [templates]);

  const availableRecipients = useMemo(() => {
    if (selectedGroupId === 'all') return clients;
    const group = groups.find((item) => item.id === selectedGroupId);
    const ids = new Set(group?.clientIds || []);
    return clients.filter((client) => ids.has(client.id));
  }, [clients, groups, selectedGroupId]);

  const suppressionEmails = useMemo(
    () => new Set(suppressions.filter((item) => !item.lifted_at).map((item) => item.email_normalized)),
    [suppressions],
  );

  const eligibility = useMemo(() => {
    const seen = new Set<string>();
    return new Map(availableRecipients.map((client) => {
      const email = normalizeEmail(client.email);
      let reason = '';
      if (client.status === 'Inativo' || client.status === 'Cancelado') reason = 'Cliente inativo';
      else if (!isValidEmail(email)) reason = 'Email inválido';
      else if (seen.has(email)) reason = 'Email duplicado';
      else if (suppressionEmails.has(email) || client.emailMarketingStatus === 'opted_out') reason = 'Opt-out/supressão';
      else if (campaignType === 'marketing' && !['consented', 'legitimate_interest'].includes(client.emailMarketingStatus || 'unknown')) reason = 'Sem base registada para marketing';
      seen.add(email);
      return [client.id, reason];
    }));
  }, [availableRecipients, campaignType, suppressionEmails]);

  useEffect(() => {
    setSelectedRecipients((current) => current.filter((id) => eligibility.get(id) === ''));
  }, [eligibility]);

  const filteredRecipients = useMemo(() => {
    const search = recipientSearch.trim().toLocaleLowerCase('pt-PT');
    if (!search) return availableRecipients;
    return availableRecipients.filter((client) => [client.name, client.email, client.nif]
      .some((value) => String(value || '').toLocaleLowerCase('pt-PT').includes(search)));
  }, [availableRecipients, recipientSearch]);

  const hygieneCounts = useMemo(() => {
    const counts = { eligible: 0, invalid: 0, inactive: 0, suppressed: 0, duplicate: 0, noConsent: 0 };
    eligibility.forEach((reason) => {
      if (!reason) counts.eligible += 1;
      else if (reason.includes('inválido')) counts.invalid += 1;
      else if (reason.includes('inativo')) counts.inactive += 1;
      else if (reason.includes('duplicado')) counts.duplicate += 1;
      else if (reason.includes('base')) counts.noConsent += 1;
      else counts.suppressed += 1;
    });
    return counts;
  }, [eligibility]);

  const selectedClients = useMemo(
    () => clients.filter((client) => selectedRecipients.includes(client.id)),
    [clients, selectedRecipients],
  );

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const proposedFees = selectedGroup?.proposed_fees || {};

  const responsibleName = (client: Client) => {
    if (!client.responsibleStaff) return '';
    return staff.find((member) => member.id === client.responsibleStaff)?.name || client.responsibleStaff;
  };

  const personalize = (client: Client) => {
    const newFee = proposedFees[client.id];
    const personalizedSubject = applyEmailVariables(subject, client, responsibleName(client), newFee);
    const personalizedBody = applyEmailVariables(body, client, responsibleName(client), newFee);
    return {
      subject: personalizedSubject,
      body: personalizedBody,
      html: buildPersonalizedEmailHtml(personalizedBody, globalSettings.emailSignature || ''),
    };
  };

  const previewClient = clients.find((client) => client.id === previewClientId)
    || selectedClients[0]
    || availableRecipients.find((client) => eligibility.get(client.id) === '')
    || null;
  const preview = previewClient ? personalize(previewClient) : null;

  const validateCampaign = () => {
    const issues: string[] = [];
    if (!subject.trim()) issues.push('Preencha o assunto.');
    if (!body.trim()) issues.push('Preencha o corpo do email.');
    if (!selectedClients.length) issues.push('Selecione pelo menos um destinatário elegível.');
    if (!globalSettings.fromName?.trim()) issues.push('Configure o nome do remetente.');
    if (!isValidEmail(globalSettings.fromEmail || '')) issues.push('Configure um email de resposta válido.');
    getUnknownEmailVariables(subject, body).forEach((variable) => issues.push(`Variável desconhecida: {{${variable}}}.`));
    if ((subject.includes('{{nova_avenca}}') || body.includes('{{nova_avenca}}')) && selectedGroupId === 'all') {
      issues.push('A variável {{nova_avenca}} exige um grupo de avenças específico.');
    } else if (subject.includes('{{nova_avenca}}') || body.includes('{{nova_avenca}}')) {
      const missing = selectedClients.filter((client) => proposedFees[client.id] == null);
      if (missing.length) issues.push(`${missing.length} destinatário(s) sem nova avença definida.`);
    }
    if (isScheduled) {
      const date = new Date(scheduleDateTime);
      if (!scheduleDateTime || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) issues.push('Escolha uma data futura válida.');
    }
    setValidationIssues(issues);
    return issues;
  };

  const selectTemplate = (id: string) => {
    const template = templates.find((item) => item.id === id);
    setSelectedTemplateId(id);
    if (!template) return;
    setSubject(template.subject);
    setPreheader(template.preheader || '');
    setBody(template.body);
  };

  const insertAtCursor = (
    value: string,
    setter: (value: string) => void,
    textarea: HTMLTextAreaElement | null,
    insertion: string,
  ) => {
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    setter(`${value.slice(0, start)}${insertion}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  };

  const wrapSelection = (prefix: string, suffix = prefix) => {
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || 'texto';
    insertAtCursor(body, setBody, textarea, `${prefix}${selected}${suffix}`);
  };

  const openReview = () => {
    const issues = validateCampaign();
    if (issues.length) {
      notify('error', 'Corrija os problemas assinalados antes de continuar.');
      return;
    }
    setIsReviewOpen(true);
  };

  const createCampaign = async () => {
    const issues = validateCampaign();
    if (issues.length) return;
    setIsReviewOpen(false);
    setIsWorking(true);
    try {
      const campaign = await campaignHistoryService.queue({
        subject,
        body,
        groupName: selectedGroupId === 'all' ? 'Todos os Clientes' : selectedGroup?.name || 'Grupo',
        campaignType,
        preheader,
        signatureHtml: globalSettings.emailSignature || '',
        fromName: globalSettings.fromName || '',
        fromEmail: globalSettings.fromEmail || '',
        replyTo: globalSettings.fromEmail || '',
        scheduledAt: isScheduled ? new Date(scheduleDateTime).toISOString() : new Date().toISOString(),
        templateId: selectedTemplateId || null,
        idempotencyKey,
        requiresApproval,
        recipients: selectedClients.map((client) => {
          const content = personalize(client);
          return {
            clientId: client.id,
            name: client.name,
            email: client.email,
            subject: content.subject,
            html: content.html,
            metadata: { responsible_name: responsibleName(client) },
          };
        }),
      });

      if (!isScheduled && !requiresApproval && (campaign.eligible_count || 0) > 0) {
        await campaignHistoryService.processQueue(campaign.id, 50).catch((error) => {
          notify('info', `A campanha ficou na fila persistente: ${error.message}`);
        });
      }
      await loadCampaigns(1);
      setCampaignPage(1);
      setSelectedRecipients([]);
      setIdempotencyKey(crypto.randomUUID());
      notify('success', requiresApproval
        ? 'Rascunho criado e pronto para aprovação.'
        : isScheduled
          ? 'Campanha agendada no servidor.'
          : 'Campanha colocada na fila persistente. Pode fechar o browser em segurança.');
      setActiveTab(isScheduled || requiresApproval ? 'scheduled' : 'history');
    } catch (error: any) {
      notify('error', error.message || 'Não foi possível criar a campanha.');
    } finally {
      setIsWorking(false);
    }
  };

  const sendTest = async () => {
    if (!isValidEmail(testEmail)) return notify('error', 'Indique um email de teste válido.');
    if (!subject.trim() || !body.trim()) return notify('error', 'Preencha o assunto e o corpo.');
    if (!previewClient) return notify('error', 'Não existe um cliente elegível para personalizar o teste.');
    if (!storeClient) return notify('error', 'Ligação ao servidor indisponível.');
    setIsWorking(true);
    try {
      const content = personalize(previewClient);
      const { error } = await storeClient.functions.invoke('send-email', {
        body: {
          to: testEmail,
          from: `${globalSettings.fromName || ''} <${globalSettings.fromEmail || ''}>`,
          replyTo: globalSettings.fromEmail || '',
          subject: `[TESTE] ${content.subject}`,
          html: content.html,
          preheader,
        },
      });
      if (error) throw error;
      notify('success', `Email de teste enviado para ${testEmail}.`);
    } catch (error: any) {
      notify('error', `Falha no teste: ${error.message}`);
    } finally { setIsWorking(false); }
  };

  const openCampaignDetails = async (campaign: CampaignHistory) => {
    setSelectedCampaign(campaign);
    setRecipientDetails([]);
    setIsLoadingDetails(true);
    try { setRecipientDetails(await campaignHistoryService.getRecipients(campaign.id)); }
    catch (error: any) { notify('error', `Falha ao carregar destinatários: ${error.message}`); }
    finally { setIsLoadingDetails(false); }
  };

  const controlCampaign = async (campaign: CampaignHistory, action: 'cancel' | 'approve') => {
    setIsWorking(true);
    try {
      await campaignHistoryService.control(campaign.id, action);
      if (action === 'approve' && (!campaign.scheduled_at || new Date(campaign.scheduled_at) <= new Date())) {
        await campaignHistoryService.processQueue(campaign.id, 50).catch(() => undefined);
      }
      await loadCampaigns(campaignPage);
      notify('success', action === 'cancel' ? 'Campanha cancelada.' : 'Campanha aprovada e colocada na fila.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const prepareRetry = async (campaign: CampaignHistory) => {
    setIsWorking(true);
    try {
      const details = await campaignHistoryService.getRecipients(campaign.id);
      const failedIds = details
        .filter((detail) => ['error', 'failed', 'bounced'].includes(detail.status))
        .map((detail) => detail.client_id)
        .filter((id): id is string => Boolean(id));
      if (!failedIds.length) return notify('info', 'Não existem destinatários falhados associados a clientes atuais.');
      setSubject(campaign.subject);
      setBody(campaign.body);
      setPreheader(campaign.preheader || '');
      setCampaignType(campaign.campaign_type || 'service');
      setSelectedRecipients(failedIds);
      setSelectedGroupId(groups.find((group) => group.name === campaign.group_name)?.id || 'all');
      setIdempotencyKey(crypto.randomUUID());
      setActiveTab('compose');
      notify('info', `${failedIds.length} destinatário(s) preparado(s) para reenvio. Reveja antes de confirmar.`);
    } finally { setIsWorking(false); }
  };

  const saveTemplate = async () => {
    if (!templateDraft?.name?.trim() || !templateDraft.subject?.trim() || !templateDraft.body?.trim()) {
      return notify('error', 'Nome, assunto e corpo são obrigatórios.');
    }
    setIsWorking(true);
    try {
      const previous = templates.find((item) => item.id === templateDraft.id);
      const saved = await templateService.upsert({
        ...templateDraft,
        version: previous ? Number(previous.version || 1) + 1 : 1,
      });
      const nextTemplates = previous
        ? templates.map((item) => item.id === saved.id ? saved : item)
        : [...templates, saved];
      setTemplates(nextTemplates);
      setTemplateDraft(saved);
      setSelectedTemplateId(saved.id);
      setSubject(saved.subject);
      setPreheader(saved.preheader || '');
      setBody(saved.body);
      notify('success', 'Template guardado.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const archiveTemplate = async () => {
    if (!templateDeleteId) return;
    setIsWorking(true);
    try {
      await templateService.delete(templateDeleteId);
      const nextTemplates = templates.filter((item) => item.id !== templateDeleteId);
      setTemplates(nextTemplates);
      setTemplateDeleteId(null);
      setTemplateDraft(null);
      if (selectedTemplateId === templateDeleteId) {
        setSelectedTemplateId('');
        setSubject('');
        setPreheader('');
        setBody('');
      }
      notify('success', 'Template arquivado.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const generateWithAi = async () => {
    if (!aiTopic.trim()) return notify('error', 'Descreva o tema pretendido.');
    setIsGenerating(true);
    try {
      const result = await generateTemplateWithAI(aiTopic, aiTone);
      setTemplateDraft((current) => ({ ...current, subject: result.subject, body: result.body }));
      notify('success', 'Rascunho gerado. Reveja todo o conteúdo antes de aprovar.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsGenerating(false); }
  };

  const saveAutomation = async () => {
    if (!automationDraft?.name?.trim() || !automationDraft.client_group || !automationDraft.ai_instructions?.trim()) {
      return notify('error', 'Nome, grupo e instruções são obrigatórios.');
    }
    setIsWorking(true);
    try {
      const saved = await emailAutomationService.upsert({
        ...automationDraft,
        admin_email: automationDraft.admin_email || accessProfile.email,
        from_name: automationDraft.from_name || globalSettings.fromName || '',
        from_email: automationDraft.from_email || globalSettings.fromEmail || '',
        reply_to: automationDraft.reply_to || globalSettings.fromEmail || '',
        trigger_type: 'monthly_documents',
      });
      setAutomations((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      setAutomationDraft(saved);
      notify('success', 'Automatismo guardado.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const runAutomation = async (automation: EmailAutomation) => {
    setIsWorking(true);
    try {
      const result = await emailAutomationService.runNow(automation.id);
      notify('success', result.requiresApproval ? 'Rascunho automático criado para aprovação.' : 'Campanha automática colocada na fila.');
      await loadCampaigns(1);
      setActiveTab('scheduled');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const addSuppression = async () => {
    if (!isValidEmail(newSuppressionEmail)) return notify('error', 'Email inválido.');
    setIsWorking(true);
    try {
      const created = await emailSuppressionService.add(newSuppressionEmail);
      setSuppressions((current) => [created, ...current]);
      setNewSuppressionEmail('');
      notify('success', 'Endereço adicionado à lista de supressões.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const liftSuppression = async (item: EmailSuppression) => {
    setIsWorking(true);
    try {
      await emailSuppressionService.lift(item.id);
      setSuppressions((current) => current.filter((candidate) => candidate.id !== item.id));
      notify('success', 'Supressão levantada.');
    } catch (error: any) { notify('error', error.message); }
    finally { setIsWorking(false); }
  };

  const tabItems: Array<{ id: EmailTab; label: string; icon: React.ReactNode }> = [
    { id: 'compose', label: 'Criar', icon: <Edit3 size={16} /> },
    { id: 'scheduled', label: 'Agendadas', icon: <CalendarClock size={16} /> },
    { id: 'history', label: 'Envios', icon: <History size={16} /> },
    { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={16} /> },
    { id: 'automations', label: 'Automações', icon: <Workflow size={16} /> },
    { id: 'suppressions', label: 'Supressões', icon: <Ban size={16} /> },
  ];

  const renderCampaignTable = (campaigns: CampaignHistory[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-3 text-left">Campanha</th><th className="px-4 py-3 text-left">Data</th><th className="px-4 py-3 text-center">Progresso</th><th className="px-4 py-3 text-center">Estado</th><th className="px-4 py-3 text-right">Ações</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {campaigns.map((campaign) => {
            const total = campaign.eligible_count ?? campaign.recipient_count;
            const completed = (campaign.success_count || 0) + (campaign.failure_count || 0) + (campaign.bounce_count || 0);
            return (
              <tr key={campaign.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3"><p className="font-semibold text-slate-800 max-w-xl truncate">{campaign.subject}</p><p className="text-xs text-slate-500 mt-0.5">{campaign.group_name} · {campaign.campaign_type === 'marketing' ? 'Marketing' : 'Serviço'}</p></td>
                <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">{new Date(campaign.scheduled_at || campaign.sent_at).toLocaleString('pt-PT')}</td>
                <td className="px-4 py-3 min-w-44"><div className="flex justify-between text-xs mb-1"><span>{completed}/{total}</span><span>{campaign.excluded_count || 0} excl.</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${total ? Math.min(100, completed / total * 100) : 0}%` }} /></div></td>
                <td className="px-4 py-3 text-center"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${statusTone(campaign.delivery_status)}`}>{campaign.status}</span></td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2">
                  <button onClick={() => void openCampaignDetails(campaign)} className="p-2 border rounded-lg text-slate-600 hover:bg-slate-100" title="Ver destinatários"><Eye size={15} /></button>
                  {canEdit && campaign.delivery_status === 'draft' && <button onClick={() => void controlCampaign(campaign, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"><Check size={14} className="inline mr-1" />Aprovar</button>}
                  {canEdit && ['draft', 'scheduled', 'queued'].includes(campaign.delivery_status || '') && <button onClick={() => void controlCampaign(campaign, 'cancel')} className="p-2 border border-red-200 rounded-lg text-red-600 hover:bg-red-50" title="Cancelar"><X size={15} /></button>}
                  {canCreate && ['partial', 'failed'].includes(campaign.delivery_status || '') && <button onClick={() => void prepareRetry(campaign)} className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-700">Preparar reenvio</button>}
                </div></td>
              </tr>
            );
          })}
          {!campaigns.length && <tr><td colSpan={5} className="py-14 text-center text-slate-400">Sem campanhas neste estado.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      {toast && <div role="status" className={`fixed top-20 right-5 z-[80] max-w-md rounded-xl px-4 py-3 shadow-xl border text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>{toast.message}</div>}

      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-3 text-white shadow-sm md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold md:text-2xl">Comunicações por Email</h1>
            <p className="mt-1 text-xs text-slate-200 md:text-sm">Campanhas persistentes, agendamento real e proteção de destinatários.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg bg-white/10 px-4 py-2"><p className="text-[11px] uppercase font-bold text-slate-300">Na fila</p><p className="text-xl font-bold text-white">{history.filter((item) => ['queued', 'processing'].includes(item.delivery_status || '')).length}</p></div>
            <div className="rounded-lg bg-white/10 px-4 py-2"><p className="text-[11px] uppercase font-bold text-slate-300">Agendadas</p><p className="text-xl font-bold text-white">{history.filter((item) => item.delivery_status === 'scheduled').length}</p></div>
            <div className="rounded-lg bg-white/10 px-4 py-2"><p className="text-[11px] uppercase font-bold text-slate-300">Supressões</p><p className="text-xl font-bold text-white">{suppressions.length}</p></div>
          </div>
        </div>
      </section>

      <nav className="bg-white border rounded-xl p-1.5 flex gap-1 overflow-x-auto" aria-label="Secções de email">
        {tabItems.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap ${activeTab === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{tab.icon}{tab.label}</button>)}
      </nav>

      {activeTab === 'compose' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 overflow-x-auto">
            {['1. Conteúdo', '2. Destinatários', '3. Validação', '4. Rever e enviar'].map((step, index) => <React.Fragment key={step}><span className={`px-3 py-1.5 rounded-full ${index < 2 || selectedRecipients.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100'}`}>{step}</span>{index < 3 && <ChevronRight size={14} />}</React.Fragment>)}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <section className="xl:col-span-7 bg-white border rounded-2xl p-5 shadow-sm space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <label className="text-sm font-semibold text-slate-700">Template
                  <select value={selectedTemplateId} onChange={(event) => selectTemplate(event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 bg-white font-normal">
                    <option value="">Sem template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.category || 'Geral'} · {template.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">Finalidade
                  <select value={campaignType} onChange={(event) => setCampaignType(event.target.value as 'service' | 'marketing')} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 bg-white font-normal">
                    <option value="service">Comunicação de serviço</option><option value="marketing">Marketing direto</option>
                  </select>
                </label>
              </div>
              {campaignType === 'marketing' && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex gap-2"><ShieldCheck size={18} className="shrink-0" /><span>Apenas clientes com consentimento ou interesse legítimo registado ficam elegíveis. O link de oposição será incluído automaticamente.</span></div>}
              <label className="block text-sm font-semibold text-slate-700">Assunto<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 font-normal" placeholder="Assunto claro e específico" /></label>
              <label className="block text-sm font-semibold text-slate-700">Preheader <span className="font-normal text-slate-400">(texto apresentado junto ao assunto)</span><input value={preheader} onChange={(event) => setPreheader(event.target.value)} maxLength={180} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 font-normal" placeholder="Resumo curto do email" /></label>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><label className="text-sm font-semibold text-slate-700">Mensagem</label><div className="flex gap-1">
                  <button type="button" onClick={() => wrapSelection('**')} className="p-2 border rounded-lg hover:bg-slate-50" title="Negrito"><Bold size={16} /></button>
                  <button type="button" onClick={() => insertAtCursor(body, setBody, bodyRef.current, '\n- Item')} className="p-2 border rounded-lg hover:bg-slate-50" title="Lista"><List size={16} /></button>
                  <button type="button" onClick={() => wrapSelection('[', '](https://)')} className="p-2 border rounded-lg hover:bg-slate-50" title="Ligação"><Link2 size={16} /></button>
                </div></div>
                <textarea ref={bodyRef} value={body} onChange={(event) => setBody(event.target.value)} className="w-full min-h-[330px] border rounded-xl p-4 text-[15px] leading-7 resize-y" placeholder="Olá {{name}},&#10;&#10;Escreva aqui a sua mensagem..." />
                <div className="mt-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Inserir variável no cursor</p><div className="flex flex-wrap gap-1.5">{ALL_EMAIL_VARIABLES.map((variable) => <button key={variable} type="button" onClick={() => insertAtCursor(body, setBody, bodyRef.current, `{{${variable}}}`)} className="px-2 py-1 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-xs font-mono">{`{{${variable}}}`}</button>)}</div></div>
              </div>
            </section>

            <aside className="xl:col-span-5 space-y-5 xl:sticky xl:top-4">
              <section className="bg-white border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b flex items-center justify-between"><div><p className="font-bold text-slate-800">Pré-visualização real</p><p className="text-xs text-slate-500">Inclui personalização e assinatura</p></div><div className="flex bg-slate-100 rounded-lg p-1"><button onClick={() => setPreviewDevice('desktop')} className={`p-1.5 rounded ${previewDevice === 'desktop' ? 'bg-white shadow' : ''}`} title="Desktop"><Monitor size={15} /></button><button onClick={() => setPreviewDevice('mobile')} className={`p-1.5 rounded ${previewDevice === 'mobile' ? 'bg-white shadow' : ''}`} title="Telemóvel"><Smartphone size={15} /></button></div></div>
                <div className="p-3 bg-slate-100 min-h-[370px] flex justify-center">
                  {preview ? <div className={`bg-white shadow-sm transition-all ${previewDevice === 'mobile' ? 'w-[340px]' : 'w-full'}`}><div className="px-3 py-2 border-b text-xs"><strong>Assunto:</strong> {preview.subject}</div><iframe title="Preview do email" sandbox="" srcDoc={buildEmailPreviewDocument(preview.html, preheader, campaignType)} className="w-full h-[330px] border-0" /></div> : <div className="self-center text-sm text-slate-400 text-center"><Eye className="mx-auto mb-2" />Selecione um destinatário para visualizar.</div>}
                </div>
                {selectedClients.length > 1 && <div className="p-3 border-t"><select value={previewClient?.id || ''} onChange={(event) => setPreviewClientId(event.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">{selectedClients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.email}</option>)}</select></div>}
              </section>

              <section className="bg-white border rounded-2xl p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between"><div><p className="font-bold text-slate-800 flex items-center gap-2"><Users size={17} />Destinatários</p><p className="text-xs text-slate-500">{selectedRecipients.length} selecionados de {hygieneCounts.eligible} elegíveis</p></div><button onClick={() => setIsRecipientModalOpen(true)} className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold">Selecionar</button></div>
                <select value={selectedGroupId} onChange={(event) => { setSelectedGroupId(event.target.value); setSelectedRecipients([]); }} className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm"><option value="all">Todos os clientes visíveis</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
                <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="bg-emerald-50 text-emerald-800 rounded-lg p-2"><strong className="block text-lg">{hygieneCounts.eligible}</strong>Elegíveis</div><div className="bg-amber-50 text-amber-800 rounded-lg p-2"><strong className="block text-lg">{hygieneCounts.inactive + hygieneCounts.invalid + hygieneCounts.duplicate}</strong>Dados</div><div className="bg-red-50 text-red-800 rounded-lg p-2"><strong className="block text-lg">{hygieneCounts.suppressed + hygieneCounts.noConsent}</strong>Protegidos</div></div>
                <div className="border-t pt-4 space-y-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isScheduled} onChange={(event) => setIsScheduled(event.target.checked)} />Agendar no servidor</label>
                  {isScheduled && <input type="datetime-local" min={localDateTimeMin()} value={scheduleDateTime} onChange={(event) => setScheduleDateTime(event.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />}
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} />Criar como rascunho para aprovação</label>
                </div>
                <div className="flex gap-2"><input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Email de teste" /><button onClick={() => void sendTest()} disabled={isWorking} className="px-3 py-2 border rounded-lg text-sm font-bold whitespace-nowrap"><Mail size={15} className="inline mr-1" />Testar</button></div>
                {validationIssues.length > 0 && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800"><p className="font-bold flex gap-2"><AlertTriangle size={17} />Corrigir antes de enviar</p><ul className="list-disc pl-5 mt-1 space-y-1">{validationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
                <button onClick={openReview} disabled={!canCreate || isWorking || selectedRecipients.length === 0} className="w-full bg-slate-900 text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 disabled:opacity-40"><ShieldCheck size={18} />Rever e {isScheduled ? 'agendar' : requiresApproval ? 'guardar' : 'enviar'}</button>
              </section>
            </aside>
          </div>
        </div>
      )}

      {activeTab === 'scheduled' && <section className="bg-white border rounded-2xl shadow-sm overflow-hidden"><div className="p-5 border-b"><h3 className="font-bold text-lg">Agendamentos e aprovações</h3><p className="text-sm text-slate-500">A fila continua a ser processada mesmo com o browser fechado.</p></div>{renderCampaignTable(history.filter((campaign) => ['draft', 'scheduled', 'queued', 'processing'].includes(campaign.delivery_status || '')))}</section>}

      {activeTab === 'history' && <section className="bg-white border rounded-2xl shadow-sm overflow-hidden"><div className="p-5 border-b flex justify-between items-center"><div><h3 className="font-bold text-lg">Histórico de envios</h3><p className="text-sm text-slate-500">Aceite pelo SMTP não significa necessariamente entregue; os webhooks atualizam o estado final.</p></div><button onClick={() => void loadCampaigns(campaignPage)} className="p-2 border rounded-lg" title="Atualizar"><RefreshCcw size={16} /></button></div>{renderCampaignTable(history)}<div className="p-4 border-t flex justify-between items-center text-sm"><span>{campaignTotal} campanha(s)</span><div className="flex items-center gap-2"><button disabled={campaignPage === 1} onClick={() => setCampaignPage((page) => Math.max(1, page - 1))} className="p-2 border rounded-lg disabled:opacity-30"><ChevronLeft size={16} /></button><span>Página {campaignPage} de {Math.max(1, Math.ceil(campaignTotal / PAGE_SIZE))}</span><button disabled={campaignPage >= Math.ceil(campaignTotal / PAGE_SIZE)} onClick={() => setCampaignPage((page) => page + 1)} className="p-2 border rounded-lg disabled:opacity-30"><ChevronRight size={16} /></button></div></div></section>}

      {activeTab === 'templates' && <div className="grid lg:grid-cols-3 gap-5 items-start">
        <section className="bg-white border rounded-2xl p-4 shadow-sm"><div className="flex justify-between items-center mb-3"><h3 className="font-bold">Biblioteca</h3>{canCreate && <button onClick={() => setTemplateDraft({ name: '', subject: '', body: '', preheader: '', category: 'Geral', approval_status: 'draft' })} className="p-2 bg-blue-600 text-white rounded-lg" title="Novo"><Plus size={16} /></button>}</div><div className="space-y-2 max-h-[650px] overflow-y-auto">{templates.map((template) => <button key={template.id} onClick={() => setTemplateDraft({ ...template })} className={`w-full text-left p-3 border rounded-xl ${templateDraft?.id === template.id ? 'border-blue-400 bg-blue-50' : 'hover:bg-slate-50'}`}><div className="flex justify-between gap-2"><span className="font-semibold text-sm">{template.name}</span><span className={`text-[10px] px-2 py-0.5 rounded-full ${template.approval_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{template.approval_status === 'approved' ? 'Aprovado' : 'Rascunho'}</span></div><p className="text-xs text-slate-500 mt-1 truncate">{template.category || 'Geral'} · v{template.version || 1}</p></button>)}</div></section>
        <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm">{templateDraft ? <div className="space-y-4"><div className="flex justify-between items-center"><h3 className="font-bold text-lg">{templateDraft.id ? 'Editar template' : 'Novo template'}</h3><div className="flex gap-2">{templateDraft.id && canDelete && <button onClick={() => setTemplateDeleteId(templateDraft.id || null)} className="p-2 border border-red-200 text-red-600 rounded-lg" title="Arquivar"><Archive size={16} /></button>}<button onClick={() => setTemplateDraft(null)} className="p-2 border rounded-lg"><X size={16} /></button></div></div>
          <div className="grid md:grid-cols-3 gap-3"><label className="text-sm font-semibold">Nome<input value={templateDraft.name || ''} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Categoria<input value={templateDraft.category || ''} onChange={(event) => setTemplateDraft({ ...templateDraft, category: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Estado<select disabled={!canEdit} value={templateDraft.approval_status || 'draft'} onChange={(event) => setTemplateDraft({ ...templateDraft, approval_status: event.target.value as EmailTemplate['approval_status'] })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-white font-normal"><option value="draft">Rascunho</option><option value="approved">Aprovado</option></select></label></div>
          <label className="block text-sm font-semibold">Assunto<input value={templateDraft.subject || ''} onChange={(event) => setTemplateDraft({ ...templateDraft, subject: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="block text-sm font-semibold">Preheader<input value={templateDraft.preheader || ''} onChange={(event) => setTemplateDraft({ ...templateDraft, preheader: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label>
          <textarea ref={templateBodyRef} value={templateDraft.body || ''} onChange={(event) => setTemplateDraft({ ...templateDraft, body: event.target.value })} className="w-full min-h-64 border rounded-xl p-4 text-[15px] leading-7" />
          <div className="flex flex-wrap gap-1.5">{ALL_EMAIL_VARIABLES.map((variable) => <button key={variable} onClick={() => insertAtCursor(templateDraft.body || '', (value) => setTemplateDraft({ ...templateDraft, body: value }), templateBodyRef.current, `{{${variable}}}`)} className="px-2 py-1 bg-slate-100 rounded text-xs font-mono">{`{{${variable}}}`}</button>)}</div>
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4"><p className="font-bold text-indigo-900 flex items-center gap-2"><BrainCircuit size={17} />Assistente de rascunho</p><div className="grid md:grid-cols-[1fr,160px,auto] gap-2 mt-3"><input value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} className="border rounded-lg px-3 py-2 text-sm" placeholder="Tema e pontos obrigatórios" /><select value={aiTone} onChange={(event) => setAiTone(event.target.value)} className="border rounded-lg px-3 py-2 bg-white text-sm"><option>Profissional</option><option>Informativo</option><option>Próximo</option></select><button onClick={() => void generateWithAi()} disabled={isGenerating} className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-bold">{isGenerating ? 'A gerar…' : 'Gerar'}</button></div><p className="text-xs text-indigo-700 mt-2">A IA cria apenas um rascunho; confirme sempre prazos, valores e enquadramento legal.</p></div>
          <div className="flex justify-end"><button onClick={() => void saveTemplate()} disabled={!canEdit && Boolean(templateDraft.id) || !canCreate && !templateDraft.id || isWorking} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold flex gap-2 disabled:opacity-40"><Save size={17} />Guardar template</button></div>
        </div> : <div className="py-24 text-center text-slate-400"><LayoutTemplate className="mx-auto mb-3" size={36} /><p>Selecione ou crie um template.</p></div>}</section>
      </div>}

      {activeTab === 'automations' && <div className="grid lg:grid-cols-3 gap-5 items-start"><section className="bg-white border rounded-2xl p-4 shadow-sm"><div className="flex justify-between items-center mb-3"><div><h3 className="font-bold">Regras mensais</h3><p className="text-xs text-slate-500">Uma execução por mês</p></div>{canCreate && <button onClick={() => setAutomationDraft({ name: '', is_active: true, client_group: groups[0]?.name || '', admin_email: accessProfile.email, from_name: globalSettings.fromName || '', from_email: globalSettings.fromEmail || '', reply_to: globalSettings.fromEmail || '', subject_hint: '', ai_instructions: '', schedule_day: 1, schedule_hour: 9, requires_approval: true, campaign_type: 'service' })} className="p-2 bg-blue-600 text-white rounded-lg"><Plus size={16} /></button>}</div><div className="space-y-2">{automations.map((automation) => <button key={automation.id} onClick={() => setAutomationDraft({ ...automation })} className={`w-full text-left p-3 border rounded-xl ${automationDraft?.id === automation.id ? 'border-blue-400 bg-blue-50' : ''}`}><div className="flex justify-between"><span className="font-semibold text-sm">{automation.name}</span><span className={`text-xs ${automation.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>{automation.is_active ? 'Ativo' : 'Pausado'}</span></div><p className="text-xs text-slate-500 mt-1">Dia {automation.schedule_day || 1}, {String(automation.schedule_hour || 9).padStart(2, '0')}:00 · {automation.client_group}</p></button>)}</div></section>
        <section className="lg:col-span-2 bg-white border rounded-2xl p-5 shadow-sm">{automationDraft ? <div className="space-y-4"><div className="flex justify-between"><div><h3 className="font-bold text-lg">Configurar automatismo</h3><p className="text-sm text-slate-500">Gera uma campanha mensal; aprovação humana ativa por omissão.</p></div><button onClick={() => setAutomationDraft(null)}><X size={18} /></button></div><div className="grid md:grid-cols-2 gap-3"><label className="text-sm font-semibold">Nome<input value={automationDraft.name || ''} onChange={(event) => setAutomationDraft({ ...automationDraft, name: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Grupo<select value={automationDraft.client_group || ''} onChange={(event) => setAutomationDraft({ ...automationDraft, client_group: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 bg-white font-normal">{groups.map((group) => <option key={group.id}>{group.name}</option>)}</select></label><label className="text-sm font-semibold">Dia do mês<input type="number" min={1} max={28} value={automationDraft.schedule_day || 1} onChange={(event) => setAutomationDraft({ ...automationDraft, schedule_day: Number(event.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Hora<input type="number" min={0} max={23} value={automationDraft.schedule_hour ?? 9} onChange={(event) => setAutomationDraft({ ...automationDraft, schedule_hour: Number(event.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label></div><label className="block text-sm font-semibold">Sugestão de assunto<input value={automationDraft.subject_hint || ''} onChange={(event) => setAutomationDraft({ ...automationDraft, subject_hint: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" /></label><label className="block text-sm font-semibold">Instruções obrigatórias<textarea value={automationDraft.ai_instructions || ''} onChange={(event) => setAutomationDraft({ ...automationDraft, ai_instructions: event.target.value })} className="mt-1 w-full min-h-40 border rounded-lg p-3 font-normal" placeholder="Informação validada que o rascunho deve conter. Não dependa da IA para inventar prazos." /></label><div className="grid md:grid-cols-2 gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automationDraft.is_active !== false} onChange={(event) => setAutomationDraft({ ...automationDraft, is_active: event.target.checked })} />Automatismo ativo</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automationDraft.requires_approval !== false} onChange={(event) => setAutomationDraft({ ...automationDraft, requires_approval: event.target.checked })} />Exigir aprovação antes de enviar</label></div><div className="flex justify-end gap-2">{automationDraft.id && <button onClick={() => void runAutomation(automationDraft as EmailAutomation)} disabled={isWorking} className="px-4 py-2.5 border rounded-lg font-bold flex gap-2"><Play size={16} />Executar agora</button>}<button onClick={() => void saveAutomation()} disabled={isWorking || (!canEdit && Boolean(automationDraft.id)) || (!canCreate && !automationDraft.id)} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-bold flex gap-2 disabled:opacity-40"><Save size={16} />Guardar</button></div></div> : <div className="py-24 text-center text-slate-400"><Workflow className="mx-auto mb-3" size={36} />Selecione ou crie um automatismo.</div>}</section></div>}

      {activeTab === 'suppressions' && <section className="bg-white border rounded-2xl shadow-sm overflow-hidden"><div className="p-5 border-b flex flex-col md:flex-row md:items-end justify-between gap-4"><div><h3 className="font-bold text-lg">Lista de supressões</h3><p className="text-sm text-slate-500">Opt-outs, devoluções permanentes, denúncias e bloqueios manuais.</p></div>{canCreate && <div className="flex gap-2"><input type="email" value={newSuppressionEmail} onChange={(event) => setNewSuppressionEmail(event.target.value)} className="border rounded-lg px-3 py-2 text-sm min-w-64" placeholder="email@dominio.pt" /><button onClick={() => void addSuppression()} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold">Bloquear</button></div>}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="text-left px-4 py-3">Email</th><th className="text-left px-4 py-3">Motivo</th><th className="text-left px-4 py-3">Origem</th><th className="text-left px-4 py-3">Data</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y">{suppressions.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.email}</td><td className="px-4 py-3">{item.reason}</td><td className="px-4 py-3 text-slate-500">{item.source}</td><td className="px-4 py-3 text-slate-500">{new Date(item.created_at).toLocaleString('pt-PT')}</td><td className="px-4 py-3 text-right">{canEdit && <button onClick={() => void liftSuppression(item)} className="text-blue-700 font-bold text-xs">Levantar</button>}</td></tr>)}{!suppressions.length && <tr><td colSpan={5} className="py-14 text-center text-slate-400">Sem endereços suprimidos.</td></tr>}</tbody></table></div></section>}

      {isRecipientModalOpen && <div className="fixed inset-0 z-[70] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Selecionar destinatários"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"><div className="p-5 border-b flex justify-between"><div><h3 className="font-bold text-lg">Selecionar destinatários</h3><p className="text-sm text-slate-500">Destinatários protegidos não podem ser selecionados.</p></div><button onClick={() => setIsRecipientModalOpen(false)}><X size={20} /></button></div><div className="p-4 border-b space-y-3"><div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input autoFocus value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} className="w-full border rounded-lg pl-10 pr-3 py-2.5" placeholder="Pesquisar nome, email ou NIF" /></div><div className="flex justify-between text-sm"><span>{selectedRecipients.length} selecionados</span><button onClick={() => { const eligibleVisible = filteredRecipients.filter((client) => eligibility.get(client.id) === '').map((client) => client.id); const allSelected = eligibleVisible.every((id) => selectedRecipients.includes(id)); setSelectedRecipients((current) => allSelected ? current.filter((id) => !eligibleVisible.includes(id)) : Array.from(new Set([...current, ...eligibleVisible]))); }} className="text-blue-700 font-bold">Selecionar/desselecionar elegíveis</button></div></div><div className="overflow-y-auto flex-1 p-3"><div className="divide-y border rounded-xl">{filteredRecipients.map((client) => { const reason = eligibility.get(client.id) || ''; return <label key={client.id} className={`flex items-center gap-3 p-3 ${reason ? 'bg-slate-50 opacity-65' : 'hover:bg-blue-50 cursor-pointer'}`}><input type="checkbox" disabled={Boolean(reason)} checked={selectedRecipients.includes(client.id)} onChange={() => setSelectedRecipients((current) => current.includes(client.id) ? current.filter((id) => id !== client.id) : [...current, client.id])} /><div className="min-w-0 flex-1"><p className="font-semibold text-sm truncate">{client.name}</p><p className="text-xs text-slate-500 truncate">{client.email || 'Sem email'} · {client.nif}</p></div>{reason && <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-1 rounded">{reason}</span>}</label>; })}</div></div><div className="p-4 border-t flex justify-end"><button onClick={() => setIsRecipientModalOpen(false)} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold">Confirmar seleção</button></div></div></div>}

      {isReviewOpen && <div className="fixed inset-0 z-[70] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Rever campanha"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6"><div className="flex justify-between"><div><h3 className="font-bold text-xl">Revisão final</h3><p className="text-sm text-slate-500">Confirme o público e o modo de envio.</p></div><button onClick={() => setIsReviewOpen(false)}><X size={20} /></button></div><div className="grid grid-cols-3 gap-3 my-5 text-center"><div className="bg-slate-50 rounded-xl p-3"><p className="text-xs uppercase font-bold text-slate-400">Destinatários</p><p className="text-2xl font-bold">{selectedRecipients.length}</p></div><div className="bg-slate-50 rounded-xl p-3"><p className="text-xs uppercase font-bold text-slate-400">Tipo</p><p className="font-bold mt-1">{campaignType === 'marketing' ? 'Marketing' : 'Serviço'}</p></div><div className="bg-slate-50 rounded-xl p-3"><p className="text-xs uppercase font-bold text-slate-400">Modo</p><p className="font-bold mt-1">{requiresApproval ? 'Rascunho' : isScheduled ? 'Agendado' : 'Imediato'}</p></div></div><div className="border rounded-xl overflow-hidden"><div className="px-4 py-2 border-b bg-slate-50"><p className="text-xs uppercase font-bold text-slate-400">Assunto de exemplo</p><p className="font-semibold text-sm">{preview?.subject}</p></div>{preview ? <iframe title="Preview final do email" sandbox="" srcDoc={buildEmailPreviewDocument(preview.html, preheader, campaignType)} className="w-full h-[260px] border-0" /> : <p className="p-4 text-sm text-slate-400">Sem destinatário elegível para pré-visualizar.</p>}{isScheduled && <p className="text-sm text-violet-700 px-4 pb-3">Envio a {new Date(scheduleDateTime).toLocaleString('pt-PT')}</p>}</div><div className="bg-blue-50 border border-blue-100 text-blue-900 rounded-xl p-3 mt-4 text-sm flex gap-2"><ShieldCheck size={18} className="shrink-0" /><span>Depois de confirmar, a campanha fica guardada no servidor com idempotência e tentativas automáticas. Fechar o browser não interrompe o envio.</span></div><div className="flex justify-end gap-3 mt-6"><button onClick={() => setIsReviewOpen(false)} className="px-4 py-2.5 border rounded-lg font-bold">Voltar</button><button onClick={() => void createCampaign()} disabled={isWorking} className="px-5 py-2.5 bg-slate-900 text-white rounded-lg font-bold flex gap-2 disabled:opacity-40">{isWorking ? <RefreshCcw size={17} className="animate-spin" /> : <Send size={17} />}Confirmar</button></div></div></div>}

      {selectedCampaign && <div className="fixed inset-0 z-[70] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Detalhes da campanha"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"><div className="p-5 border-b flex justify-between"><div><h3 className="font-bold text-lg">Destinatários da campanha</h3><p className="text-sm text-slate-500 max-w-2xl truncate">{selectedCampaign.subject}</p></div><button onClick={() => setSelectedCampaign(null)}><X size={20} /></button></div><div className="overflow-auto flex-1"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="text-left px-4 py-3">Destinatário</th><th className="text-left px-4 py-3">Estado</th><th className="text-center px-4 py-3">Tentativas</th><th className="text-center px-4 py-3">Aberto</th><th className="text-left px-4 py-3">Detalhe</th></tr></thead><tbody className="divide-y">{recipientDetails.map((detail) => <tr key={detail.id || detail.email}><td className="px-4 py-3"><p className="font-semibold">{detail.name}</p><p className="text-xs text-slate-500">{detail.email}</p></td><td className="px-4 py-3"><span className="text-xs font-bold px-2 py-1 rounded bg-slate-100">{recipientStatusLabel[detail.status] || detail.status}</span></td><td className="px-4 py-3 text-center">{detail.attempts ?? '-'}/{detail.max_attempts ?? '-'}</td><td className="px-4 py-3 text-center">{detail.opened_at ? <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700" title={new Date(detail.opened_at).toLocaleString('pt-PT')}><Eye size={13} />{detail.open_count && detail.open_count > 1 ? `${detail.open_count}x` : ''}</span> : <span className="text-xs text-slate-300">—</span>}</td><td className="px-4 py-3 text-xs text-red-700">{detail.error || detail.exclusion_reason || detail.provider_message_id || '-'}</td></tr>)}{isLoadingDetails && <tr><td colSpan={5} className="py-14 text-center"><RefreshCcw className="animate-spin mx-auto" /></td></tr>}{!isLoadingDetails && !recipientDetails.length && <tr><td colSpan={5} className="py-14 text-center text-slate-400">Sem detalhe disponível.</td></tr>}</tbody></table></div><div className="p-4 border-t text-right"><button onClick={() => setSelectedCampaign(null)} className="px-5 py-2 bg-slate-900 text-white rounded-lg font-bold">Fechar</button></div></div></div>}

      {templateDeleteId && <div className="fixed inset-0 z-[80] bg-slate-950/60 p-4 flex items-center justify-center"><div className="bg-white rounded-2xl p-6 max-w-md"><h3 className="font-bold text-lg">Arquivar template?</h3><p className="text-sm text-slate-500 mt-2">O histórico mantém a versão usada nas campanhas anteriores.</p><div className="flex justify-end gap-2 mt-6"><button onClick={() => setTemplateDeleteId(null)} className="px-4 py-2 border rounded-lg">Cancelar</button><button onClick={() => void archiveTemplate()} className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold">Arquivar</button></div></div></div>}
    </div>
  );
};

export default EmailCampaigns;

