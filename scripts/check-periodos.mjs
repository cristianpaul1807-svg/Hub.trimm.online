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
const { rangoDe, DIAS: VENTANA } = await import(pathToFileURL(SALIDA).href);

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

console.log(fallos === 0
  ? `\n✓ periodos encajados en los ${DIAS.length} días comprobados`
  : `\n✗ ${fallos} problemas`);
process.exit(fallos === 0 ? 0 : 1);
