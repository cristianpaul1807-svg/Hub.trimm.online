/**
 * Comprobación del idioma que llega en el enlace.
 *
 * Trimm manda a la gente al Hub con `?lang=it`. Esta comprobación abre el
 * navegador de verdad y verifica que ese parámetro manda, que la cabecera del
 * documento cambia con él, que desaparece de la barra de direcciones sin
 * llevarse por delante los tokens que viajan en las mismas URLs, y que un
 * idioma que no existe no rompe nada.
 *
 *   npm run build && npm run check:lang
 *
 * Tailwind llega por CDN y aquí no hace falta para nada: se corta, igual que
 * analítica y fuentes, para que la comprobación no dependa de la red.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function esperarServidor(intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    try { if ((await fetch(BASE + '/')).ok) return true; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Lo que debe verse con cada idioma, en la cabecera del documento. */
const ESPERADO = {
  es: { titulo: 'Panel multi-negocio',   desc: 'Métricas en tiempo real', locale: 'es_ES' },
  en: { titulo: 'Multi-business',        desc: 'Real-time metrics',       locale: 'en_US' },
  fr: { titulo: 'Multi-entreprises',     desc: 'Métriques en temps réel', locale: 'fr_FR' },
  it: { titulo: 'Multi-attività',        desc: 'Metriche in tempo reale', locale: 'it_IT' },
  pt: { titulo: 'Multi-empresas',        desc: 'Métricas em tempo real',  locale: 'pt_PT' },
};

const casos = [
  ...Object.keys(ESPERADO).map((l) => ({
    nombre: `?lang=${l} manda sobre el navegador`,
    url: `/?lang=${l}`, locale: 'es-ES', guardado: null, espera: l, sinLang: true,
  })),
  { nombre: 'IT-IT completo se recorta a it',
    url: '/?lang=it-IT', locale: 'es-ES', guardado: null, espera: 'it', sinLang: true },
  { nombre: 'idioma del enlace gana a lo guardado',
    url: '/?lang=fr', locale: 'es-ES', guardado: 'pt', espera: 'fr', sinLang: true },
  { nombre: 'idioma inventado se ignora y queda lo guardado',
    url: '/?lang=zz', locale: 'es-ES', guardado: 'en', espera: 'en', sinLang: true,
    seGuarda: 'en' },
  { nombre: 'sin enlace manda lo guardado',
    url: '/', locale: 'fr-FR', guardado: 'pt', espera: 'pt', sinLang: true },
  // El idioma del navegador no se guarda: es una suposición, no una elección,
  // y tiene que poder cambiar si cambia el navegador.
  { nombre: 'sin nada, el idioma del navegador',
    url: '/', locale: 'fr-FR', guardado: null, espera: 'fr', sinLang: true,
    seGuarda: null },
  { nombre: 'el token de baja sobrevive a la limpieza',
    url: '/baja?t=abc123&lang=it', locale: 'es-ES', guardado: null, espera: 'it',
    sinLang: true, conservaBusqueda: 't=abc123' },
];

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: 'ignore' });

let fallos = 0;
try {
  if (!await esperarServidor()) throw new Error('El preview de Vite no arrancó');
  const browser = await chromium.launch({ executablePath: CHROME });

  for (const caso of casos) {
    const ctx = await browser.newContext({ locale: caso.locale });
    await ctx.route(/cdn\.tailwindcss\.com|googletagmanager|google-analytics|fonts\.(googleapis|gstatic)/,
      (r) => r.abort());

    const page = await ctx.newPage();
    if (caso.guardado) {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate((l) => localStorage.setItem('hub_lang', l), caso.guardado);
    }
    await page.goto(BASE + caso.url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.lang !== '');

    const r = await page.evaluate(() => ({
      html: document.documentElement.lang,
      titulo: document.title,
      desc: document.querySelector('meta[name="description"]')?.content ?? '',
      locale: document.querySelector('meta[property="og:locale"]')?.content ?? '',
      busqueda: location.search,
      guardado: localStorage.getItem('hub_lang'),
    }));

    const esp = ESPERADO[caso.espera];
    const problemas = [];
    if (r.html !== caso.espera) problemas.push(`<html lang> = "${r.html}"`);
    if (!r.titulo.includes(esp.titulo)) problemas.push(`título "${r.titulo}"`);
    if (!r.desc.includes(esp.desc)) problemas.push(`descripción "${r.desc.slice(0, 40)}…"`);
    if (r.locale !== esp.locale) problemas.push(`og:locale "${r.locale}"`);
    if (caso.sinLang && /(^|[?&])lang=/.test(r.busqueda)) problemas.push(`lang sigue en la URL: "${r.busqueda}"`);
    if (caso.conservaBusqueda && !r.busqueda.includes(caso.conservaBusqueda)) {
      problemas.push(`se perdió ${caso.conservaBusqueda}: "${r.busqueda}"`);
    }
    const seGuarda = 'seGuarda' in caso ? caso.seGuarda : caso.espera;
    if (r.guardado !== seGuarda) problemas.push(`guardado "${r.guardado}", se esperaba "${seGuarda}"`);

    if (problemas.length) fallos++;
    console.log(`${problemas.length ? '✗' : '✓'} ${caso.nombre.padEnd(46)}` +
      (problemas.length ? '  ' + problemas.join(' · ') : ''));
    await ctx.close();
  }

  await browser.close();
} finally {
  preview.kill('SIGTERM');
}

console.log(fallos === 0
  ? `\n✓ ${casos.length} comprobaciones de idioma correctas`
  : `\n✗ ${fallos} de ${casos.length} comprobaciones fallan`);
process.exit(fallos === 0 ? 0 : 1);
