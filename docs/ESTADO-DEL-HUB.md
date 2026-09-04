# TRIMM Hub — qué es y qué tiene

Documento de referencia. Escrito para que otra sesión de trabajo (o una
persona nueva) entienda el módulo sin leerse el repositorio entero.

Fecha del inventario: septiembre de 2026.

## Qué es

El panel del grupo. Un dueño con varias sucursales de Trimm las lee todas
desde un sitio, sin entrar en cada instancia — y le manda campañas de
correo a la base de clientes de todas ellas.

Comparte proyecto de Supabase con Trimm (`rdbmobnnhrowlqcdettu`): misma
base de datos, mismas tablas de citas y clientes. No hay sincronización
entre productos porque no hay dos bases de datos.

## Cómo se conecta a Trimm

`hub_connections` vincula un dueño del Hub con un `business_id` de Trimm,
mediante un token de un solo uso (`hub_claim_tokens`). La conexión lleva
`marketing_allowed`: sin ese permiso el Hub lee métricas pero **no puede
escribir a los clientes de esa sucursal**. Es la separación entre «ver mis
números» y «usar comercialmente mi base de clientes».

## Lo que hace, por partes

### 1. Métricas y análisis (lectura)

Tres pantallas distintas sobre los datos de Trimm:

- **Métricas** — el resumen del grupo: facturación, citas, clientes.
- **KPIs** — indicadores con comparación contra el periodo anterior.
- **Análisis** — ocupación real, horas y días punta, antelación de reserva,
  recurrencia, mejores clientes, rendimiento por trabajador.

Detalles que costaron encontrarse y conviene no repetir:
- La duración de las citas se calcula de `end_time - start_time`;
  `duration_minutes` está a cero en todas las filas.
- Las horas se convierten a la zona horaria de cada negocio
  (`businesses.timezone`). Sin eso, un salón italiano tenía su hora punta
  a las 5 de la mañana.
- La facturación solo cuenta citas `COMPLETED`. Contarlas todas inflaba el
  número con las canceladas.

### 2. Campañas de email (escritura)

El motor completo, de la audiencia al retorno:

| Pieza | Qué hace |
|---|---|
| `hub_resolve_audience` | Quién recibe: correo válido, consentimiento, sin supresiones. Una fila por persona **y sucursal**. |
| `hub_materialize_campaign` | Congela esa lista en `hub_campaign_recipients`. |
| `hub-send-campaign` | Worker. Drena la cola por tramos con `FOR UPDATE SKIP LOCKED`; el cron lo reinvoca hasta vaciarla. |
| `hub-resend-webhook` | Entregas, aperturas, clics, rebotes y quejas. Firma Svix verificada. |
| `hub-unsubscribe` | Baja en un clic, incluida la cabecera `List-Unsubscribe-Post` que exige Gmail. |

**Plantillas.** Seis del sistema en cinco idiomas (30 filas), duplicables y
editables. Cuatro maquetas (`hero`, `offer`, `plain`, `card`), variables
`{{cliente}}`, `{{negocio}}`, `{{descuento}}`, `{{codigo}}`, y una marca de
grupo (logotipo, color, firma, pie). El renderizador escapa todo lo que
venga de la base de datos y solo admite `http`/`https` en los enlaces.

**Vista previa y prueba.** El asistente enseña el correo real antes de
pagar, y permite mandarse hasta 2 pruebas al día por tipo de campaña al
buzón de la sesión. El cupo vive en base de datos, no en memoria.

**Remitente separado.** Las campañas salen por `marketing.trimm.online`,
nunca por el dominio transaccional. Hay una comprobación que se niega a
enviar si alguien lo configura mal: una queja de spam comercial no puede
degradar la entrega de los recordatorios de cita.

### 3. Dinero

- **Packs de envíos** (`hub_credit_packs`), de 0,015 a 0,008 €/envío según
  volumen. Saldo por lotes con caducidad a 12 meses, consumo FIFO por
  fecha de caducidad, y devolución automática de lo reservado que no llegó
  a salir.
- **Pago por campaña suelta** — la lógica de Instagram: dices cuánto te
  gastas, se calcula el alcance a 0,02 €/envío (mínimo 5 €), se cobra eso y
  se acredita. Lo que sobra queda en el saldo.
- Cobros con la misma cuenta de Stripe que Trimm. Hay una barrera doble
  contra modo de pruebas: el prefijo de la clave y el `livemode` del objeto.
- Webhook de Stripe que acredita al cobrar y **retira saldo en devoluciones
  y disputas**.

### 4. Códigos de campaña — lo que aún depende de Trimm

Cada campaña genera un código (`DTO20-MU5BD`, `VUELVE-K7QMP`) que va dentro
del correo. Sirve para dos cosas: aplicar el descuento de verdad y atribuir
la reserva aunque nadie pinche el enlace.

**Trimm tiene que llamar a dos funciones** — el contrato completo está en
`docs/CODIGOS-EN-TRIMM.md` y el prompt listo para pegar en
`docs/PROMPT-TRIMM.md`:

- `hub_validate_code(codigo, negocio, cliente)` en el paso 5 de la reserva.
- `hub_redeem_code(codigo, negocio, cita, cliente, descuento_centimos)` al
  confirmar.

Y, aparte, `hub_attribute_appointment(cita, token)` para el `?tc=` que
llevan los enlaces del correo. **Hasta que Trimm haga esas llamadas, la
atribución es siempre cero y el descuento no lo aplica nadie.**

## Cómo está construido

- 20 migraciones SQL versionadas, 28 funciones de base de datos con
  `hub_` de prefijo.
- 11 Edge Functions en Deno.
- Frontend React 19 + Vite + Tailwind: 9 pantallas y 14 componentes.
- ~11.200 líneas entre frontend y funciones.
- **180 comprobaciones SQL** sobre un PostgreSQL efímero
  (`./migrations/tests/run.sh`) y **63 del renderizador de correo**
  (`node scripts/check-templates.mjs`). Las dos suites corren en segundos y
  no tocan producción.

## Decisiones que conviene no deshacer sin pensarlo

1. **El importe nunca llega del navegador.** Se recalcula en el servidor
   con la misma función que vio el usuario.
2. **La baja en una sucursal calla todas las del grupo** en esa campaña.
   Equivocarse hacia el silencio cuesta un envío; hacia el ruido, una queja
   de spam — y eso se paga con la reputación del dominio.
3. **Quien es cliente de dos sucursales recibe dos correos**, uno de cada.
   No sabemos cuál es su preferida y elegir por él acertaba la mitad.
4. **Sin certeza de sucursal no se pone botón**, se pone la instrucción
   «Reserva en X y añade tu código antes de pagar». Un botón que lleva al
   salón equivocado es peor que no tener botón.
5. **El correo habla el idioma de la plantilla**, no el de la interfaz.
   Quien escribe puede tener el Hub en español y el salón en Milán.

## Lo que falta

- **La integración de Trimm** (arriba). Sin ella el módulo de descuentos no
  cierra el círculo.
- **No hay registro en el Hub**: solo se entra, no se crea cuenta.
- **`hub_subscriptions` no tiene quien escriba**: el plan mensual con bolsa
  de envíos incluida está modelado pero nadie da de alta suscriptores.
- **Confirmar el seguimiento de aperturas y clics** en
  `marketing.trimm.online`, y que el reescritor de enlaces de Resend no se
  coma el `?tc=`. Si se lo come, hay que desactivar el clic.
