/**
 * Capa fina sobre gtag.js.
 *
 * Existe por dos motivos que el fragmento que da Google no cubre:
 *
 *  1. Esto es una aplicación de una sola página. El `config` de gtag solo
 *     dispara una vista al cargar; los cambios de ruta de React Router no los
 *     ve. Por eso el fragmento de index.html lleva `send_page_view: false` y
 *     las vistas se envían desde aquí.
 *
 *  2. Algunas rutas del Hub llevan datos personales en la URL. La página de
 *     baja se abre con `?t=<token>`, y ese token identifica a un destinatario
 *     concreto de una campaña: es, en la práctica, la dirección de correo de
 *     esa persona. Mandarlo a Google Analytics sería filtrar un dato personal
 *     a un tercero sin ninguna necesidad. Aquí se limpia antes de enviar nada.
 */

export const GA_MEASUREMENT_ID = 'G-3SNJJVNPEM';

/**
 * Parámetros que nunca deben salir del navegador hacia Google.
 *   t, token → identifican al destinatario de una campaña
 *   tc       → token de atribución del enlace de reserva
 *   code     → códigos de vinculación de negocio
 */
const SENSITIVE_PARAMS = ['t', 'token', 'tc', 'code'];

type GtagFn = (...args: unknown[]) => void;

function gtag(...args: unknown[]) {
  const fn = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof fn === 'function') fn(...args);
}

export const analyticsAvailable = () =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as { gtag?: GtagFn }).gtag === 'function';

/** Devuelve la URL sin los parámetros que no deben compartirse. */
export function sanitizeUrl(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    let touched = false;

    for (const param of SENSITIVE_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        touched = true;
      }
    }

    // Deja constancia de que la ruta llevaba un token, sin revelar cuál:
    // así se puede medir cuánta gente llega desde los correos.
    if (touched) url.searchParams.set('via', 'email');

    return url.pathname + (url.search || '') + url.hash;
  } catch {
    return href;
  }
}

/** Envía una vista de página. Se llama en cada cambio de ruta. */
export function trackPageView(path: string, title?: string) {
  if (!analyticsAvailable()) return;

  const clean = sanitizeUrl(path);

  gtag('event', 'page_view', {
    page_path: clean,
    page_location: window.location.origin + clean,
    page_title: title ?? document.title,
  });
}

/**
 * Evento de negocio. Nunca le pases correos, nombres de cliente ni tokens:
 * las condiciones de Google Analytics prohíben enviar datos personales, y
 * además no hacen falta para lo que se quiere medir aquí.
 */
export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}) {
  if (!analyticsAvailable()) return;
  gtag('event', name, params);
}
