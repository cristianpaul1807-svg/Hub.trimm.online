# Motor de campañas del Hub

Cómo funciona el envío de email marketing del Hub y qué hay que configurar
para ponerlo en marcha.

---

## Cómo funciona

Una campaña ya no se envía en la misma petición que la crea. El recorrido es:

```
1. Resolver audiencia   hub_resolve_audience()        ← fuente única de verdad
2. Congelar la cola     hub_materialize_campaign()    ← una fila por destinatario
3. Descontar saldo      hub_consume_credits()         ← exactamente los encolados
4. Enviar por tramos    hub-send-campaign (worker)    ← pg_cron lo despierta
5. Cerrar y devolver    hub_refresh_campaign_stats()  ← reembolsa lo no enviado
6. Recoger eventos      hub-resend-webhook            ← entregas, bajas, quejas
7. Atribuir reservas    hub_attribute_appointment()   ← campaña → cita → euros
```

La regla que lo gobierna todo: **solo se descuenta lo que efectivamente salió.**
Los envíos reservados que no llegan a enviarse vuelven al saldo automáticamente.

### La fuente única de verdad

`hub_resolve_audience()` es la única función autorizada para decidir quién
recibe una campaña. La usan tanto la estimación que ve el usuario en pantalla
como el encolado real. Antes había dos consultas distintas —una para contar y
otra para enviar— y devolvían conjuntos diferentes: se facturaba una lista y se
enviaba a otra.

Descarta, en este orden: emails ausentes o malformados, quien tenga
`preferencia_email = false`, y cualquier dirección en la lista de supresión.
Después deduplica por email.

### Deduplicación entre sucursales

Una persona con ficha en dos sucursales del mismo grupo recibe **un solo
correo**. La sucursal que lo firma se elige de forma determinista (por
`business_id`), no al azar: si variara entre ejecuciones, el mismo cliente
recibiría correos firmados por sucursales distintas.

Como consecuencia, **una baja suprime todas las sucursales de esa campaña**.
Si solo se suprimiera la firmante, esa persona reaparecería en el siguiente
envío bajo la otra sucursal — justo lo que ha pedido que no ocurra. Las bajas
no afectan a otros grupos empresariales.

Los rebotes duros y las quejas de spam sí generan supresión **global**: una
dirección muerta o que ha marcado spam envenena la reputación del dominio, que
es compartida por todos.

---

## Saldo y packs

El saldo se lleva por **lotes con caducidad** (`hub_credit_lots`), no como un
número suelto. Cada lote sabe de dónde viene y cuándo expira:

| Origen     | Caducidad        | ¿Se acumula? |
|------------|------------------|--------------|
| `plan`     | fin de mes       | No           |
| `purchase` | 12 meses         | Sí           |
| `refund`   | hereda la mayor  | Sí           |

El consumo es FIFO **por caducidad más próxima**, así que primero se gasta la
bolsa del plan y solo después el saldo comprado. Nadie pierde envíos por el
orden en que los gastó.

Cada recarga renueva la caducidad de todo el saldo comprado: quien sigue
comprando nunca pierde nada.

---

## Puesta en marcha

### 1. Dominio de envío separado — **hazlo primero**

Marketing y correo transaccional **no pueden compartir dominio**. Unas quejas
de spam en una campaña degradan la entrega de los recordatorios de citas, que
son el producto principal.

| | Transaccional | Marketing |
|---|---|---|
| Dominio | `trimm.online` | `marketing.trimm.online` |
| Clave | `RESEND_API_KEY` | `RESEND_MARKETING_API_KEY` |
| Baja | No lleva | Obligatoria |
| Seguimiento | Desactivado | Aperturas y clics |

El worker se niega a enviar si el remitente de campañas cae en
`TRANSACTIONAL_DOMAIN`, y lo comprueba **antes** de reservar nada de la cola:
una configuración equivocada deja la campaña intacta y sin gastar saldo, en
lugar de quemar la reputación de los recordatorios.

#### Estado actual de la cuenta

| Dominio | Estado | Región | Uso |
|---|---|---|---|
| `trimm.online` | verificado | `eu-west-1` | Recordatorios, confirmaciones, códigos |
| `marketing.trimm.online` | verificado | `eu-west-1` | Campañas del Hub |

`trimm.online` está enviando tráfico real de producción. **No lo uses para
campañas**: su reputación es la que hace que lleguen los recordatorios de citas.

`marketing.trimm.online` está verificado con su propio DKIM y su propio
registro SPF, así que su reputación se construye aparte de la del dominio raíz.

Queda una comprobación en el panel de Resend: que el **seguimiento de aperturas
y clics** esté activado en ese dominio. Sin él no habrá tasa de apertura ni de
clic. Y si se activa el seguimiento de clics, hay que confirmar que el
parámetro `?tc=` sobrevive a la reescritura de enlaces — si no sobrevive,
desactiva el seguimiento de clics: la atribución de reservas vale más que el
dato de clic.

#### Clave de API aparte

La cuenta tiene una sola clave, compartida con el correo transaccional. Crea
una segunda desde el panel de Resend y guárdala en
`RESEND_MARKETING_API_KEY`: así puedes revocar la de marketing sin dejar sin
recordatorios a los negocios.

### 2. Calentar el dominio

Un dominio nuevo que empieza enviando miles de correos va directo a spam.
Empieza en unos 200 envíos al día y dobla cada dos días durante dos semanas.

### 3. Variables de entorno

**Edge Functions** (Supabase → Settings → Edge Functions → Secrets):

| Variable | Para qué |
|---|---|
| `RESEND_MARKETING_API_KEY` | Clave de Resend solo para campañas |
| `RESEND_WEBHOOK_SECRET` | Firma del webhook (`whsec_…`) |
| `MARKETING_FROM_EMAIL` | Remitente, p. ej. `campanas@marketing.trimm.online` |
| `TRANSACTIONAL_DOMAIN` | Dominio que **no** puede usarse para campañas (`trimm.online`) |
| `APP_URL` | Base de los enlaces de reserva (`https://trimm.online`) |
| `HUB_URL` | Base del enlace de baja (`https://hub.trimm.online`) |
| `STRIPE_SECRET_KEY` | Cobro de los packs |

**Frontend** (variables de build):

| Variable | Para qué |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Conexión a la base |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Formularios de tarjeta |

### 4. Migraciones

Aplicadas en producción el 31/08/2026:

```
migrations/20260820_hub_campaign_engine.sql   ✔ aplicada
migrations/20260820_hub_credits_packs.sql     ✔ aplicada
migrations/20260831_hub_drain_cron.sql        ✔ aplicada
```

Para verificar cambios antes de tocar producción:

```bash
pnpm test:migrations   # PostgreSQL desechable, no toca nada real
```

> Las dos migraciones de junio siguen sin figurar en el historial de
> migraciones de Supabase — se aplicaron a mano antes de esto. Conviene
> registrarlas para no perder la trazabilidad que sí tiene el resto de Trimm.

### 5. Desplegar las funciones

Las siete están desplegadas y probadas en producción:

```bash
supabase functions deploy hub-campaign-enqueue
supabase functions deploy hub-send-campaign
supabase functions deploy hub-buy-credits
supabase functions deploy hub-save-payment-method
supabase functions deploy hub-create-setup-intent

# Estas dos las llaman Resend y los clientes de correo, que no tienen sesión
supabase functions deploy hub-resend-webhook --no-verify-jwt
supabase functions deploy hub-unsubscribe    --no-verify-jwt
```

`hub-send-campaign` reconoce al llamante de servicio por el rol del JWT, no
por comparar la clave carácter a carácter. La comparación literal fallaba: el
cron lleva la clave `service_role` heredada del proyecto y a la función se le
inyecta la que Supabase tenga vigente, que no siempre es la misma cadena. Como
la función se despliega **con** `verify_jwt`, la pasarela ya ha validado la
firma antes de que el código lea el rol; un token con el rol falsificado no
llega siquiera a ejecutarse.

### 6. Webhook de Resend

Creado y apuntando a
`https://rdbmobnnhrowlqcdettu.supabase.co/functions/v1/hub-resend-webhook`,
suscrito a `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`
y `email.complained`.

**Falta un paso manual**: guardar el secreto de firma (`whsec_…`) en
`RESEND_WEBHOOK_SECRET`, en los secretos de Edge Functions de Supabase.
Mientras esa variable no exista, la función acepta cualquier POST sin
verificar la firma — cualquiera que conozca la URL podría inventarse
aperturas, rebotes o quejas.

Sin webhook no hay aperturas, ni rebotes, ni supresión automática: se envía a
ciegas y la lista se degrada campaña tras campaña.

### 7. Programar el worker

Ya programado: `hub-drain-campaign-queue`, cada minuto. Lo instala
`migrations/20260831_hub_drain_cron.sql`.

Dos decisiones dentro de esa migración:

- **La clave no está escrita en el fichero.** Se lee de un cron que ya existe
  en el proyecto, así el repositorio no guarda ningún secreto.
- **La llamada sólo sale si hay cola.** El `WHERE EXISTS` evita 1.440
  invocaciones diarias para no hacer nada.

Comprobar que está vivo:

```sql
SELECT status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'hub-drain-campaign-queue')
ORDER BY start_time DESC LIMIT 5;
```

Con la cola vacía el resultado correcto es `succeeded / 0 rows`: el guardado
se cumplió y no se llamó a nadie.

La bolsa mensual del plan la programa la propia migración de créditos
(`hub-grant-monthly-credits`, día 1 a las 03:00 UTC).

### 8. Atribución desde Trimm

Los enlaces de reserva de los correos llevan `?tc=<token>`. Para que las
reservas se atribuyan a su campaña, el flujo de reserva de Trimm tiene que
pasar ese token tras crear la cita — una sola llamada:

```sql
SELECT hub_attribute_appointment('<appointment_id>', '<token>');
```

Si el token no existe, la función devuelve `false` sin hacer nada: una reserva
nunca debe fallar por un problema de atribución.

**Este paso es el que convierte el producto.** Sin él el panel dice «2.500
correos enviados»; con él dice «47 reservas y 1.240 € facturados». Es lo único
que ningún competidor de email marketing puede ofrecer, porque el calendario
también es de Trimm.

---

## Límites de envío

| Límite | Valor | Por qué |
|---|---|---|
| Emails por llamada a Resend | 100 | Máximo del endpoint por lotes |
| Pausa entre lotes | 600 ms | El límite por defecto es 2 peticiones/segundo |
| Emails por invocación | 500 | Cabe holgado en el tiempo de una Edge Function |
| Reintentos por destinatario | 3 | Después se marca como fallido |

Los dos primeros conviene confirmarlos contra la documentación vigente de
Resend y el plan contratado. Están centralizados al principio de
`supabase/functions/hub-send-campaign/index.ts`.

---

## Verificación

```bash
pnpm typecheck         # TypeScript del frontend
pnpm test:migrations   # Migraciones y motor contra PostgreSQL efímero
pnpm build             # Build de producción
```

`test:migrations` levanta un PostgreSQL desechable, reproduce el esquema de
Trimm con las columnas reales de producción, aplica las cuatro migraciones y
ejecuta 23 comprobaciones del motor: deduplicación, consentimiento, supresión,
idempotencia de la cola, consumo y devolución de saldo, orden FIFO de
caducidad, control de acceso entre negocios y atribución de reservas.

Nunca toca la base de datos real.
