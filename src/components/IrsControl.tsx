import React, { useMemo, useState } from 'react';
import { Client, FeeGroup } from '../types';
import IrsControlSection from './cashier/IrsControlSection';
import { useIrsControl } from './cashier/useIrsControl';

interface IrsControlProps {
  clients: Client[];
  groups: FeeGroup[];
}

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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

const IrsControl: React.FC<IrsControlProps> = ({ clients, groups }) => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear() - 1);
  const irsGroup = useMemo(() => groups.find(g => g.name.toLowerCase().includes('irs')), [groups]);
  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const irsGroupClients = useMemo(() => {
    if (!irsGroup) return [];
    return clients
      .filter(c => irsGroup.clientIds.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, irsGroup]);

  const clientFichaInfoMap = useMemo(() => {
    const map = new Map<string, { householdSummary: string; atUsername: string; atPassword: string }>();

    irsGroupClients.forEach((client) => {
      map.set(client.id, {
        householdSummary: extractHouseholdSummary(client, clientsById),
        ...extractFinancasCredentials(client),
      });
    });

    return map;
  }, [clientsById, irsGroupClients]);

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
    handleIrsNotesChange,
    handleIrsSettlementAmountChange,
  } = useIrsControl(currentYear);

  return (
    <div className="space-y-6 animate-fade-in">
      <IrsControlSection
        currentYear={currentYear}
        setCurrentYear={setCurrentYear}
        irsGroup={irsGroup}
        irsGroupClients={irsGroupClients}
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
        onNotesChange={handleIrsNotesChange}
        onSettlementAmountChange={handleIrsSettlementAmountChange}
      />
    </div>
  );
};

export default IrsControl;
