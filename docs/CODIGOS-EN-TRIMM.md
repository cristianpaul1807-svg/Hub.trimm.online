# Códigos de campaña: qué tiene que hacer Trimm

Todo lo del lado del Hub ya está en producción. Trimm necesita dos
llamadas, las dos a la misma base de datos que ya usa — no hay API que
montar ni servicio que desplegar.

## Por qué existe esto

Hoy el Hub manda correos que dicen «15% de descuento para ti» y **nada
aplica ese descuento**. El cliente llega con una captura, la peluquería no
tiene constancia de nada, y el descuento se concede a ojo o no se concede.
Es una promesa comercial que ningún sistema cumple.

El código la hace real. Y de paso resuelve la atribución donde el enlace
no llega: `?tc=<token>` solo funciona si la persona pincha y reserva en esa
misma sesión — se pierde si abre el correo en el móvil y reserva en el
portátil, si llama por teléfono, o si reserva el jueves siguiente. El
código sobrevive a todo eso porque se puede dictar, apuntar y teclear.

Los dos caminos conviven: el enlace lo trae ya escrito para quien pincha,
y el código queda para todos los demás.

## Paso 5 de la reserva: validar mientras teclea

```ts
const { data } = await supabase.rpc('hub_validate_code', {
  p_code:        codigoQueTecleo,     // como venga; se normaliza dentro
  p_business_id: negocioId,
  p_client_id:   clienteId ?? null,   // null si aún no se identificó
});
```

Respuesta cuando vale:

```json
{ "valid": true, "code": "DTO20-MU5BD", "kind": "percent",
  "value": 20.00, "valid_until": "2026-11-02T…" }
```

- `kind: "percent"` → descuenta `value` por ciento.
- `kind: "fixed"` → descuenta `value` **céntimos**.
- `kind: "none"` → no toca el precio. Es de una campaña de fidelización o
  de recuperación: sirve para atribuir la reserva, no para descontar.
  Acéptalo igual y no enseñes ningún descuento.

Cuando no vale, `{ "valid": false, "reason": "…" }`:

| `reason` | Qué decirle al cliente |
|---|---|
| `not_found` | Este código no es válido aquí |
| `expired` | Este código ha caducado |
| `exhausted` | Este código ya se ha agotado |
| `already_used` | Ya usaste este código |
| `not_yet` | Este código aún no está activo |
| `empty` | (no enseñes nada, el campo está vacío) |

**`not_found` es a propósito ambiguo.** Un código que no existe y uno que
existe pero es de otra sucursal dan exactamente la misma respuesta. Si se
distinguieran, cualquiera podría averiguar códigos ajenos probándolos
contra un negocio suyo.

Validar **no gasta** el código. Llámala tantas veces como haga falta
mientras el cliente escribe.

## Al confirmar la reserva: canjear

Solo cuando la cita ya existe y está confirmada. Canjear al teclear
gastaría el código de quien se arrepiente a mitad del formulario.

```ts
const { data } = await supabase.rpc('hub_redeem_code', {
  p_code:           codigo,
  p_business_id:    negocioId,
  p_appointment_id: citaId,          // obligatorio
  p_client_id:      clienteId ?? null,
  p_discount_cents: descontadoEnCentimos,  // lo que de verdad se rebajó
});
```

`p_discount_cents` importa más de lo que parece: sin él, el retorno de la
campaña se calcula sobre facturación bruta y sale inflado. Un 20% de
descuento sobre 1.000 € de citas no son 1.000 € de beneficio.

**Es idempotente por cita.** Si la llamada se pierde por la red y
reintentas, devuelve `{ success: true, duplicate: true }` y no cuenta un
canje de más. Trátalo como éxito.

Canjear también atribuye la cita a la campaña (`appointments.hub_campaign_id`),
así que **no hace falta llamar además a `hub_attribute_appointment`**. Si
llamas a las dos, la primera que llegue se lleva el mérito y la otra no
hace nada.

## Con pagos en línea

Con `kind: "percent"` y `value: 20`, sobre un servicio de 50 €:

```
base          5000 céntimos
descuento     1000   (redondea como prefieras, pero hazlo una sola vez)
a cobrar      4000
```

Cobra los 4000 y pasa `p_discount_cents: 1000` al canjear. El orden
correcto es: cobrar primero, canjear después. Si canjeas antes y el pago
falla, has gastado un canje por una reserva que no existe.

## Lo que Trimm NO debe hacer

- **No escribir en `hub_campaign_codes` ni en `hub_code_redemptions`.**
  Los permisos de escritura están revocados para `anon` y `authenticated`;
  todo pasa por las dos funciones.
- **No confiar en el `value` que llegue del navegador.** Vuelve a llamar a
  `hub_validate_code` en el servidor antes de cobrar. Lo que el cliente ve
  es lo que se le enseñó, no lo que se le cobra.
- **No fallar la reserva si el código falla.** Una cita nunca debe perderse
  por un problema de descuento: si `hub_redeem_code` devuelve error,
  guarda la cita igualmente y avisa de que el código no se pudo aplicar.

## Dónde sale el código

`hub_campaign_codes.code`, una fila por campaña. El Hub lo genera al
lanzarla, con el prefijo diciendo de qué es —`DTO20-…`, `VUELVE-…`,
`PUNTOS-…`— y cinco caracteres aleatorios sin I, O, 0 ni 1, porque la
gente los dicta por teléfono.

Caduca a los 60 días por defecto y lleva tope de canjes.
