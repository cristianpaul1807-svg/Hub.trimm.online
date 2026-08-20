import { loadStripe, type Stripe } from '@stripe/stripe-js';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

if (!publishableKey) {
  console.warn(
    'Falta VITE_STRIPE_PUBLISHABLE_KEY. Los formularios de pago no se podrán mostrar.',
  );
}

// loadStripe se llama una sola vez y fuera de los componentes: si se invoca
// en cada render, Stripe vuelve a inyectar su script en cada pintado.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe() {
  if (!publishableKey) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export const stripeConfigured = Boolean(publishableKey);

/** Apariencia de Stripe Elements alineada con el sistema visual del Hub. */
export const stripeAppearance = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#2563eb',
    colorBackground: '#ffffff',
    colorText: '#0f172a',
    colorDanger: '#ef4444',
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    borderRadius: '12px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': { border: '1px solid #e2e8f0', boxShadow: 'none', padding: '12px' },
    '.Input:focus': { border: '1px solid #2563eb', boxShadow: '0 0 0 3px rgba(37,99,235,.12)' },
    '.Label': { fontWeight: '700', fontSize: '12px', color: '#64748b' },
  },
};
