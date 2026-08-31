// ============================================================
// TRIMM Hub — Modo de Stripe
//
// El Hub y Trimm comparten proyecto de Supabase, así que comparten también
// los secretos de las Edge Functions: STRIPE_SECRET_KEY es la misma clave
// que cobra las suscripciones Pro de Trimm. No hay dos configuraciones que
// puedan desincronizarse.
//
// Lo que sí puede pasar es que alguien cambie ese secreto por una clave de
// pruebas para depurar algo y se le olvide devolverlo. En modo de pruebas
// un PaymentIntent llega a 'succeeded' sin que nadie haya pagado nada — y
// aquí eso significa acreditar envíos reales gratis. Por eso el camino del
// dinero se niega a funcionar si la clave no es de producción.
// ============================================================

export const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

export type StripeMode = 'live' | 'test' | 'desconocido'

// sk_ son las claves normales; rk_ las restringidas. Ambas llevan el modo
// en el prefijo.
export function stripeMode(): StripeMode {
  if (/^(sk|rk)_live_/.test(STRIPE_KEY)) return 'live'
  if (/^(sk|rk)_test_/.test(STRIPE_KEY)) return 'test'
  return 'desconocido'
}

/**
 * Devuelve el motivo por el que no se debe cobrar, o null si todo está bien.
 *
 * Se comprueba antes que la sesión del usuario, igual que el worker de
 * campañas comprueba el remitente antes de tocar la cola: un fallo de
 * configuración tiene que ser ruidoso y no depender de que alguien con
 * sesión iniciada lo descubra pagando.
 */
export function stripeModeProblem(): string | null {
  const mode = stripeMode()

  if (mode === 'live') return null

  if (mode === 'test') {
    return 'Stripe está configurado en modo de pruebas. En ese modo los pagos '
      + 'se dan por buenos sin cobrar nada, así que acreditar envíos sería '
      + 'regalarlos. Pon en STRIPE_SECRET_KEY la clave de producción, la misma '
      + 'que usa Trimm para las suscripciones Pro.'
  }

  return 'STRIPE_SECRET_KEY no está configurada o no tiene un formato '
    + 'reconocible. Debe ser la clave de producción de Stripe, la misma que '
    + 'usa Trimm para las suscripciones Pro.'
}

/**
 * Segunda barrera, esta vez con la palabra de Stripe y no con el prefijo de
 * la clave: todo objeto de Stripe dice en qué modo se creó. Si el objeto no
 * es de producción, no se acredita saldo por él.
 */
export function isLiveObject(obj: { livemode?: boolean } | null | undefined): boolean {
  return obj?.livemode === true
}
