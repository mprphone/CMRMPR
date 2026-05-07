import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = 'C:/Users/Rebelo/Documents/IRS 2025 ENTREGUE 2026.pdf';
const IRS_YEAR = 2025;
const IRS_CONTROL_KEY = 'cashier_irs_control_v1';
const IRS_MANUAL_RELATIONS_KEY = 'irs_manual_relations_v1';

const shouldApply = process.argv.includes('--apply');

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeNif = (value) => normalizeText(value).replace(/\D/g, '');
const isNifLine = (value) => /^\d{9}$/.test(normalizeNif(value));
const isAmountLine = (value) => /€/.test(value) || /^n\/a\b/i.test(normalizeText(value)) || /^recebe junto/i.test(normalizeText(value));

const parseAmount = (value) => {
  const text = normalizeText(value);
  if (!/€/.test(text)) return { amount: 0, direction: 'Nulo', raw: text, numeric: false };
  const numberText = text
    .replace(/[€\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const amount = Number(numberText);
  if (!Number.isFinite(amount) || amount === 0) return { amount: 0, direction: 'Nulo', raw: text, numeric: Number.isFinite(amount) };
  return {
    amount,
    direction: amount < 0 ? 'A pagar' : 'A receber',
    raw: text,
    numeric: true,
  };
};

const buildClient = (nif, name) => ({
  id: crypto.randomUUID(),
  name: normalizeText(name) || `Cliente ${nif}`,
  email: '',
  phone: '',
  address: '',
  nif,
  sector: 'Geral',
  entity_type: 'SOCIEDADE',
  status: 'Ativo',
  monthly_fee: 0,
  employee_count: 0,
  establishments: 1,
  banks: 1,
  turnover: 0,
  document_count: 0,
  call_time_balance: 0,
  travel_count: 0,
  delivers_organized_docs: true,
  vat_refunds: false,
  has_ine_report: false,
  has_cost_centers: false,
  has_international_ops: false,
  has_management_reports: false,
  supplier_count: 0,
  customer_count: 0,
  communication_count: 0,
  meeting_count: 0,
  previous_year_profit: 0,
  saft_collect_enabled: true,
  tasks: [],
  contract_renewal_date: new Date().toISOString().slice(0, 10),
  ai_analysis_cache: null,
});

const extractPdfLines = async () => {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const lines = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    textContent.items.forEach((item) => {
      const value = normalizeText(item?.str);
      if (value) lines.push(value);
    });
  }

  return lines;
};

const parsePdfRows = (lines) => {
  const entregueIndexes = lines
    .map((line, index) => (normalizeText(line).toLowerCase() === 'entregue' ? index : -1))
    .filter((index) => index >= 0);

  return entregueIndexes.reduce((rows, entregueIndex, rowIndex) => {
    const amountIndex = entregueIndex - 1;
    const nameIndex = amountIndex - 1;
    const nextEntregueIndex = entregueIndexes[rowIndex + 1] ?? lines.length;
    const nextAmountIndex = nextEntregueIndex - 1;
    const nextNameIndex = nextAmountIndex - 1;

    if (nameIndex < 0 || !isAmountLine(lines[amountIndex])) return rows;

    const tailEnd = nextNameIndex > entregueIndex ? nextNameIndex : nextEntregueIndex;
    const tail = lines.slice(entregueIndex + 1, tailEnd);
    const nifs = [];
    const notes = [];
    let notesStarted = false;

    tail.forEach((line) => {
      if (!notesStarted && isNifLine(line)) {
        nifs.push(normalizeNif(line));
        return;
      }
      notesStarted = true;
      notes.push(line);
    });

    const declarantNif = nifs[0] || '';
    if (!declarantNif) return rows;

    rows.push({
      name: normalizeText(lines[nameIndex]),
      amountInfo: parseAmount(lines[amountIndex]),
      status: 'Entregue',
      declarantNif,
      relatedNifs: nifs.slice(1),
      notes: notes.join(' '),
    });
    return rows;
  }, []);
};

const normalizeIrsRecords = (value) => (Array.isArray(value) ? value : []).filter((record) => record?.clientId && record?.year);
const normalizeCloses = (value) => (Array.isArray(value) ? value : []);

const main = async () => {
  const url = process.env.VITE_SUPABASE_URL_CMR;
  const key = process.env.VITE_SUPABASE_KEY_CMR;
  if (!url || !key) throw new Error('Faltam VITE_SUPABASE_URL_CMR / VITE_SUPABASE_KEY_CMR no .env.');

  const supabase = createClient(url, key);
  const rows = parsePdfRows(await extractPdfLines());
  const duplicateNifs = rows
    .map((row) => row.declarantNif)
    .filter((nif, index, all) => all.indexOf(nif) !== index);

  const [{ data: clientsData, error: clientsError }, { data: groupsData, error: groupsError }, { data: irsConfig, error: irsError }, { data: relationsConfig, error: relationsError }] = await Promise.all([
    supabase.from('clients').select('*'),
    supabase.from('fee_groups').select('*'),
    supabase.from('app_config').select('value').eq('key', IRS_CONTROL_KEY).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', IRS_MANUAL_RELATIONS_KEY).maybeSingle(),
  ]);

  if (clientsError) throw clientsError;
  if (groupsError) throw groupsError;
  if (irsError) throw irsError;
  if (relationsError) throw relationsError;

  const clientsByNif = new Map((clientsData || []).map((client) => [normalizeNif(client.nif), client]).filter(([nif]) => nif));
  const irsGroup = (groupsData || []).find((group) => normalizeText(group.name).toLowerCase().includes('irs'));
  if (!irsGroup) throw new Error('Grupo IRS não encontrado.');

  const now = new Date().toISOString();
  const clientsToCreate = [];
  const recordsByKey = new Map(normalizeIrsRecords(irsConfig?.value?.records).map((record) => [`${record.clientId}-${record.year}`, record]));
  const deliveryCloses = normalizeCloses(irsConfig?.value?.deliveryCloses ?? irsConfig?.value?.closes);
  const groupIds = new Set(Array.isArray(irsGroup.client_ids) ? irsGroup.client_ids : []);
  const relations = Array.isArray(relationsConfig?.value) ? relationsConfig.value : [];
  const relationKeys = new Set(relations.map((relation) => `${normalizeNif(relation.sourceNif)}|${normalizeNif(relation.targetNif)}|${normalizeText(relation.relation).toLowerCase()}`));

  let updatedRecords = 0;
  let addedToGroup = 0;
  let addedRelations = 0;
  const nonNumericAmounts = [];

  const ensureClient = (nif, name) => {
    const normalizedNif = normalizeNif(nif);
    let client = clientsByNif.get(normalizedNif);
    if (client) return client;

    client = buildClient(normalizedNif, name);
    clientsToCreate.push(client);
    clientsByNif.set(normalizedNif, client);
    return client;
  };

  rows.forEach((row) => {
    const client = ensureClient(row.declarantNif, row.name);
    if (!groupIds.has(client.id)) {
      groupIds.add(client.id);
      addedToGroup += 1;
    }

    const existing = recordsByKey.get(`${client.id}-${IRS_YEAR}`);
    const notesParts = [];
    if (!row.amountInfo.numeric && row.amountInfo.raw) notesParts.push(`Valor na folha: ${row.amountInfo.raw}`);
    if (row.notes) notesParts.push(row.notes);

    recordsByKey.set(`${client.id}-${IRS_YEAR}`, {
      clientId: client.id,
      year: IRS_YEAR,
      delivered: true,
      paid: Boolean(existing?.paid),
      amount: Number(existing?.amount || 0),
      attachmentCount: Number(existing?.attachmentCount || 0),
      paymentMethod: existing?.paymentMethod === 'MB Way' ? 'MB Way' : 'Numerário',
      notes: notesParts.join(' | '),
      irsSettlementAmount: row.amountInfo.amount,
      irsSettlementDirection: row.amountInfo.direction,
      deliveryCloseId: existing?.deliveryCloseId || null,
      updatedAt: now,
    });
    updatedRecords += 1;

    if (!row.amountInfo.numeric && row.amountInfo.raw) {
      nonNumericAmounts.push(`${row.name} (${row.declarantNif}): ${row.amountInfo.raw}`);
    }

    row.relatedNifs.forEach((targetNif, index) => {
      ensureClient(targetNif, `Cliente ${targetNif}`);
      const relation = index === 0 ? 'cônjuge' : 'filho';
      const key = `${row.declarantNif}|${targetNif}|${relation}`;
      if (relationKeys.has(key)) return;
      relationKeys.add(key);
      relations.push({
        sourceNif: row.declarantNif,
        targetNif,
        relation,
        createdAt: now,
      });
      addedRelations += 1;
    });
  });

  console.log(JSON.stringify({
    mode: shouldApply ? 'apply' : 'dry-run',
    pdfRows: rows.length,
    duplicateDeclarantNifs: Array.from(new Set(duplicateNifs)),
    clientsToCreate: clientsToCreate.length,
    recordsToUpsert: updatedRecords,
    addedToIrsGroup: addedToGroup,
    addedManualRelations: addedRelations,
    nonNumericAmounts,
  }, null, 2));

  if (!shouldApply) return;

  const backupDir = new URL('./irs-import-backups/', import.meta.url);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(
    new URL(`irs-2025-before-${Date.now()}.json`, backupDir),
    JSON.stringify({
      createdAt: now,
      sourcePdf: PDF_PATH,
      irsGroup,
      irsConfigValue: irsConfig?.value || null,
      manualRelationsValue: relationsConfig?.value || null,
      clientsToCreate,
    }, null, 2),
    'utf8'
  );

  if (clientsToCreate.length > 0) {
    const { error } = await supabase.from('clients').insert(clientsToCreate);
    if (error) throw error;
  }

  const { error: groupUpdateError } = await supabase
    .from('fee_groups')
    .update({ client_ids: Array.from(groupIds) })
    .eq('id', irsGroup.id);
  if (groupUpdateError) throw groupUpdateError;

  const { error: irsUpdateError } = await supabase
    .from('app_config')
    .upsert({
      key: IRS_CONTROL_KEY,
      value: {
        records: Array.from(recordsByKey.values()),
        deliveryCloses,
      },
    }, { onConflict: 'key' });
  if (irsUpdateError) throw irsUpdateError;

  const { error: relationsUpdateError } = await supabase
    .from('app_config')
    .upsert({
      key: IRS_MANUAL_RELATIONS_KEY,
      value: relations,
    }, { onConflict: 'key' });
  if (relationsUpdateError) throw relationsUpdateError;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
