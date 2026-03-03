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

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
};

const requiredEnv = [
  ['Email_saft / EMAIL_SAFT', config.saftEmail],
  ['Senha_saft / SENHA_SAFT', config.saftPassword],
  ['SUPABASE_URL_CMR (ou VITE_SUPABASE_URL_CMR)', config.supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY_CMR / VITE_SUPABASE_KEY_CMR)', config.supabaseKey],
];

const missing = requiredEnv.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error('Variáveis em falta no .env:');
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
  await rl.question('Se existir captcha, faça login manualmente e prima Enter para continuar...');
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
  if (!detailUrl) return { sourceDetailUrl: null, fields: {} };

  try {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await wait(600);

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

      return {
        sourceDetailUrl: window.location.href,
        fields,
      };
    });

    return detail;
  } catch (err) {
    console.warn(`Falha ao recolher detalhe ${detailUrl}:`, err?.message || err);
    return { sourceDetailUrl: detailUrl, fields: {} };
  }
};

const buildUpsertPayload = (listRow, detailData, syncedAtIso) => {
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

const run = async () => {
  console.log('Iniciando sincronização SAFT Online...');
  console.log(`Base URL: ${config.saftBaseUrl}`);
  console.log(`Modo browser: ${config.headless ? 'headless' : 'headed'}`);

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

    const emailFilled = await fillFirst(page, ['input[type="email"]', 'input[name="email"]', 'input#email'], config.saftEmail);
    const passwordFilled = await fillFirst(page, ['input[type="password"]', 'input[name="password"]', 'input#password'], config.saftPassword);
    if (!emailFilled || !passwordFilled) {
      throw new Error('Não foi possível identificar os campos de login (email/senha).');
    }

    const clickedLogin = await clickFirst(page, [
      'button:has-text("Entrar")',
      'button[type="submit"]',
      'input[type="submit"]',
    ]);
    if (!clickedLogin) {
      throw new Error('Não foi possível clicar no botão de login.');
    }

    await wait(2500);
    if (!(await isLoggedIn(page))) {
      if (config.headless) {
        throw new Error('Login automático não concluído (possível captcha). Execute com --headed para validação manual.');
      }
      await waitForManualLogin();
      if (!(await isLoggedIn(page))) {
        throw new Error('Login não confirmado após intervenção manual.');
      }
    }

    const rows = await scrapeDossierList(page);
    if (rows.length === 0) {
      throw new Error('Nenhuma linha encontrada no Dossier SAFT.');
    }

    const rowsToProcess = config.maxClients > 0 ? rows.slice(0, config.maxClients) : rows;
    const syncedAtIso = new Date().toISOString();
    const upsertRows = [];

    for (let i = 0; i < rowsToProcess.length; i += 1) {
      const row = rowsToProcess[i];
      const detailData = await scrapeDossierDetail(page, row.detail_url);
      const payload = buildUpsertPayload(row, detailData, syncedAtIso);

      if (!payload.client_nif) continue;
      upsertRows.push(payload);

      console.log(`[${i + 1}/${rowsToProcess.length}] ${payload.client_nif} - ${payload.client_name}`);
    }

    if (upsertRows.length === 0) {
      throw new Error('Nenhum registo válido encontrado para upsert.');
    }

    await upsertInBatches(upsertRows);
    console.log(`Sincronização concluída. ${upsertRows.length} registos atualizados em saft_dossier_data.`);
  } finally {
    await context.close();
    await browser.close();
  }
};

run().catch(err => {
  console.error('Falha na sincronização SAFT:', err?.message || err);
  process.exit(1);
});
