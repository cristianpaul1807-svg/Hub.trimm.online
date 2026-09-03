// Pruebas del renderizador de plantillas.
//
// Es el único sitio del sistema donde texto escrito por una persona acaba
// dentro de HTML que sale hacia miles de buzones. Merece pruebas.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// El módulo es TypeScript pensado para Deno. Se compila con el propio tsc
// del proyecto en lugar de quitarle los tipos a mano con expresiones
// regulares: lo segundo se rompe en cuanto el fichero cambia, y una prueba
// que se cae sola no protege nada.
const dir = mkdtempSync(join(tmpdir(), 'tpl-'))
copyFileSync('supabase/functions/_shared/templates.ts', join(dir, 'templates.ts'))
execFileSync('npx', ['tsc', join(dir, 'templates.ts'),
  '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
  '--outDir', dir], { stdio: 'pipe' })

const T = await import(join(dir, 'templates.js'))

let fallos = 0
const ok = (nombre, cond) => {
  if (!cond) fallos++
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${nombre}`)
}

const ctx = {
  clientName: 'Ana',
  businessName: 'Salón Centro',
  discountValue: 20,
  bookingUrl: 'https://trimm.online/b/salon?tc=abc',
  unsubscribeUrl: 'https://hub.trimm.online/baja?t=abc',
}

// ── Escapado ────────────────────────────────────────────────────────
ok('escapa < > & " y comilla simple',
   T.escapeHtml(`<script>&"'`) === '&lt;script&gt;&amp;&quot;&#39;')
ok('el ampersand se escapa una sola vez',
   T.escapeHtml('a & b') === 'a &amp; b')

// ── Inyección desde el nombre del cliente ───────────────────────────
const malicioso = {
  ...ctx,
  clientName: '<img src=x onerror=alert(1)>',
  businessName: '</td></table><script>robar()</script>',
}
const r1 = T.renderEmail(
  { layout: 'hero', subject: 'Hola {{cliente}} de {{negocio}}', body: 'Hola {{cliente}}, en {{negocio}}.', cta_label: 'Reservar' },
  malicioso)
ok('el nombre del cliente no inyecta etiquetas', !r1.html.includes('<img src=x'))
ok('el nombre del negocio no rompe la tabla',   !r1.html.includes('<script>robar()'))
// El nombre se recorta a la primera palabra, así que en el HTML queda
// "&lt;img". Lo que importa no es la cadena exacta sino la invariante:
// ninguna etiqueta del texto de usuario sobrevive sin escapar.
ok('sí aparece escapado',                        r1.html.includes('&lt;img'))
ok('no sobrevive ninguna etiqueta inyectada',
   !/<img|<script|<\/td>\s*<\/table>\s*<script/i.test(
     r1.html.replace(/<[a-z!\/][^>]*>/gi, (tag) =>
       // Se quitan las etiquetas legítimas de la maqueta para que solo
       // quede lo que hubiera podido colar el texto del usuario.
       /^<(!doctype|html|head|meta|title|body|table|tr|td|a|p|h1|div|img|br|\/)/i.test(tag) ? '' : tag)))

// ── Variables ───────────────────────────────────────────────────────
const r2 = T.renderEmail(
  { layout: 'offer', subject: '{{descuento}}% en {{negocio}}', headline: '{{descuento}}%',
    body: 'Hola {{cliente}}, tienes {{descuento}}% en {{negocio}}.', cta_label: 'Reservar' }, ctx)
ok('el asunto sustituye variables', r2.subject === '20% en Salón Centro')
ok('el cuerpo sustituye el nombre', r2.html.includes('Hola Ana'))
ok('el titular sustituye el %',     r2.html.includes('20%'))

// Una variable inexistente se deja a la vista en lugar de vaciarse.
const r3 = T.renderEmail({ layout: 'plain', subject: 'x', body: 'Vale {{inventada}} aquí.' }, ctx)
ok('una variable desconocida se queda visible', r3.html.includes('{{inventada}}'))

// Sin nombre de cliente no debe salir "Hola ,"
const r4 = T.renderEmail({ layout: 'plain', subject: 'x', body: 'Hola {{cliente}}.' },
                         { ...ctx, clientName: null })
ok('sin nombre no deja un hueco raro', r4.html.includes('Hola hola') || !r4.html.includes('Hola .'))

// ── URLs ────────────────────────────────────────────────────────────
ok('acepta https',            T.safeUrl('https://trimm.online') !== '')
ok('rechaza javascript:',     T.safeUrl('javascript:alert(1)') === '')
ok('rechaza data:',           T.safeUrl('data:text/html,<script>') === '')
ok('rechaza una URL relativa',T.safeUrl('/b/salon') === '')

const r5 = T.renderEmail({ layout: 'hero', subject: 'x', body: 'y', cta_label: 'Ir' },
                         { ...ctx, bookingUrl: 'javascript:alert(1)' })
ok('un enlace no válido quita el botón en vez de escribirlo',
   !r5.html.includes('javascript:'))

// ── Colores ─────────────────────────────────────────────────────────
ok('acepta un color válido',   T.safeColor('#ff0000') === '#ff0000')
ok('rechaza color inventado',  T.safeColor('rojo') === '#1d4ed8')
ok('rechaza inyección por color',
   T.safeColor('#fff;background:url(javascript:alert(1))') === '#1d4ed8')

const r6 = T.renderEmail(
  { layout: 'hero', subject: 'x', body: 'y', accent_color: '";background:red;"' }, ctx)
ok('un color inválido no se escribe en el style', !r6.html.includes('background:red'))

// ── Maquetas ────────────────────────────────────────────────────────
for (const layout of ['hero', 'offer', 'plain', 'card']) {
  const r = T.renderEmail(
    { layout, subject: 'Asunto', headline: 'Titular', body: 'Uno.\n\nDos.', cta_label: 'Reservar' }, ctx)
  const bien = r.html.includes('<!doctype html>')
    && r.html.includes('Uno.') && r.html.includes('Dos.')
    && r.html.includes(ctx.unsubscribeUrl.replace(/&/g, '&amp;'))
  ok(`maqueta "${layout}" completa y con baja`, bien)
}

// ── Párrafos ────────────────────────────────────────────────────────
const r7 = T.renderEmail({ layout: 'plain', subject: 'x', body: 'Uno.\n\nDos.\nSigue.' }, ctx)
ok('los saltos dobles crean párrafos', (r7.html.match(/<p style="font-size:15px/g) || []).length === 2)
ok('el salto simple corta línea',      r7.html.includes('Dos.<br>Sigue.'))

// ── Marca ───────────────────────────────────────────────────────────
const marca = { logo_url: 'https://cdn.trimm.online/logo.png', accent_color: '#059669',
                signature: 'Equipo de {{negocio}}', footer_note: 'C/ Mayor 1' }
const r8 = T.renderEmail({ layout: 'plain', subject: 'x', body: 'y' }, ctx, marca)
ok('el logotipo sale',                r8.html.includes('cdn.trimm.online/logo.png'))
ok('la firma sustituye variables',    r8.html.includes('Equipo de Salón Centro'))
ok('la nota del pie sale',            r8.html.includes('C/ Mayor 1'))

const r9 = T.renderEmail({ layout: 'plain', subject: 'x', body: 'y' }, ctx,
                         { logo_url: 'javascript:alert(1)' })
ok('un logotipo no válido no se pinta', !r9.html.includes('javascript:'))

// El color de la plantilla manda sobre el de la marca.
const r10 = T.renderEmail({ layout: 'hero', subject: 'x', body: 'y', accent_color: '#111111' },
                          ctx, { accent_color: '#059669' })
ok('el color de la plantilla gana al de la marca', r10.html.includes('#111111'))

// ── Preencabezado ───────────────────────────────────────────────────
const r11 = T.renderEmail(
  { layout: 'plain', subject: 'x', preheader: 'Oferta en {{negocio}}', body: 'y' }, ctx)
ok('el preencabezado va oculto', r11.html.includes('display:none') && r11.html.includes('Oferta en Salón Centro'))

// ── Código de campaña ───────────────────────────────────────────────
const ctxCod = { ...ctx, promoCode: 'DTO20-MU5BD' };

const c1 = T.renderEmail({ layout: 'hero', subject: 'x', body: 'Hola' }, ctxCod)
ok('el código sale solo si hay código',      c1.html.includes('DTO20-MU5BD'))
ok('y con su etiqueta',                      c1.html.includes('Tu código'))

const c2 = T.renderEmail({ layout: 'hero', subject: 'x', body: 'Hola' }, ctx)
ok('sin código no se pinta la caja',         !c2.html.includes('Tu código'))

// Si la plantilla lo coloca ella misma, no se pone dos veces: el cliente
// no debe dudar de cuál de los dos códigos es el bueno.
const c3 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'Usa {{codigo}} al reservar.' }, ctxCod)
ok('{{codigo}} se sustituye en el cuerpo',   c3.html.includes('Usa DTO20-MU5BD al reservar'))
ok('y entonces no se añade la caja',         (c3.html.match(/DTO20-MU5BD/g) || []).length === 1)

const c4 = T.renderEmail({ layout: 'plain', subject: 'Tu código {{codigo}}', body: 'y' }, ctxCod)
ok('{{codigo}} también en el asunto',        c4.subject === 'Tu código DTO20-MU5BD')

// El código entra en el HTML, así que se escapa como todo lo demás.
const c5 = T.renderEmail({ layout: 'hero', subject: 'x', body: 'y' },
                         { ...ctx, promoCode: '<img src=x onerror=alert(1)>' })
ok('un código con HTML se escapa',           !c5.html.includes('<img src=x'))

// ── Destino del botón ───────────────────────────────────────────────
const b1 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar' }, ctx)
ok('sin cta_url el botón va a la reserva',   b1.html.includes('trimm.online/b/salon?tc=abc'))

const b2 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar',
    cta_url: 'https://prenotazioni.ejemplo.com/salon' }, ctx)
ok('con cta_url el botón va ahí',            b2.html.includes('prenotazioni.ejemplo.com/salon'))
ok('y ya no a la reserva',                   !b2.html.includes('?tc=abc'))

const b3 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar',
    cta_url: 'javascript:alert(1)' }, ctx)
ok('un cta_url no válido cae a la reserva',  b3.html.includes('trimm.online/b/salon'))
ok('y no ejecuta nada',                      !b3.html.includes('javascript:'))

// ── Sin enlace: instrucción en vez de botón ─────────────────────────
// Un botón solo apunta a un sitio. Cuando no se sabe a qué sucursal
// pertenece quien lee, mandarle a una al azar es peor que no mandarle.
const sinEnlace = { ...ctx, bookingUrl: '', promoCode: 'DTO20-MU5BD' };

const i1 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar' }, sinEnlace)
// El pie siempre lleva el enlace de baja, así que buscar '<a href' no
// dice nada. Lo que no debe haber es el botón, que se reconoce por su
// relleno.
ok('sin enlace no se pinta ningún botón', !i1.html.includes('padding:15px 34px'))
ok('sale la instrucción con el negocio',  i1.html.includes('Reserva en Salón Centro'))
ok('y recuerda añadir el código',         i1.html.includes('añade tu código de promoción antes de pagar'))

// Sin código la frase cambia: no se puede pedir que añada algo que no tiene.
const i2 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar' },
  { ...ctx, bookingUrl: '' })
ok('sin código no pide añadir código',    !i2.html.includes('añade tu código'))
ok('pero sigue diciendo dónde reservar',  i2.html.includes('Reserva en Salón Centro'))

// El nombre del negocio entra en el HTML, así que se escapa como todo.
const i3 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar' },
  { ...ctx, bookingUrl: '', businessName: '<img src=x onerror=alert(1)>' })
ok('el negocio se escapa en la instrucción', !i3.html.includes('<img src=x'))

// Y con cta_url propio el botón vuelve aunque no haya enlace de reserva.
const i4 = T.renderEmail(
  { layout: 'plain', subject: 'x', body: 'y', cta_label: 'Reservar',
    cta_url: 'https://prenotazioni.ejemplo.com' }, sinEnlace)
ok('un cta_url propio manda sobre la instrucción',
   i4.html.includes('prenotazioni.ejemplo.com') && !i4.html.includes('Reserva en Salón Centro'))

console.log(`\n${fallos === 0 ? 'Todas las comprobaciones del renderizador pasan.' : fallos + ' FALLOS'}`)
process.exit(fallos ? 1 : 0)
