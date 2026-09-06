/**
 * Comprobación de los periodos de las pantallas de métricas.
 *
 * Nació de un fallo real: el panel enseñaba más facturación en «semana» que
 * en «mes». No era un error de cálculo, era que «mes» significaba el mes
 * natural —desde el día 1— y «semana» los últimos siete días: el día 5 la
 * semana abarca más días que el mes.
 *
 * Lo que se comprueba es la propiedad que hacía falta y no existía: cada
 * periodo contiene al anterior, cualquiera que sea el día en que se mire. Si
 * eso se cumple, una cifra de un periodo largo nunca puede salir menor que
 * la del corto.
 *
 *   npm run check:periodos
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SALIDA = 'node_modules/.cache/periods.mjs';

// Los días peligrosos: el primero de mes —donde el fallo original se veía
// peor—, el cambio de año, el 29 de febrero y un día cualquiera.
const DIAS = [
  '2026-09-01T09:00:00',
  '2026-09-05T18:30:00',
  '2026-01-01T00:30:00',
  '2026-03-01T07:00:00',
  '2028-02-29T23:59:00',
  '2026-12-31T23:00:00',
];

// De más corto a más largo. Cada uno tiene que empezar antes que el anterior.
const ORDEN = ['today', 'week', 'month', 'quarter', 'year'];

const salida = await build({
  entryPoints: ['src/lib/periods.ts'],
  bundle: true, format: 'esm', write: false, platform: 'neutral',
});
mkdirSync('node_modules/.cache', { recursive: true });
writeFileSync(SALIDA, salida.outputFiles[0].text);
const { rangoDe, DIAS: VENTANA, serieDeFacturacion } = await import(pathToFileURL(SALIDA).href);

let fallos = 0;
const falla = (msg) => { fallos++; console.log(`✗ ${msg}`); };

for (const iso of DIAS) {
  const ahora = new Date(iso);
  const rangos = ORDEN.map((p) => [p, rangoDe(p, 0, ahora)]);

  for (const [p, r] of rangos) {
    if (r.to.getTime() !== ahora.getTime()) falla(`${iso} · ${p} no termina ahora`);
    if (r.from > r.to) falla(`${iso} · ${p} empieza después de terminar`);
  }

  // La propiedad que faltaba: contención estricta.
  for (let i = 1; i < rangos.length; i++) {
    const [corto, rc] = rangos[i - 1];
    const [largo, rl] = rangos[i];
    if (rl.from > rc.from) {
      falla(`${iso} · «${largo}» empieza después que «${corto}»: ` +
        `${rl.from.toISOString().slice(0, 10)} > ${rc.from.toISOString().slice(0, 10)}`);
    }
  }

  // El periodo anterior no puede solaparse con el actual, ni dejar hueco.
  for (const p of ORDEN) {
    const actual = rangoDe(p, 0, ahora);
    const previo = rangoDe(p, 1, ahora);
    if (previo.to.getTime() !== actual.from.getTime()) {
      falla(`${iso} · el ${p} anterior no termina donde empieza el actual`);
    }
    const dur = (r) => r.to - r.from;
    if (dur(previo) !== dur(actual)) falla(`${iso} · el ${p} anterior dura distinto`);
  }

  console.log(`✓ ${iso.slice(0, 16).replace('T', ' ')}  ` +
    ORDEN.map((p) => `${p}=${rangoDe(p, 0, ahora).from.toISOString().slice(0, 10)}`).join('  '));
}

// Y que las ventanas sean las que dicen las etiquetas.
const ESPERADO = { week: 7, month: 30, quarter: 90, year: 365 };
for (const [p, dias] of Object.entries(ESPERADO)) {
  if (VENTANA[p] !== dias) falla(`«${p}» debería abarcar ${dias} días y abarca ${VENTANA[p]}`);
}

// ── La serie de la gráfica ───────────────────────────────────────────
// El fallo que cubre: la clave de agrupación era el texto de la etiqueta, y
// «vie, 5» se repite todos los meses, así que meses distintos acababan
// sumados en la misma barra.
const citas = [
  { start_time: '2026-09-05T10:00:00', price: 10 },
  { start_time: '2026-08-05T10:00:00', price: 20 },  // mismo día del mes
  { start_time: '2026-07-05T10:00:00', price: 30 },  // y otro más
  { start_time: '2026-09-05T18:00:00', price: 5 },   // mismo día: sí suma
  { start_time: 'fecha rota',          price: 99 },  // se ignora
];

const porDia = serieDeFacturacion(citas, false, 'es');
if (porDia.length !== 3) falla(`por día deberían ser 3 barras y son ${porDia.length}`);
const total = porDia.reduce((a, p) => a + p.total, 0);
if (total !== 65) falla(`por día el total debería ser 65 y es ${total}`);
if (!porDia.some((p) => p.total === 15)) falla('las dos citas del mismo día deberían sumarse');
if (porDia.some((p) => p.total === 99)) falla('una fecha rota no debería contar');

const porMes = serieDeFacturacion(citas, true, 'es');
if (porMes.length !== 3) falla(`por mes deberían ser 3 barras y son ${porMes.length}`);
// El orden lo da la clave, no el orden en que lleguen las citas.
const revueltas = [...citas].reverse();
if (JSON.stringify(serieDeFacturacion(revueltas, true, 'es')) !== JSON.stringify(porMes)) {
  falla('la serie cambia según el orden en que lleguen las citas');
}
if (porMes[0].total !== 30 || porMes[2].total !== 15) {
  falla(`por mes debería ir julio→septiembre y va ${JSON.stringify(porMes)}`);
}

// Y las etiquetas siguen al idioma. Se compara una semana entera: hay días
// que se abrevian igual en los dos idiomas —el lunes es «lun» en ambos— y
// mirar uno solo puede dar un falso aprobado.
const semana = Array.from({ length: 7 }, (_, i) =>
  ({ start_time: `2026-09-0${i + 1}T10:00:00`, price: 1 }));
const enEs = serieDeFacturacion(semana, false, 'es').map((p) => p.date);
const enIt = serieDeFacturacion(semana, false, 'it').map((p) => p.date);
if (JSON.stringify(enEs) === JSON.stringify(enIt)) {
  falla(`las etiquetas no cambian de idioma: ${JSON.stringify(enEs)}`);
}
console.log(`✓ serie de la gráfica    es=${JSON.stringify(enEs.slice(0, 4))}  ` +
  `it=${JSON.stringify(enIt.slice(0, 4))}  meses=${JSON.stringify(porMes.map((p) => p.date))}`);

console.log(fallos === 0
  ? `\n✓ periodos encajados en los ${DIAS.length} días comprobados, y la serie agrupa y ordena bien`
  : `\n✗ ${fallos} problemas`);
process.exit(fallos === 0 ? 0 : 1);
