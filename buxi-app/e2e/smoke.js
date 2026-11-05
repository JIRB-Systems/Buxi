// Pruebas de punta a punta (humo) de los cuatro roles, con Brave o Chrome.
//
//   cd buxi-app
//   npm install --no-save playwright-core
//   set E2E_BASE=https://buxi.vercel.app
//   set E2E_CHOFER_EMAIL=...  E2E_CHOFER_PASS=...
//   set E2E_EMPRESA_EMAIL=... E2E_EMPRESA_PASS=...
//   set E2E_ADMIN_EMAIL=...   E2E_ADMIN_PASS=...
//   node e2e/smoke.js
//
// Las credenciales NUNCA van en el repo: solo por variables de entorno. Un rol
// sin credenciales se salta. El navegador sale de E2E_BROWSER, o de Brave /
// Chrome en sus rutas habituales de Windows.

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE || 'https://buxi.vercel.app';
const CANDIDATOS = [
  process.env.E2E_BROWSER,
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const EXE = CANDIDATOS.find((p) => fs.existsSync(p));
const UBICACION = { latitude: 10.6305651, longitude: -85.4442545 };

const resultados = [];
const ok = (rol, nombre, cond) => resultados.push({ rol, nombre, ok: !!cond });

async function nuevoContexto(browser) {
  const ctx = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: UBICACION,
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  return { ctx, page, errores };
}

async function login(page, email, pass) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.locator('ion-input[formcontrolname="email"] input').fill(email);
  await page.locator('ion-input[formcontrolname="password"] input').fill(pass);
  await page.locator('ion-button[type="submit"]').click();
}

async function pasajero(browser) {
  const { ctx, page, errores } = await nuevoContexto(browser);
  await page.goto(`${BASE}/passenger/map`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  ok('pasajero', 'el mapa carga sin cuenta', (await page.locator('canvas').count()) > 0);
  ok('pasajero', 'sin errores de página', errores.length === 0);
  await ctx.close();
}

async function chofer(browser) {
  const { ctx, page, errores } = await nuevoContexto(browser);
  await login(page, process.env.E2E_CHOFER_EMAIL, process.env.E2E_CHOFER_PASS);
  await page.waitForURL('**/chofer/**', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(6000);
  ok('chofer', 'login llega a su panel', page.url().includes('/chofer'));
  const r = await page.evaluate(() => {
    const b = document.querySelector('#chofer-map')?.getBoundingClientRect();
    return b ? [b.y, b.height, innerHeight] : null;
  });
  ok('chofer', 'mapa bien encuadrado', !!r && r[0] === 0 && r[1] === r[2]);

  const btn = page.locator('.track-btn:visible').first();
  await btn.click();
  await page.waitForTimeout(800);
  const checks = page.locator('.alert-checkbox-button');
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).click();
  await page.locator('.alert-button-group button:has-text("Iniciar ruta")').click();
  await page.waitForTimeout(4000);
  const chip = (await page.locator('.status-chip:visible').first().textContent().catch(() => '')) || '';
  ok('chofer', 'inicia el viaje', /Transmitiendo/i.test(chip));

  await page.locator('.track-btn:visible').first().click();
  await page.waitForTimeout(4000);
  const listo = page.locator('ion-alert button:has-text("Listo")');
  ok('chofer', 'termina el viaje y muestra resumen', (await listo.count()) > 0);
  if ((await listo.count()) > 0) await listo.click();
  await page.waitForTimeout(1500);
  const chip2 = (await page.locator('.status-chip:visible').first().textContent().catch(() => '')) || '';
  ok('chofer', 'vuelve a "Sin transmitir"', /Sin transmitir/i.test(chip2));
  ok('chofer', 'sin errores de página', errores.length === 0);
  await ctx.close();
}

async function panel(browser, rol, email, pass, rutaEsperada) {
  const { ctx, page, errores } = await nuevoContexto(browser);
  await login(page, email, pass);
  await page.waitForURL(`**/${rutaEsperada}/**`, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(7000);
  ok(rol, 'login llega a su panel', page.url().includes(`/${rutaEsperada}`));
  const r = await page.evaluate(() => {
    const inner = document.querySelector('ion-content')?.shadowRoot?.querySelector('.inner-scroll');
    const b = inner?.getBoundingClientRect();
    return b ? [b.y, b.height, innerHeight] : null;
  });
  ok(rol, 'contenido bien encuadrado (sin corrimiento)', !!r && r[0] === 0 && r[1] === r[2]);
  ok(rol, 'sin errores de página', errores.length === 0);
  await ctx.close();
}

(async () => {
  if (!EXE) {
    console.error('No encontré Brave ni Chrome. Definí E2E_BROWSER con la ruta del ejecutable.');
    process.exit(2);
  }
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const e = process.env;
  await pasajero(browser);
  if (e.E2E_CHOFER_EMAIL) await chofer(browser);
  else resultados.push({ rol: 'chofer', nombre: 'SALTADO (sin credenciales)', ok: true });
  if (e.E2E_EMPRESA_EMAIL) await panel(browser, 'empresa', e.E2E_EMPRESA_EMAIL, e.E2E_EMPRESA_PASS, 'empresa');
  else resultados.push({ rol: 'empresa', nombre: 'SALTADO (sin credenciales)', ok: true });
  if (e.E2E_ADMIN_EMAIL) await panel(browser, 'admin', e.E2E_ADMIN_EMAIL, e.E2E_ADMIN_PASS, 'admin');
  else resultados.push({ rol: 'admin', nombre: 'SALTADO (sin credenciales)', ok: true });
  await browser.close();

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALLA'} [${r.rol}] ${r.nombre}`);
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(fallas ? `\n${fallas} fallas` : '\nTodo en orden');
  process.exit(fallas ? 1 : 0);
})();
