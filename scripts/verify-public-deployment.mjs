import { chromium } from 'playwright';

const baseUrl = process.env.CMR_E2E_URL || 'https://cmr.mpr.pt/';
const email = process.env.CMR_E2E_EMAIL;
const password = process.env.CMR_E2E_PASSWORD;

if (!email || !password) {
  throw new Error('CMR_E2E_EMAIL and CMR_E2E_PASSWORD are required');
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CMR_E2E_CHROMIUM || '/usr/bin/chromium-browser',
  args: ['--no-sandbox'],
});

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Clientes' }).waitFor({ timeout: 20_000 });

  const sessionKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token')));
  const workerScopes = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return [];
    return (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope);
  });

  const result = {
    url: page.url(),
    loginVisible: await page.getByText('AccounTech CMR').isVisible().catch(() => false),
    clientsNavigationVisible: await page.getByRole('button', { name: 'Clientes' }).isVisible(),
    authenticatedSessionStored: sessionKeys.length > 0,
    serviceWorkerScopes: workerScopes,
    pageErrors,
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.loginVisible || !result.clientsNavigationVisible || !result.authenticatedSessionStored || pageErrors.length) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
