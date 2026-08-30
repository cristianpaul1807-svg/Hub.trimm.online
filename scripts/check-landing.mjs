/**
 * Comprobación de maquetación de la landing.
 *
 * Nació de un fallo real: las cifras del mockup se salían de su recuadro en
 * móvil, porque la rejilla era de tres columnas fijas a cualquier ancho.
 * Verifica en varios tamaños que ninguna cifra desborda su tarjeta, que la
 * página no scrollea en horizontal y que no queda ningún enlace muerto.
 *
 *   pnpm build && pnpm check:landing
 *
 * Levanta el preview de Vite por su cuenta. Tailwind llega por CDN, así que
 * se descarga una vez y se sirve interceptado: sin él la página se mediría
 * sin estilos y el resultado no significaría nada.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const CACHE = 'node_modules/.cache/tailwind-cdn.js';
const TAILWIND_CDN = 'https://cdn.tailwindcss.com/3.4.16';

const VIEWPORTS = [
  { nombre: 'Android chico', w: 360, h: 800 },
  { nombre: 'iPhone SE',     w: 375, h: 780 },
  { nombre: 'iPhone 14',     w: 390, h: 844 },
  { nombre: 'Tablet',        w: 768, h: 1024 },
  { nombre: 'Escritorio',    w: 1440, h: 900 },
];

const CHROME = process.env.CHROME_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function tailwind() {
  if (existsSync(CACHE)) return readFileSync(CACHE, 'utf8');
  const res = await fetch(TAILWIND_CDN);
  if (!res.ok) throw new Error(`No se pudo descargar Tailwind: HTTP ${res.status}`);
  const body = await res.text();
  mkdirSync('node_modules/.cache', { recursive: true });
  writeFileSync(CACHE, body);
  return body;
}

async function esperarServidor(intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    try {
      if ((await fetch(BASE)).ok) return true;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const css = await tailwind();

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: 'ignore', detached: false });

let fallos = 0;
try {
  if (!await esperarServidor()) throw new Error('El preview de Vite no arrancó');

  const browser = await chromium.launch({ executablePath: CHROME });

  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, locale: 'es-ES' });
    await ctx.route(/cdn\.tailwindcss\.com/, (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: css }));
    await ctx.route(/googletagmanager|google-analytics|accounts\.google|www\.google\.com/, (r) => r.abort());

    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const r = await page.evaluate(() => {
      const desbordes = [];
      document.querySelectorAll('[data-kpi-value]').forEach((el) => {
        const card = el.parentElement;
        if (!card) return;
        const c = card.getBoundingClientRect(), e = el.getBoundingClientRect();
        const st = getComputedStyle(card);
        const cabe = e.left >= c.left + parseFloat(st.paddingLeft) - 1
                  && e.right <= c.right - parseFloat(st.paddingRight) + 1;
        if (!cabe || el.scrollWidth > el.clientWidth + 1) {
          desbordes.push({ texto: el.textContent.trim(), necesita: Math.round(el.scrollWidth), disponible: Math.round(el.clientWidth) });
        }
      });
      const muertos = [...document.querySelectorAll('a')]
        .filter((a) => { const h = a.getAttribute('href'); return !h || h === '#'; })
        .map((a) => (a.textContent || '(sin texto)').trim().slice(0, 30));
      return {
        desbordes, muertos,
        scrollH: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        estilado: getComputedStyle(document.querySelector('header')).position === 'sticky',
      };
    });

    if (!r.estilado) throw new Error(`Tailwind no aplicó en ${v.nombre}: la medición no sería válida`);

    const ok = r.desbordes.length === 0 && r.muertos.length === 0 && !r.scrollH;
    if (!ok) fallos++;
    console.log(
      `${ok ? '✓' : '✗'} ${v.nombre.padEnd(14)} ${String(v.w).padStart(4)}px` +
      (r.desbordes.length ? `  cifras que desbordan: ${JSON.stringify(r.desbordes)}` : '') +
      (r.muertos.length ? `  enlaces muertos: ${r.muertos.join(', ')}` : '') +
      (r.scrollH ? '  scroll horizontal' : ''),
    );
    await ctx.close();
  }

  await browser.close();
} finally {
  preview.kill('SIGTERM');
}

console.log(fallos === 0
  ? '\n✓ landing correcta en todos los tamaños'
  : `\n✗ ${fallos} tamaños con problemas`);
process.exit(fallos === 0 ? 0 : 1);
