import process from 'node:process';
import readline from 'node:readline/promises';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const args = new Set(process.argv.slice(2));
const forceHeaded = args.has('--headed');
const debugMode = args.has('--debug');

const pickEnv = (...names) => {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
};

const parseBoolean = (value, defaultValue) => {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const toNull = (value) => {
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
};
const normalizeNif = (value) => normalizeText(value).replace(/\D/g, '');

const sanitizeForPath = (value) => {
  const normalized = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'file';
};

const parsePtDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = match;
  const parsed = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    Number(ss)
  );

  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const parseContentDispositionFileName = (contentDisposition) => {
  if (!contentDisposition) return '';
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]).trim();
  const quotedMatch = contentDisposition.match(/filename=\"([^\"]+)\"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();
  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) return plainMatch[1].trim();
  return '';
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isSchemaUnavailableError = (message) =>
  /relation .* does not exist|column .* does not exist|schema cache|could not find the table/i.test(String(message || ''));

const config = {
  saftBaseUrl: pickEnv('SAFT_BASE_URL') || 'https://app.saftonline.pt',
  saftEmail: pickEnv('Email_saft', 'EMAIL_SAFT', 'SAFT_EMAIL'),
  saftPassword: pickEnv('Senha_saft', 'SENHA_SAFT', 'SAFT_PASSWORD', 'PASSWORD_SAFT'),
  supabaseUrl: pickEnv('SUPABASE_URL_CMR', 'VITE_SUPABASE_URL_CMR', 'SUPABASE_URL'),
  supabaseKey: pickEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_KEY_CMR',
    'VITE_SUPABASE_KEY_CMR',
    'SUPABASE_ANON_KEY'
  ),
  headless: forceHeaded ? false : parseBoolean(process.env.SAFT_HEADLESS, true),
  maxClients: Number.parseInt(pickEnv('SAFT_MAX_CLIENTS') || '0', 10) || 0,
  slowMoMs: debugMode ? 250 : 0,
  downloadAttachments: parseBoolean(process.env.SAFT_DOWNLOAD_ATTACHMENTS, true),
  attachmentsBucket: pickEnv('SAFT_ATTACHMENTS_BUCKET') || 'attachments',
};

const requiredEnv = [
  ['Email_saft / EMAIL_SAFT', config.saftEmail],
  ['Senha_saft / SENHA_SAFT', config.saftPassword],
  ['SUPABASE_URL_CMR (ou VITE_SUPABASE_URL_CMR)', config.supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY_CMR / VITE_SUPABASE_KEY_CMR)', config.supabaseKey],
];

const missing = requiredEnv.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error('Variaveis em falta no .env:');
  for (const name of missing) console.error(`- ${name}`);
  process.exit(1);
}

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const isLoggedIn = async (page) => {
  const currentUrl = page.url();
  if (currentUrl.includes('/dossier/')) return true;
  const hasLogout = await page.getByText('Sair', { exact: false }).count().catch(() => 0);
  const hasDossier = await page.getByText('Dossier', { exact: false }).count().catch(() => 0);
  return hasLogout > 0 || hasDossier > 0;
};

const fillFirst = async (page, selectors, value) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
};

const clickFirst = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return true;
    }
  }
  return false;
};

const waitForManualLogin = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await rl.question('Se existir captcha, faca login manualmente e prima Enter para continuar...');
  await rl.close();
};

const scrapeDossierList = async (page) => {
  await page.goto(`${config.saftBaseUrl}/dossier/dossier`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('table tbody tr', { timeout: 60_000 });
  await wait(1200);

  const rows = await page.$$eval('table tbody tr', trs => {
    const pick = (arr, idx) => (arr[idx] || '').replace(/\s+/g, ' ').trim();
    return trs.map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
      const detailLink = tr.querySelector('a[href*="/dossier/detalhes/"]');
      return {
        nif: pick(cells, 0),
        empresa: pick(cells, 1),
        validade_cp: pick(cells, 2),
        situacao_at: pick(cells, 3),
        data_recolha_at: pick(cells, 4),
        situacao_ss: pick(cells, 5),
        data_recolha_ss: pick(cells, 6),
        certidao_at: pick(cells, 7),
        data_recolha_certidao_at: pick(cells, 8),
        certidao_ss: pick(cells, 9),
        data_recolha_certidao_ss: pick(cells, 10),
        detail_url: detailLink ? detailLink.href : '',
      };
    });
  });

  return rows.filter(row => row.nif && row.nif.replace(/\D/g, '').length >= 9);
};

const scrapeDossierDetail = async (page, detailUrl) => {
  if (!detailUrl) return { sourceDetailUrl: null, fields: {}, attachmentForms: [] };

  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await wait(700);

    const detail = await page.evaluate(() => {
      const normalize = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
      const fields = {};
      const labels = Array.from(document.querySelectorAll('label'));

      for (const label of labels) {
        const key = normalize(label.textContent);
        if (!key) continue;

        let value = '';
        const parent = label.parentElement;
        const control = parent ? parent.querySelector('input, textarea, select') : null;
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
          value = normalize(control.value);
        } else if (control) {
          value = normalize(control.textContent);
        }

        if (!value) {
          const sibling = label.nextElementSibling;
          if (sibling instanceof HTMLInputElement || sibling instanceof HTMLTextAreaElement || sibling instanceof HTMLSelectElement) {
            value = normalize(sibling.value);
          } else if (sibling) {
            value = normalize(sibling.textContent);
          }
        }

        if (value) {
          fields[key] = value;
        }
      }

      const attachmentForms = Array.from(document.querySelectorAll('form[action]'))
        .map((form, index) => {
          const actionPath = normalize(form.getAttribute('action'));
          if (!actionPath) return null;
          if (!/(\/dossier\/download|\/m22\/download|\/ies\/download)/i.test(actionPath)) return null;

          const tokenInput = form.querySelector('input[name="__RequestVerificationToken"]');
          const token = normalize(tokenInput?.getAttribute('value'));
          if (!token) return null;

          const parent = form.parentElement;
          let label = '';
          if (parent) {
            const directLabel = parent.querySelector(':scope > label');
            if (directLabel) label = normalize(directLabel.textContent);
            if (!label) {
              const previous = form.previousElementSibling;
              if (previous && previous.tagName === 'LABEL') {
                label = normalize(previous.textContent);
              }
            }
          }

          if (!label) {
            label = `Anexo ${index + 1}`;
          }

          const hasEmailAction = Boolean(
            (parent && parent.querySelector('i.fa-envelope, .fa-envelope')) || form.querySelector('i.fa-envelope, .fa-envelope')
          );

          return {
            label,
            actionPath,
            token,
            hasEmailAction,
          };
        })
        .filter(Boolean);

      return {
        sourceDetailUrl: window.location.href,
        fields,
        attachmentForms,
      };
    });

    return detail;
  } catch (err) {
    console.warn(`Falha ao recolher detalhe ${detailUrl}:`, err?.message || err);
    return { sourceDetailUrl: detailUrl, fields: {}, attachmentForms: [] };
  }
};

const downloadAndStoreAttachments = async (context, clientNif, attachmentForms, syncedAtIso) => {
  if (!Array.isArray(attachmentForms) || attachmentForms.length === 0) return [];

  const saved = [];
  for (let i = 0; i < attachmentForms.length; i += 1) {
    const attachment = attachmentForms[i];
    const actionPath = normalizeText(attachment.actionPath);
    const token = normalizeText(attachment.token);
    if (!actionPath || !token) continue;

    try {
      const endpoint = new URL(actionPath, config.saftBaseUrl).toString();
      const response = await context.request.post(endpoint, {
        form: { __RequestVerificationToken: token },
      });

      if (!response.ok()) {
        console.warn(`Anexo falhou (${clientNif}): ${attachment.label} -> HTTP ${response.status()}`);
        continue;
      }

      const body = await response.body();
      if (!body || body.length === 0) continue;

      const contentType = response.headers()['content-type'] || 'application/octet-stream';
      const contentDisposition = response.headers()['content-disposition'] || '';
      const headerFileName = parseContentDispositionFileName(contentDisposition);
      const fallbackFile = `${sanitizeForPath(attachment.label)}.bin`;
      const fileName = sanitizeForPath(headerFileName || fallbackFile);
      const storagePath = `saft-dossier/${clientNif}/${sanitizeForPath(attachment.label)}-${i + 1}-${fileName}`;

      const upload = await supabase.storage
        .from(config.attachmentsBucket)
        .upload(storagePath, body, {
          contentType,
          upsert: true,
        });

      if (upload.error) {
        console.warn(`Falha upload Supabase (${clientNif}): ${attachment.label} -> ${upload.error.message}`);
        continue;
      }

      const { data: publicData } = supabase.storage.from(config.attachmentsBucket).getPublicUrl(storagePath);
      saved.push({
        label: attachment.label,
        actionPath,
        fileName,
        contentType,
        sizeBytes: body.length,
        storagePath,
        publicUrl: publicData.publicUrl,
        syncedAt: syncedAtIso,
      });
    } catch (err) {
      console.warn(`Erro ao descarregar anexo (${clientNif} / ${attachment.label}):`, err?.message || err);
    }
  }

  return saved;
};

const buildUpsertPayload = (listRow, detailData, syncedAtIso, attachments) => {
  const detailFields = detailData?.fields || {};
  const certidaoPermanenteCode =
    detailFields['Certidão Permanente'] ||
    detailFields['Certidao Permanente'] ||
    detailFields['Certidao permanente'] ||
    '';

  const certidaoPermanenteStatus =
    detailFields['Estado'] ||
    detailFields['Estado Certidão Permanente'] ||
    detailFields['Estado Certidao Permanente'] ||
    '';

  return {
    client_nif: normalizeNif(listRow.nif),
    client_name: toNull(listRow.empresa) || '',
    source_detail_url: toNull(detailData?.sourceDetailUrl || listRow.detail_url),
    at_status: toNull(listRow.situacao_at),
    at_collected_at: parsePtDateTime(listRow.data_recolha_at),
    ss_status: toNull(listRow.situacao_ss),
    ss_collected_at: parsePtDateTime(listRow.data_recolha_ss),
    certidao_at_status: toNull(listRow.certidao_at),
    certidao_ss_status: toNull(listRow.certidao_ss),
    certidao_permanente_status: toNull(certidaoPermanenteStatus),
    certidao_permanente_code: toNull(certidaoPermanenteCode),
    attachments: Array.isArray(attachments) ? attachments : [],
    raw_list: listRow,
    raw_detail: detailFields,
    synced_at: syncedAtIso,
  };
};

const upsertInBatches = async (rows) => {
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('saft_dossier_data')
      .upsert(chunk, { onConflict: 'client_nif' });
    if (error) throw error;
  }
};

const getCollectEnabledNifs = async () => {
  try {
    const { data, error } = await supabase.from('clients').select('nif, saft_collect_enabled');
    if (error) throw error;

    return new Set(
      (data || [])
        .filter(row => row.saft_collect_enabled !== false)
        .map(row => normalizeNif(row.nif))
        .filter(nif => nif.length === 9)
    );
  } catch (err) {
    if (isSchemaUnavailableError(err?.message)) {
      console.warn('Coluna saft_collect_enabled indisponivel. A usar todos os clientes do dossier.');
      return null;
    }
    throw err;
  }
};

const getPendingQueueNifs = async () => {
  try {
    const { data, error } = await supabase
      .from('saft_sync_queue')
      .select('client_nif')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });

    if (error) throw error;
    return Array.from(
      new Set(
        (data || [])
          .map(row => normalizeNif(row.client_nif))
          .filter(nif => nif.length === 9)
      )
    );
  } catch (err) {
    if (isSchemaUnavailableError(err?.message)) {
      console.warn('Tabela saft_sync_queue indisponivel. A continuar sem fila.');
      return [];
    }
    throw err;
  }
};

const markQueueRowsRunning = async (clientNifs) => {
  if (!Array.isArray(clientNifs) || clientNifs.length === 0) return;
  const now = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('saft_sync_queue')
      .update({
        status: 'running',
        started_at: now,
        finished_at: null,
        last_error: null,
      })
      .in('client_nif', clientNifs);
    if (error) throw error;
  } catch (err) {
    if (isSchemaUnavailableError(err?.message)) return;
    throw err;
  }
};

const markQueueRowDone = async (clientNif) => {
  const now = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('saft_sync_queue')
      .update({
        status: 'done',
        finished_at: now,
        last_error: null,
      })
      .eq('client_nif', clientNif);
    if (error) throw error;
  } catch (err) {
    if (isSchemaUnavailableError(err?.message)) return;
    throw err;
  }
};

const markQueueRowError = async (clientNif, errorMessage) => {
  const now = new Date().toISOString();
  const message = normalizeText(errorMessage || 'Erro desconhecido').slice(0, 1800);
  try {
    const { error } = await supabase
      .from('saft_sync_queue')
      .update({
        status: 'error',
        finished_at: now,
        last_error: message,
      })
      .eq('client_nif', clientNif);
    if (error) throw error;
  } catch (err) {
    if (isSchemaUnavailableError(err?.message)) return;
    throw err;
  }
};

const listClientStoragePaths = async (clientNif) => {
  const prefix = `saft-dossier/${clientNif}`;
  const allPaths = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(config.attachmentsBucket)
      .list(prefix, { limit: pageSize, offset });

    if (error) {
      // If list fails we still continue with DB-known paths.
      console.warn(`Falha a listar anexos antigos no bucket (${clientNif}): ${error.message}`);
      break;
    }

    if (!Array.isArray(data) || data.length === 0) break;

    for (const entry of data) {
      if (!entry?.name) continue;
      allPaths.push(`${prefix}/${entry.name}`);
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allPaths;
};

const clearOldAttachments = async (clientNif) => {
  const dbPaths = [];
  const listedPaths = await listClientStoragePaths(clientNif);

  const { data, error } = await supabase
    .from('saft_dossier_data')
    .select('attachments')
    .eq('client_nif', clientNif)
    .maybeSingle();

  if (error && !isSchemaUnavailableError(error.message)) throw error;

  const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
  for (const item of attachments) {
    const storagePath = normalizeText(item?.storagePath);
    if (storagePath) dbPaths.push(storagePath);
  }

  const allPaths = Array.from(new Set([...dbPaths, ...listedPaths]));
  if (allPaths.length === 0) return 0;

  let removedCount = 0;
  const chunkSize = 100;
  for (let i = 0; i < allPaths.length; i += chunkSize) {
    const chunk = allPaths.slice(i, i + chunkSize);
    const { error: removeError } = await supabase.storage.from(config.attachmentsBucket).remove(chunk);
    if (removeError) {
      console.warn(`Falha a apagar anexos antigos (${clientNif}): ${removeError.message}`);
      continue;
    }
    removedCount += chunk.length;
  }

  return removedCount;
};

const run = async () => {
  console.log('Iniciando sincronizacao SAFT Online...');
  console.log(`Base URL: ${config.saftBaseUrl}`);
  console.log(`Modo browser: ${config.headless ? 'headless' : 'headed'}`);
  console.log(`Download anexos: ${config.downloadAttachments ? 'sim' : 'nao'}`);

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMoMs,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    await page.goto(`${config.saftBaseUrl}/conta/inss`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const emailFilled = await fillFirst(
      page,
      [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="Email"]',
        'input#email',
        'input#Email',
      ],
      config.saftEmail
    );
    const passwordFilled = await fillFirst(
      page,
      [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="Senha"]',
        'input#password',
        'input#Senha',
      ],
      config.saftPassword
    );
    if (!emailFilled || !passwordFilled) {
      throw new Error('Nao foi possivel identificar os campos de login (email/senha).');
    }

    const clickedLogin = await clickFirst(page, [
      'button:has-text("Entrar")',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (!clickedLogin) {
      throw new Error('Nao foi possivel clicar no botao de login.');
    }

    await wait(2500);
    if (!(await isLoggedIn(page))) {
      if (config.headless) {
        throw new Error('Login automatico nao concluido (possivel captcha). Execute com --headed para validacao manual.');
      }
      await waitForManualLogin();
      if (!(await isLoggedIn(page))) {
        throw new Error('Login nao confirmado apos intervencao manual.');
      }
    }

    const rows = await scrapeDossierList(page);
    if (rows.length === 0) {
      throw new Error('Nenhuma linha encontrada no Dossier SAFT.');
    }

    const pendingQueueNifs = await getPendingQueueNifs();
    const queueMode = pendingQueueNifs.length > 0;
    const collectEnabledNifs = queueMode ? null : await getCollectEnabledNifs();

    let rowsToProcess = rows;
    if (queueMode) {
      const pendingSet = new Set(pendingQueueNifs);
      rowsToProcess = rows.filter(row => pendingSet.has(normalizeNif(row.nif)));
      const foundSet = new Set(rowsToProcess.map(row => normalizeNif(row.nif)));
      const missingNifs = pendingQueueNifs.filter(nif => !foundSet.has(nif));

      for (const missingNif of missingNifs) {
        await markQueueRowError(missingNif, 'NIF não encontrado na lista do dossier SAFT.');
      }

      if (missingNifs.length > 0) {
        console.warn(`NIFs pendentes não encontrados no dossier: ${missingNifs.join(', ')}`);
      }

      console.log(`Modo fila ativo: ${rowsToProcess.length}/${pendingQueueNifs.length} cliente(s) encontrados.`);
    } else if (collectEnabledNifs instanceof Set) {
      rowsToProcess = rows.filter(row => collectEnabledNifs.has(normalizeNif(row.nif)));
      console.log(`Filtro de recolha SAFT ativo: ${rowsToProcess.length} cliente(s) com visto.`);
    }

    if (config.maxClients > 0) {
      rowsToProcess = rowsToProcess.slice(0, config.maxClients);
    }

    if (rowsToProcess.length === 0) {
      console.log('Nenhum cliente para recolher nesta execução.');
      return;
    }

    if (queueMode) {
      const nifsToRun = rowsToProcess
        .map(row => normalizeNif(row.nif))
        .filter(nif => nif.length === 9);
      await markQueueRowsRunning(nifsToRun);
    }

    const syncedAtIso = new Date().toISOString();
    const upsertRows = [];
    const upsertClientNifs = [];

    for (let i = 0; i < rowsToProcess.length; i += 1) {
      const row = rowsToProcess[i];
      const clientNif = normalizeNif(row.nif);
      if (!clientNif) continue;

      try {
        const removed = await clearOldAttachments(clientNif);
        if (removed > 0) {
          console.log(`[${i + 1}/${rowsToProcess.length}] ${clientNif} - anexos antigos removidos: ${removed}`);
        }

        const detailData = await scrapeDossierDetail(page, row.detail_url);

        const attachments = config.downloadAttachments
          ? await downloadAndStoreAttachments(context, clientNif, detailData.attachmentForms || [], syncedAtIso)
          : [];

        const payload = buildUpsertPayload(row, detailData, syncedAtIso, attachments);
        if (!payload.client_nif) throw new Error('NIF inválido no payload de sincronização.');
        upsertRows.push(payload);
        upsertClientNifs.push(payload.client_nif);

        console.log(
          `[${i + 1}/${rowsToProcess.length}] ${payload.client_nif} - ${payload.client_name} (anexos: ${attachments.length})`
        );
      } catch (err) {
        const message = err?.message || String(err);
        console.warn(`[${i + 1}/${rowsToProcess.length}] ${clientNif} - falha: ${message}`);
        if (queueMode) {
          await markQueueRowError(clientNif, message);
        }
      }
    }

    if (upsertRows.length === 0) {
      throw new Error('Nenhum registo válido encontrado para upsert.');
    }

    try {
      await upsertInBatches(upsertRows);
    } catch (err) {
      if (queueMode) {
        const message = err?.message || String(err);
        for (const clientNif of Array.from(new Set(upsertClientNifs))) {
          await markQueueRowError(clientNif, `Falha ao guardar em saft_dossier_data: ${message}`);
        }
      }
      throw err;
    }

    if (queueMode) {
      for (const clientNif of Array.from(new Set(upsertClientNifs))) {
        await markQueueRowDone(clientNif);
      }
    }

    console.log(`Sincronização concluída. ${upsertRows.length} registos atualizados em saft_dossier_data.`);
  } finally {
    await context.close();
    await browser.close();
  }
};

run().catch(err => {
  console.error('Falha na sincronizacao SAFT:', err?.message || err);
  process.exit(1);
});
