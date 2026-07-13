import {chromium} from 'playwright';
import {launchOptions} from './helpers/launch-options';

const APP_URL = process.env.E2E_APP_URL || 'http://127.0.0.1:8080';
const TELEGRAM_HOST = /(^|\.)(telegram\.org|t\.me|telegram\.me|web\.telegram\.org)$/i;

void (async() => {
const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const forbidden: string[] = [];
  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if(TELEGRAM_HOST.test(url.hostname) || /\.web\.telegram\.org$/i.test(url.hostname)) forbidden.push(url.href);
    } catch{}
  });

  await page.goto(APP_URL, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: 'Create New Identity'}).waitFor({state: 'visible', timeout: 30_000});
  await page.getByRole('button', {name: 'Create New Identity'}).click();
  await page.getByRole('button', {name: 'Continue'}).waitFor({state: 'visible', timeout: 15_000});
  await page.getByRole('button', {name: 'Continue'}).click();
  const name = page.getByRole('textbox').first();
  await name.waitFor({state: 'visible', timeout: 15_000});
  await name.fill('NetworkGuard');
  const finish = page.getByRole('button', {name: /Get Started|Skip/i}).first();
  await finish.click();
  await page.locator('.sidebar-header, .chatlist').first().waitFor({state: 'visible', timeout: 30_000});

  if(forbidden.length > 0) {
    throw new Error(`Telegram network request(s) detected:\n${forbidden.join('\n')}`);
  }
  console.log('PASS: onboarding and app boot made no Telegram-origin requests');
  await context.close();
} finally {
  await browser.close();
}
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
