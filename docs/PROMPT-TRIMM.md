# Prompt para la sesión de Trimm

> Pégalo tal cual en Claude Code abierto sobre el repositorio de Trimm.

---

Trabajas en Trimm. Comparte base de datos Supabase con TRIMM Hub (proyecto
`rdbmobnnhrowlqcdettu`), así que las tablas y funciones del Hub ya están
disponibles desde aquí: no hay API externa que llamar ni servicio que
desplegar.

## Contexto

El Hub manda campañas de email marketing a la base de clientes de cada
negocio. Hasta ahora esos correos decían «15% de descuento para ti» y
**nada en Trimm aplicaba ese descuento**: el cliente llegaba con una
captura, el salón no tenía constancia de nada, y el descuento se concedía
a ojo o no se concedía.

El Hub ya genera un código por campaña (`DTO20-MU5BD`, `VUELVE-K7QMP`,
`PUNTOS-AGU49`) que va dentro del correo. Tu trabajo es que Trimm lo
acepte, lo aplique al precio y lo canjee.

## Lo que hay que construir

### 1. Campo de código en el paso 5 del flujo de reserva

Un campo opcional «¿Tienes un código de promoción?». Al escribir en él,
con un poco de espera para no consultar en cada tecla:

```ts
const { data } = await supabase.rpc('hub_validate_code', {
  p_code:        codigoTecleado,   // como venga; se normaliza dentro
  p_business_id: negocioId,
  p_client_id:   clienteId ?? null,
});
```

Válido:
```json
{ "valid": true, "code": "DTO20-MU5BD", "kind": "percent",
  "value": 20.00, "valid_until": "2026-11-02T…" }
```

- `kind: "percent"` → descuenta `value` por ciento.
- `kind: "fixed"` → descuenta `value` **céntimos**.
- `kind: "none"` → no toca el precio. Es de una campaña de fidelización o
  de recuperación y sirve solo para atribuir la reserva. **Acéptalo como
  válido** y no enseñes ningún descuento.

No válido: `{ "valid": false, "reason": "…" }`

| `reason` | Mensaje al cliente |
|---|---|
| `not_found` | Este código no es válido aquí |
| `expired` | Este código ha caducado |
| `exhausted` | Este código ya se ha agotado |
| `already_used` | Ya usaste este código |
| `not_yet` | Este código aún no está activo |
| `empty` | (nada: el campo está vacío) |

`not_found` es deliberadamente ambiguo — un código inexistente y uno de
otra sucursal dan la misma respuesta, para que no se puedan enumerar
códigos ajenos. No intentes distinguirlos.

Validar **no gasta** el código: llámala tantas veces como haga falta.

### 2. Aplicar el descuento al precio

Sobre un servicio de 50 € con `percent` 20:

```
base          5000 céntimos
descuento     1000
a cobrar      4000
```

Redondea una sola vez y en un único sitio. Enseña el desglose al cliente
antes de confirmar: base, descuento aplicado y total.

**Vuelve a validar en el servidor antes de cobrar.** Lo que llegue del
navegador es lo que se le enseñó al cliente, no lo que se le cobra.

### 3. Canjear al confirmar la reserva

Solo cuando la cita ya existe y está confirmada. Y **si hay pago en línea,
cobra primero y canjea después**: al revés, un pago fallido gasta un canje
por una reserva que no existe.

```ts
const { data } = await supabase.rpc('hub_redeem_code', {
  p_code:           codigo,
  p_business_id:    negocioId,
  p_appointment_id: citaId,                 // obligatorio
  p_client_id:      clienteId ?? null,
  p_discount_cents: descontadoEnCentimos,   // lo que de verdad se rebajó
});
```

`p_discount_cents` importa: sin él, el retorno de la campaña se calcula
sobre facturación bruta y sale inflado. Un 20% sobre 1.000 € de citas no
son 1.000 € de beneficio.

Es **idempotente por cita**: si la llamada se pierde y reintentas, devuelve
`{ success: true, duplicate: true }`. Trátalo como éxito.

Canjear **también atribuye la cita a la campaña**
(`appointments.hub_campaign_id`), así que no llames además a
`hub_attribute_appointment` en esta ruta.

### 4. Atribución por enlace (independiente del código)

Aparte de esto, los correos del Hub llevan enlaces de reserva con
`?tc=<token>`. Si ese parámetro está presente en la URL, guárdalo durante
el flujo y, al confirmar la reserva **sin código**, llama a:

```ts
await supabase.rpc('hub_attribute_appointment', {
  p_appointment_id: citaId,
  p_token: tokenDeLaUrl,
});
```

Falla en silencio si el token no existe, a propósito. Sin esta llamada, la
atribución por enlace es siempre cero — está escrita y esperando desde
hace tiempo.

## Reglas que no se pueden saltar

1. **Una reserva nunca debe perderse por un problema de descuento.** Si
   `hub_redeem_code` falla, guarda la cita igualmente y avisa de que el
   código no se pudo aplicar. Nunca abortes la reserva por esto.

2. **No escribas directamente en `hub_campaign_codes` ni en
   `hub_code_redemptions`.** Los permisos están revocados para `anon` y
   `authenticated`; todo pasa por las dos funciones.

3. **No confíes en el `value` que venga del navegador.** Revalida en
   servidor antes de cobrar.

4. **No inventes mensajes de error nuevos.** Usa la tabla de `reason` de
   arriba; son los estados que el Hub distingue de verdad.

## Cómo verificarlo

Las funciones ya están en producción. Para probar de punta a punta, crea
un código a mano contra una sucursal de prueba desde el SQL editor de
Supabase (`hub_create_campaign_code` necesita una campaña, o inserta una
fila en `hub_campaign_codes` con la clave de servicio) y recorre el flujo
de reserva completo: validar, aplicar, cobrar, canjear, y comprobar que
`appointments.hub_campaign_id` queda relleno y que
`hub_code_redemptions.discount_cents` trae el importe correcto.

Añade pruebas de los cuatro casos que más duelen: código caducado, código
agotado, cliente repitiendo, y reintento del canje sobre la misma cita.

El contrato completo, con los detalles del lado del Hub, está en el
repositorio del Hub en `docs/CODIGOS-EN-TRIMM.md`.
