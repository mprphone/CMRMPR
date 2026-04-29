import React, { useEffect, useMemo, useState } from 'react';
import { Client, FeeGroup } from '../types';
import IrsControlSection from './cashier/IrsControlSection';
import { useIrsControl } from './cashier/useIrsControl';
import { appConfigService, clientService, groupService, importClient, saftDossierService } from '../services/supabase';

interface IrsControlProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  groups: FeeGroup[];
  setGroups: React.Dispatch<React.SetStateAction<FeeGroup[]>>;
}

export interface IrsHouseholdMemberInfo {
  key: string;
  relation: string;
  name: string;
  nif: string;
  atUsername: string;
  atPassword: string;
  isPrimary?: boolean;
}

export interface IrsClientFichaInfo {
  householdSummary: string;
  atUsername: string;
  atPassword: string;
  householdMembers: IrsHouseholdMemberInfo[];
}

interface ImportClientRow {
  id: string;
  nome?: string;
  nif?: string;
  agregado_familiar_json?: unknown;
  fichas_relacionadas_json?: unknown;
}

interface ImportCredentialRow {
  cliente_id: string;
  tipo_servico?: string;
  username?: string;
  password_encrypted?: string;
  ativo?: boolean;
}

interface ManualIrsRelation {
  sourceNif: string;
  targetNif: string;
  relation: string;
  createdAt: string;
}

interface ApplyPdfSuggestionsPayload {
  subjectANif: string;
  subjectBNif: string;
  dependentNifs: string[];
  namesByNif?: Record<string, string>;
}

interface ApplyPdfSuggestionsResult {
  createdClientsStore: number;
  createdClientsImport: number;
  createdRelations: number;
  createdRelationsImport: number;
  addedToIrsGroup: number;
  errors: string[];
}

const IRS_MANUAL_RELATIONS_APP_CONFIG_KEY = 'irs_manual_relations_v1';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeNif = (value: unknown): string => normalizeText(value).replace(/\D/g, '');

const normalizeSearchText = (value: unknown): string => (
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);

const collectRowsFromCandidate = (candidate: unknown, nestedKeys: string[]): any[] => {
  const rows: any[] = [];
  if (Array.isArray(candidate)) {
    rows.push(...candidate);
    return rows;
  }
  if (!candidate || typeof candidate !== 'object') return rows;

  const candidateObject = candidate as Record<string, unknown>;
  nestedKeys.forEach((key) => {
    const value = candidateObject[key];
    if (Array.isArray(value)) {
      rows.push(...value);
    }
  });
  return rows;
};

const collectRows = (source: Record<string, unknown>, rootKeys: string[], nestedKeys: string[]): any[] => {
  const rows: any[] = [];
  rootKeys.forEach((key) => {
    rows.push(...collectRowsFromCandidate(source[key], nestedKeys));
  });
  return rows;
};

const collectRowsByShape = (
  source: Record<string, unknown>,
  itemPredicate: (item: Record<string, unknown>) => boolean
): any[] => {
  const rows: any[] = [];

  Object.values(source).forEach((value) => {
    const candidates = collectRowsFromCandidate(value, ['rows', 'items', 'list', 'values', 'data']);
    candidates.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      const candidateObject = candidate as Record<string, unknown>;
      if (itemPredicate(candidateObject)) {
        rows.push(candidateObject);
      }
    });
  });

  return rows;
};

const parseMaybeJsonArray = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? parsed.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const resolveRelatedName = (row: any, clientsById: Map<string, Client>): string => {
  const directCandidates = [
    row?.relatedClientName,
    row?.related_name,
    row?.relatedName,
    row?.name,
    row?.nome,
    row?.clientName,
    row?.fichaRelacionadaNome,
    row?.label,
    row?.fichaRelacionada,
  ];

  for (const candidate of directCandidates) {
    const value = normalizeText(candidate);
    if (value) return value;
  }

  const relationObjectCandidates = [row?.relatedClient, row?.client, row?.ficha, row?.relatedSheet];
  for (const candidate of relationObjectCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const obj = candidate as Record<string, unknown>;
    const objectCandidates = [obj.name, obj.nome, obj.clientName, obj.label];
    for (const objectCandidate of objectCandidates) {
      const value = normalizeText(objectCandidate);
      if (value) return value;
    }
  }

  const idCandidates = [
    row?.relatedClientId,
    row?.related_client_id,
    row?.relatedId,
    row?.clientId,
    row?.client_id,
    row?.fichaId,
    row?.ficha_id,
  ];

  for (const idCandidate of idCandidates) {
    const relatedId = normalizeText(idCandidate);
    if (!relatedId) continue;
    const relatedClient = clientsById.get(relatedId);
    if (relatedClient) return relatedClient.name;
  }

  return '';
};

const extractHouseholdSummary = (client: Client, clientsById: Map<string, Client>): string => {
  const clientRecord = client as unknown as Record<string, unknown>;
  const familyRows = collectRows(
    clientRecord,
    [
      'agregadoFamiliar',
      'agregado_familiar',
      'familyRelations',
      'family_relations',
      'fichasRelacionadas',
      'fichas_relacionadas',
      'relatedRecords',
      'related_records',
      'relatedCards',
      'related_cards',
    ],
    [
      'rows',
      'items',
      'list',
      'agregadoFamiliar',
      'agregado_familiar',
      'familyRelations',
      'family_relations',
      'fichasRelacionadas',
      'fichas_relacionadas',
    ]
  );

  const fallbackFamilyRows = familyRows.length > 0
    ? []
    : collectRowsByShape(
        clientRecord,
        (item) => (
          'relation' in item ||
          'relacao' in item ||
          'relationship' in item ||
          'parentesco' in item ||
          'fichaRelacionada' in item ||
          'relatedClientId' in item ||
          'relatedClientName' in item
        )
      );

  const rowsToProcess = familyRows.length > 0 ? familyRows : fallbackFamilyRows;
  const spouseNames = new Set<string>();
  const childrenNames = new Set<string>();

  rowsToProcess.forEach((row) => {
    const relation = normalizeSearchText(
      row?.relation ?? row?.relacao ?? row?.relationship ?? row?.type ?? row?.tipo ?? row?.parentesco
    );
    if (!relation) return;

    const relatedName = resolveRelatedName(row, clientsById);
    if (!relatedName) return;

    if (relation.includes('conjuge') || relation.includes('marido') || relation.includes('esposa')) {
      spouseNames.add(relatedName);
      return;
    }

    if (relation.includes('filho') || relation.includes('filha') || relation.includes('dependente') || relation.includes('child')) {
      childrenNames.add(relatedName);
    }
  });

  const parts: string[] = [];
  if (spouseNames.size > 0) {
    parts.push(`Conjuge: ${Array.from(spouseNames).join(', ')}`);
  }
  if (childrenNames.size > 0) {
    parts.push(`Filhos: ${Array.from(childrenNames).join(', ')}`);
  }

  return parts.join(' | ');
};

const extractFinancasCredentials = (client: Client): { atUsername: string; atPassword: string } => {
  const clientRecord = client as unknown as Record<string, unknown>;
  const accessRows = collectRows(
    clientRecord,
    [
      'dadosAcesso',
      'dados_acesso',
      'accesses',
      'access_data',
      'accessData',
      'credentials',
      'loginData',
      'logins',
    ],
    [
      'rows',
      'items',
      'list',
      'dadosAcesso',
      'dados_acesso',
      'accesses',
      'credentials',
    ]
  );

  const fallbackAccessRows = accessRows.length > 0
    ? []
    : collectRowsByShape(
        clientRecord,
        (item) => (
          'service' in item ||
          'servico' in item ||
          'portal' in item ||
          'username' in item ||
          'utilizador' in item ||
          'password' in item ||
          'senha' in item
        )
      );

  const rowsToProcess = accessRows.length > 0 ? accessRows : fallbackAccessRows;
  let fallback: { atUsername: string; atPassword: string } | null = null;

  for (const row of rowsToProcess) {
    const service = normalizeSearchText(row?.service ?? row?.servico ?? row?.portal ?? row?.system ?? row?.sistema);
    const atUsername = normalizeText(row?.username ?? row?.user ?? row?.utilizador ?? row?.login ?? row?.nif);
    const atPassword = normalizeText(row?.password ?? row?.senha ?? row?.pass ?? row?.secret);

    if (!atUsername && !atPassword) continue;
    if (!fallback) fallback = { atUsername, atPassword };

    const isAtService = service.includes('financas') || service.includes('autoridade tributaria') || /\bat\b/.test(service);
    if (isAtService) {
      return { atUsername, atPassword };
    }
  }

  return fallback || { atUsername: '', atPassword: '' };
};

const getImportClientRowsByNif = async (nifs: string[]): Promise<ImportClientRow[]> => {
  if (!importClient || nifs.length === 0) return [];
  const { data, error } = await importClient
    .from('clientes')
    .select('id,nome,nif,agregado_familiar_json,fichas_relacionadas_json')
    .in('nif', nifs);
  if (error) {
    console.error('Erro ao buscar fichas no Supabase (clientes):', error);
    return [];
  }
  return (data || []) as ImportClientRow[];
};

const ensureImportClientByNif = async (nif: string, name: string): Promise<{ created: boolean; createdId?: string }> => {
  if (!importClient || !nif) return { created: false };
  const { data: existing, error: existingError } = await importClient
    .from('clientes')
    .select('id,nif')
    .eq('nif', nif)
    .limit(1);

  if (existingError) throw existingError;
  if (Array.isArray(existing) && existing.length > 0) return { created: false, createdId: normalizeText(existing[0]?.id) || undefined };

  const finalName = normalizeText(name) || `Cliente ${nif}`;
  const payloadBase = { nif, nome: finalName };
  let insertError: any = null;
  let createdId = '';
  let insertData: any[] | null = null;

  ({ data: insertData, error: insertError } = await importClient.from('clientes').insert([payloadBase]).select('id').limit(1));
  if (insertError) {
    const payloadWithId = { id: crypto.randomUUID(), ...payloadBase };
    ({ data: insertData, error: insertError } = await importClient.from('clientes').insert([payloadWithId]).select('id').limit(1));
  }
  if (insertError) throw insertError;
  createdId = normalizeText(insertData?.[0]?.id);
  return { created: true, createdId: createdId || undefined };
};

const getImportClientRowsByIds = async (ids: string[]): Promise<ImportClientRow[]> => {
  if (!importClient || ids.length === 0) return [];
  const { data, error } = await importClient
    .from('clientes')
    .select('id,nome,nif,agregado_familiar_json,fichas_relacionadas_json')
    .in('id', ids);
  if (error) {
    console.error('Erro ao buscar fichas relacionadas no Supabase (clientes):', error);
    return [];
  }
  return (data || []) as ImportClientRow[];
};

const getImportCredentialsByClientIds = async (clientIds: string[]): Promise<ImportCredentialRow[]> => {
  if (!importClient || clientIds.length === 0) return [];
  const { data, error } = await importClient
    .from('clientes_credenciais')
    .select('cliente_id,tipo_servico,username,password_encrypted,ativo')
    .in('cliente_id', clientIds)
    .eq('ativo', true);
  if (error) {
    console.error('Erro ao buscar credenciais no Supabase (clientes_credenciais):', error);
    return [];
  }
  return (data || []) as ImportCredentialRow[];
};

const buildHouseholdSummaryFromMembers = (members: IrsHouseholdMemberInfo[]): string => {
  const spouses = members.filter((member) => {
    const relation = normalizeSearchText(member.relation);
    return relation.includes('conjuge') || relation.includes('marido') || relation.includes('esposa');
  });
  const children = members.filter((member) => {
    const relation = normalizeSearchText(member.relation);
    return relation.includes('filho') || relation.includes('filha') || relation.includes('dependente') || relation.includes('child');
  });

  const parts: string[] = [];
  if (spouses.length > 0) parts.push(`Conjuge: ${spouses.map((item) => item.name).join(', ')}`);
  if (children.length > 0) parts.push(`Filhos: ${children.map((item) => item.name).join(', ')}`);
  return parts.join(' | ');
};

const IrsControl: React.FC<IrsControlProps> = ({ clients, setClients, groups, setGroups }) => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear() - 1);
  const [importFichaInfoMap, setImportFichaInfoMap] = useState<Map<string, IrsClientFichaInfo>>(new Map());
  const [saftAttachmentCountByNif, setSaftAttachmentCountByNif] = useState<Record<string, number>>({});
  const [manualRelations, setManualRelations] = useState<ManualIrsRelation[]>([]);
  const [isAddingClientToIrsGroup, setIsAddingClientToIrsGroup] = useState(false);
  const irsGroup = useMemo(() => groups.find(g => g.name.toLowerCase().includes('irs')), [groups]);
  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const clientsByNif = useMemo(
    () => new Map(clients.map((client) => [normalizeNif(client.nif), client]).filter(([nif]) => Boolean(nif))),
    [clients]
  );
  const irsGroupClients = useMemo(() => {
    if (!irsGroup) return [];
    return clients
      .filter(c => irsGroup.clientIds.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, irsGroup]);
  const availableClientsToAdd = useMemo(() => {
    if (!irsGroup) return [];
    const currentIds = new Set(irsGroup.clientIds || []);
    return clients
      .filter((client) => !currentIds.has(client.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, irsGroup]);

  useEffect(() => {
    let isCancelled = false;
    const loadManualRelations = async () => {
      try {
        const stored = await appConfigService.getValueByKey<ManualIrsRelation[]>(IRS_MANUAL_RELATIONS_APP_CONFIG_KEY);
        if (isCancelled) return;
        setManualRelations(Array.isArray(stored) ? stored : []);
      } catch (err) {
        console.error('Erro ao carregar relações IRS manuais:', err);
        if (!isCancelled) setManualRelations([]);
      }
    };

    loadManualRelations();
    return () => { isCancelled = true; };
  }, []);

  const manualRelationsBySourceNif = useMemo(() => {
    const map = new Map<string, ManualIrsRelation[]>();
    manualRelations.forEach((row) => {
      const sourceNif = normalizeNif(row.sourceNif);
      const targetNif = normalizeNif(row.targetNif);
      const relation = normalizeText(row.relation);
      if (!sourceNif || !targetNif || !relation) return;
      if (!map.has(sourceNif)) map.set(sourceNif, []);
      map.get(sourceNif)!.push({
        sourceNif,
        targetNif,
        relation,
        createdAt: normalizeText(row.createdAt) || new Date().toISOString(),
      });
    });
    return map;
  }, [manualRelations]);

  const handleQuickAddClientToIrsGroup = React.useCallback(async (clientId: string) => {
    if (!clientId) return;
    if (!irsGroup) {
      alert('Grupo IRS não encontrado. Crie/renomeie um grupo com \"IRS\" primeiro.');
      return;
    }
    if (irsGroup.clientIds.includes(clientId)) return;

    const updatedGroup: FeeGroup = {
      ...irsGroup,
      clientIds: [...irsGroup.clientIds, clientId],
    };

    setIsAddingClientToIrsGroup(true);
    try {
      const savedGroup = await groupService.upsert(updatedGroup);
      setGroups((prev) => prev.map((group) => group.id === savedGroup.id ? savedGroup : group));
    } catch (err: any) {
      console.error('Erro ao adicionar cliente ao grupo IRS:', err);
      alert('Falha ao adicionar cliente ao grupo IRS: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setIsAddingClientToIrsGroup(false);
    }
  }, [irsGroup, setGroups]);

  const buildAutoCreatedClient = React.useCallback((nif: string, name: string): Client => ({
    id: crypto.randomUUID(),
    name: normalizeText(name) || `Cliente ${nif}`,
    email: '',
    phone: '',
    address: '',
    nif,
    sector: 'Geral',
    entityType: 'SOCIEDADE',
    responsibleStaff: '',
    monthlyFee: 0,
    employeeCount: 0,
    turnover: 0,
    documentCount: 0,
    establishments: 1,
    banks: 1,
    callTimeBalance: 0,
    travelCount: 0,
    deliversOrganizedDocs: true,
    vatRefunds: false,
    hasIneReport: false,
    hasCostCenters: false,
    hasInternationalOps: false,
    hasManagementReports: false,
    supplierCount: 0,
    customerCount: 0,
    communicationCount: 0,
    meetingCount: 0,
    previousYearProfit: 0,
    saftCollectEnabled: true,
    tasks: [],
    status: 'Ativo',
    contractRenewalDate: new Date().toISOString().slice(0, 10),
    aiAnalysisCache: null,
  }), []);

  const handleApplyPdfSuggestions = React.useCallback(async (payload: ApplyPdfSuggestionsPayload): Promise<ApplyPdfSuggestionsResult> => {
    const result: ApplyPdfSuggestionsResult = {
      createdClientsStore: 0,
      createdClientsImport: 0,
      createdRelations: 0,
      createdRelationsImport: 0,
      addedToIrsGroup: 0,
      errors: [],
    };

    const subjectANif = normalizeNif(payload.subjectANif);
    const subjectBNif = normalizeNif(payload.subjectBNif);
    const dependentNifs = Array.from(new Set((payload.dependentNifs || []).map((nif) => normalizeNif(nif)).filter((nif) => nif.length === 9)));
    const namesByNif = payload.namesByNif || {};

    if (!subjectANif) {
      result.errors.push('NIF do Sujeito Passivo A não foi detetado.');
      return result;
    }

    const clientsByNifSnapshot = new Map(clients.map((client) => [normalizeNif(client.nif), client]).filter(([nif]) => Boolean(nif)));
    const subjectAClient = clientsByNifSnapshot.get(subjectANif);
    if (!subjectAClient) {
      result.errors.push(`Sujeito Passivo A (${subjectANif}) não existe na base de clientes.`);
      return result;
    }

    const clientIdsToEnsureInGroup = new Set<string>([subjectAClient.id]);
    const newClientsToInsert: Client[] = [];

    const ensureClientByNif = async (nif: string, fallbackName: string): Promise<Client | null> => {
      if (!nif || nif.length !== 9) return null;
      const preferredName = normalizeText(namesByNif[nif]) || fallbackName;
      let appClient = clientsByNifSnapshot.get(nif) || null;
      let importCreatedNow = false;
      let importCreatedId = '';
      try {
        const importResult = await ensureImportClientByNif(nif, appClient?.name || preferredName);
        importCreatedNow = Boolean(importResult.created);
        importCreatedId = normalizeText(importResult.createdId);
        if (importResult.created) result.createdClientsImport += 1;
      } catch (err: any) {
        const message = err?.message || 'erro desconhecido';
        result.errors.push(`Falha ao criar ficha (import/clientes) para NIF ${nif}: ${message}`);
        return appClient;
      }

      if (!appClient) {
        try {
          const clientToCreate = buildAutoCreatedClient(nif, preferredName);
          const savedClient = await clientService.upsert(clientToCreate);
          clientsByNifSnapshot.set(nif, savedClient);
          newClientsToInsert.push(savedClient);
          appClient = savedClient;
          result.createdClientsStore += 1;
        } catch (err: any) {
          const message = err?.message || 'erro desconhecido';
          result.errors.push(`Falha ao criar ficha (store) para NIF ${nif}: ${message}`);
          if (importCreatedNow && importClient) {
            try {
              if (importCreatedId) {
                await importClient.from('clientes').delete().eq('id', importCreatedId);
              } else {
                await importClient.from('clientes').delete().eq('nif', nif).eq('nome', preferredName);
              }
              result.createdClientsImport = Math.max(0, result.createdClientsImport - 1);
            } catch (rollbackErr: any) {
              result.errors.push(`Rollback falhou para NIF ${nif} no Supabase original: ${rollbackErr?.message || 'erro desconhecido'}`);
            }
          }
          return null;
        }
      }

      if (appClient) clientIdsToEnsureInGroup.add(appClient.id);
      return appClient;
    };

    const subjectBClient = subjectBNif
      ? await ensureClientByNif(subjectBNif, `Sujeito Passivo B ${subjectBNif}`)
      : null;

    for (let index = 0; index < dependentNifs.length; index += 1) {
      const depNif = dependentNifs[index];
      await ensureClientByNif(depNif, `Dependente ${depNif}`);
    }

    if (newClientsToInsert.length > 0) {
      setClients((prev) => {
        const existingIds = new Set(prev.map((client) => client.id));
        const toAppend = newClientsToInsert.filter((client) => !existingIds.has(client.id));
        return [...toAppend, ...prev];
      });
    }

    const relationCandidates: ManualIrsRelation[] = [];
    if (subjectBClient) {
      relationCandidates.push({
        sourceNif: subjectANif,
        targetNif: normalizeNif(subjectBClient.nif),
        relation: 'cônjuge',
        createdAt: new Date().toISOString(),
      });
    }
    dependentNifs.forEach((depNif) => {
      relationCandidates.push({
        sourceNif: subjectANif,
        targetNif: depNif,
        relation: 'filho',
        createdAt: new Date().toISOString(),
      });
    });

    const existingRelationKeys = new Set(
      manualRelations.map((relation) => (
        `${normalizeNif(relation.sourceNif)}|${normalizeNif(relation.targetNif)}|${normalizeSearchText(relation.relation)}`
      ))
    );
    const relationsToAdd = relationCandidates.filter((relation) => {
      const key = `${normalizeNif(relation.sourceNif)}|${normalizeNif(relation.targetNif)}|${normalizeSearchText(relation.relation)}`;
      if (existingRelationKeys.has(key)) return false;
      existingRelationKeys.add(key);
      return true;
    });

    if (relationsToAdd.length > 0) {
      try {
        const merged = [...manualRelations, ...relationsToAdd];
        await appConfigService.upsertValueByKey(IRS_MANUAL_RELATIONS_APP_CONFIG_KEY, merged);
        setManualRelations(merged);
        result.createdRelations = relationsToAdd.length;
      } catch (err: any) {
        result.errors.push(`Falha ao gravar relações IRS: ${err?.message || 'erro desconhecido'}`);
      }
    }

    if (importClient) {
      try {
        const relationTargets = Array.from(new Set([
          ...(subjectBNif ? [subjectBNif] : []),
          ...dependentNifs,
        ]));
        const [sourceRows, targetRows] = await Promise.all([
          getImportClientRowsByNif([subjectANif]),
          getImportClientRowsByNif(relationTargets),
        ]);
        const sourceRow = sourceRows[0];
        if (sourceRow?.id) {
          const currentRows = [
            ...parseMaybeJsonArray(sourceRow.agregado_familiar_json),
          ];
          const byNif = new Map(targetRows.map((row) => [normalizeNif(row.nif), row]));
          const existingKeys = new Set(
            currentRows.map((row) => (
              `${normalizeNif(row.customerNif ?? row.relatedClientNif ?? row.nif)}|${normalizeSearchText(row.relationType ?? row.relacao ?? row.relation)}`
            ))
          );

          const rowsToAdd = relationCandidates
            .filter((relation) => {
              const key = `${normalizeNif(relation.targetNif)}|${normalizeSearchText(relation.relation)}`;
              return !existingKeys.has(key);
            })
            .map((relation) => {
              const target = byNif.get(normalizeNif(relation.targetNif));
              return {
                relationType: relation.relation,
                relacao: relation.relation,
                customerNif: relation.targetNif,
                customerName: normalizeText(namesByNif[relation.targetNif]) || normalizeText(target?.nome) || `Cliente ${relation.targetNif}`,
                customerSourceId: normalizeText(target?.id),
                note: 'auto_irs',
              };
            });

          if (rowsToAdd.length > 0) {
            const { error: updateError } = await importClient
              .from('clientes')
              .update({ agregado_familiar_json: [...currentRows, ...rowsToAdd] })
              .eq('id', sourceRow.id);
            if (updateError) {
              result.errors.push(`Falha ao gravar relações no Supabase original: ${updateError.message || 'erro desconhecido'}`);
            } else {
              result.createdRelationsImport = rowsToAdd.length;
            }
          }
        }
      } catch (err: any) {
        result.errors.push(`Falha ao sincronizar relações no Supabase original: ${err?.message || 'erro desconhecido'}`);
      }
    }

    if (irsGroup) {
      const idsToAdd = Array.from(clientIdsToEnsureInGroup).filter((id) => !irsGroup.clientIds.includes(id));
      if (idsToAdd.length > 0) {
        try {
          const updatedGroup: FeeGroup = {
            ...irsGroup,
            clientIds: [...irsGroup.clientIds, ...idsToAdd],
          };
          const savedGroup = await groupService.upsert(updatedGroup);
          setGroups((prev) => prev.map((group) => group.id === savedGroup.id ? savedGroup : group));
          result.addedToIrsGroup = idsToAdd.length;
        } catch (err: any) {
          result.errors.push(`Falha ao adicionar clientes ao grupo IRS: ${err?.message || 'erro desconhecido'}`);
        }
      }
    }

    return result;
  }, [buildAutoCreatedClient, clients, irsGroup, manualRelations, setClients, setGroups]);

  useEffect(() => {
    let isCancelled = false;

    const loadFromImportSupabase = async () => {
      if (!importClient || irsGroupClients.length === 0) {
        if (!isCancelled) setImportFichaInfoMap(new Map());
        return;
      }

      const targetNifs = Array.from(
        new Set(
          irsGroupClients
            .map((client) => normalizeNif(client.nif))
            .filter((nif) => nif.length === 9)
        )
      );

      if (targetNifs.length === 0) {
        if (!isCancelled) setImportFichaInfoMap(new Map());
        return;
      }

      const primaryRows = await getImportClientRowsByNif(targetNifs);
      const importById = new Map<string, ImportClientRow>();
      const importByNif = new Map<string, ImportClientRow>();
      primaryRows.forEach((row) => {
        if (row.id) importById.set(row.id, row);
        const nif = normalizeNif(row.nif);
        if (nif) importByNif.set(nif, row);
      });

      const relatedIds = new Set<string>();
      const relatedNifs = new Set<string>();

      primaryRows.forEach((row) => {
        const relationRows = [
          ...parseMaybeJsonArray(row.agregado_familiar_json),
          ...parseMaybeJsonArray(row.fichas_relacionadas_json),
        ];
        relationRows.forEach((relationRow) => {
          const sourceId = normalizeText(
            relationRow.customerSourceId ?? relationRow.relatedClientId ?? relationRow.client_id ?? relationRow.fichaId
          );
          const relatedNif = normalizeNif(
            relationRow.customerNif ?? relationRow.relatedClientNif ?? relationRow.nif
          );
          if (sourceId) relatedIds.add(sourceId);
          if (relatedNif) relatedNifs.add(relatedNif);
        });
      });

      const missingIds = Array.from(relatedIds).filter((id) => !importById.has(id));
      const extraRowsById = await getImportClientRowsByIds(missingIds);
      extraRowsById.forEach((row) => {
        if (row.id) importById.set(row.id, row);
        const nif = normalizeNif(row.nif);
        if (nif) importByNif.set(nif, row);
      });

      const missingNifs = Array.from(relatedNifs).filter((nif) => !importByNif.has(nif));
      const extraRowsByNif = await getImportClientRowsByNif(missingNifs);
      extraRowsByNif.forEach((row) => {
        if (row.id) importById.set(row.id, row);
        const nif = normalizeNif(row.nif);
        if (nif) importByNif.set(nif, row);
      });

      const idsForCredentials = Array.from(importById.keys());
      const credentialRows = await getImportCredentialsByClientIds(idsForCredentials);
      const atCredByClientId = new Map<string, { atUsername: string; atPassword: string }>();
      credentialRows.forEach((credRow) => {
        const service = normalizeSearchText(credRow.tipo_servico);
        if (service && !service.includes('at') && !service.includes('financas') && !service.includes('autoridade tributaria')) return;
        if (!credRow.cliente_id || atCredByClientId.has(credRow.cliente_id)) return;
        atCredByClientId.set(credRow.cliente_id, {
          atUsername: normalizeText(credRow.username),
          atPassword: normalizeText(credRow.password_encrypted),
        });
      });

      const nextMap = new Map<string, IrsClientFichaInfo>();

      irsGroupClients.forEach((client) => {
        const localInfo = {
          householdSummary: extractHouseholdSummary(client, clientsById),
          ...extractFinancasCredentials(client),
        };

        const normalizedNif = normalizeNif(client.nif);
        const importMainRow = importByNif.get(normalizedNif);
        const importMainCred = importMainRow ? atCredByClientId.get(importMainRow.id) : undefined;

        const householdMembers: IrsHouseholdMemberInfo[] = [{
          key: `self-${client.id}`,
          relation: 'titular',
          name: importMainRow?.nome || client.name,
          nif: normalizedNif || normalizeNif(importMainRow?.nif),
          atUsername: importMainCred?.atUsername || localInfo.atUsername,
          atPassword: importMainCred?.atPassword || localInfo.atPassword,
          isPrimary: true,
        }];

        const relationRows = importMainRow
          ? [
              ...parseMaybeJsonArray(importMainRow.agregado_familiar_json),
              ...parseMaybeJsonArray(importMainRow.fichas_relacionadas_json),
            ]
          : [];
        const manualRelationRows = (manualRelationsBySourceNif.get(normalizedNif) || []).map((relation) => ({
          relation: relation.relation,
          customerNif: relation.targetNif,
          relatedClientNif: relation.targetNif,
        }));
        const allRelationRows = [...relationRows, ...manualRelationRows];

        allRelationRows.forEach((relationRow, index) => {
          const relation = normalizeText(
            relationRow.relationType ?? relationRow.relacao ?? relationRow.relationship ?? relationRow.relation ?? relationRow.type
          ) || 'relacao';
          const relatedId = normalizeText(
            relationRow.customerSourceId ?? relationRow.relatedClientId ?? relationRow.client_id ?? relationRow.fichaId
          );
          const relatedNif = normalizeNif(
            relationRow.customerNif ?? relationRow.relatedClientNif ?? relationRow.nif
          );
          const relatedNameDirect = normalizeText(
            relationRow.customerName ?? relationRow.relatedClientName ?? relationRow.name ?? relationRow.nome
          );

          const relatedImport = (relatedId && importById.get(relatedId))
            || (relatedNif && importByNif.get(relatedNif));
          const relatedAppClient = (relatedNif && clientsByNif.get(relatedNif))
            || (relatedId && clientsById.get(relatedId));
          const relatedLocalCred = relatedAppClient ? extractFinancasCredentials(relatedAppClient) : { atUsername: '', atPassword: '' };
          const relatedImportCred = relatedImport ? atCredByClientId.get(relatedImport.id) : undefined;

          const memberNif = normalizeNif(relatedImport?.nif || relatedNif || relatedAppClient?.nif);
          const memberName = normalizeText(relatedImport?.nome || relatedNameDirect || relatedAppClient?.name);
          if (!memberName && !memberNif) return;

          householdMembers.push({
            key: `rel-${client.id}-${index}-${relatedId || memberNif || memberName}`,
            relation,
            name: memberName || 'Sem nome',
            nif: memberNif,
            atUsername: relatedImportCred?.atUsername || relatedLocalCred.atUsername,
            atPassword: relatedImportCred?.atPassword || relatedLocalCred.atPassword,
          });
        });

        const dedupedMembers = householdMembers.reduce<IrsHouseholdMemberInfo[]>((acc, member) => {
          const dedupeKey = `${normalizeNif(member.nif)}|${normalizeSearchText(member.name)}|${member.relation}`;
          if (acc.some((item) => `${normalizeNif(item.nif)}|${normalizeSearchText(item.name)}|${item.relation}` === dedupeKey)) {
            return acc;
          }
          acc.push(member);
          return acc;
        }, []);

        nextMap.set(client.id, {
          householdSummary: buildHouseholdSummaryFromMembers(dedupedMembers) || localInfo.householdSummary,
          atUsername: dedupedMembers[0]?.atUsername || localInfo.atUsername,
          atPassword: dedupedMembers[0]?.atPassword || localInfo.atPassword,
          householdMembers: dedupedMembers,
        });
      });

      if (!isCancelled) {
        setImportFichaInfoMap(nextMap);
      }
    };

    loadFromImportSupabase();

    return () => {
      isCancelled = true;
    };
  }, [clientsById, clientsByNif, irsGroupClients, manualRelationsBySourceNif]);

  useEffect(() => {
    let isCancelled = false;

    const loadAttachmentCounts = async () => {
      const targetNifs = Array.from(
        new Set(
          irsGroupClients
            .map((client) => normalizeNif(client.nif))
            .filter((nif) => nif.length === 9)
        )
      );

      if (targetNifs.length === 0) {
        setSaftAttachmentCountByNif({});
        return;
      }

      try {
        const counts = await saftDossierService.getAttachmentCountsByClientNifs(targetNifs);
        if (!isCancelled) setSaftAttachmentCountByNif(counts);
      } catch (err) {
        console.error('Erro ao carregar contagem de anexos SAFT para IRS:', err);
        if (!isCancelled) setSaftAttachmentCountByNif({});
      }
    };

    loadAttachmentCounts();

    return () => {
      isCancelled = true;
    };
  }, [irsGroupClients]);

  const clientFichaInfoMap = useMemo(() => {
    const map = new Map<string, IrsClientFichaInfo>();

    irsGroupClients.forEach((client) => {
      const importedInfo = importFichaInfoMap.get(client.id);
      if (importedInfo) {
        map.set(client.id, importedInfo);
        return;
      }

      const localCredentials = extractFinancasCredentials(client);
      map.set(client.id, {
        householdSummary: extractHouseholdSummary(client, clientsById),
        ...localCredentials,
        householdMembers: [{
          key: `fallback-${client.id}`,
          relation: 'titular',
          name: client.name,
          nif: normalizeNif(client.nif),
          atUsername: localCredentials.atUsername,
          atPassword: localCredentials.atPassword,
          isPrimary: true,
        }],
      });
    });

    return map;
  }, [clientsById, importFichaInfoMap, irsGroupClients]);

  const {
    irsControlMap,
    pendingDeliveryTotal,
    pendingDeliveryCount,
    pendingMbWayTotal,
    deliveryHistoryForYear,
    handleCloseDelivery,
    handleIrsDeliveredToggle,
    handleIrsPaidToggle,
    handleIrsPaymentMethodChange,
    handleIrsAmountChange,
    handleIrsAttachmentCountChange,
    handleIrsNotesChange,
    handleIrsSettlementAmountChange,
    handleIrsSettlementDirectionChange,
  } = useIrsControl(currentYear);

  return (
    <div className="space-y-6 animate-fade-in">
      <IrsControlSection
        currentYear={currentYear}
        setCurrentYear={setCurrentYear}
        irsGroup={irsGroup}
        allClients={clients}
        availableClientsToAdd={availableClientsToAdd}
        isAddingClientToIrsGroup={isAddingClientToIrsGroup}
        onQuickAddClientToIrsGroup={handleQuickAddClientToIrsGroup}
        onApplyPdfSuggestions={handleApplyPdfSuggestions}
        irsGroupClients={irsGroupClients}
        attachmentCountByNif={saftAttachmentCountByNif}
        clientFichaInfoMap={clientFichaInfoMap}
        irsControlMap={irsControlMap}
        pendingDeliveryTotal={pendingDeliveryTotal}
        pendingDeliveryCount={pendingDeliveryCount}
        pendingMbWayTotal={pendingMbWayTotal}
        deliveryHistoryForYear={deliveryHistoryForYear}
        onCloseDelivery={handleCloseDelivery}
        onToggleDelivered={handleIrsDeliveredToggle}
        onTogglePaid={handleIrsPaidToggle}
        onPaymentMethodChange={handleIrsPaymentMethodChange}
        onAmountChange={handleIrsAmountChange}
        onAttachmentCountChange={handleIrsAttachmentCountChange}
        onNotesChange={handleIrsNotesChange}
        onSettlementAmountChange={handleIrsSettlementAmountChange}
        onSettlementDirectionChange={handleIrsSettlementDirectionChange}
      />
    </div>
  );
};

export default IrsControl;
