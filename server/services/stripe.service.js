import Stripe from 'stripe';

let stripe;
export const hasStripeSecretKey = () => Boolean(process.env.STRIPE_SECRET_KEY);
export const hasStripeWebhookSecret = () => Boolean(process.env.STRIPE_WEBHOOK_SECRET);

export function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY no configurada');
    }
    stripe = new Stripe(key, { apiVersion: '2023-10-16' });
  }

  return stripe;
}

export async function getCheckoutSession(sessionId) {
  const client = getStripe();
  return client.checkout.sessions.retrieve(sessionId, {
    expand: ['customer']
  });
}

export async function getCheckoutSessionLineItems(sessionId) {
  const client = getStripe();
  return client.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ['data.price.product']
  });
}

export async function createCheckoutSession({ order }) {
  const client = getStripe();
  const baseUrl = process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:3000';
  const currency = (process.env.STRIPE_CURRENCY || order.currency || 'eur').toLowerCase();
  const beatIds = (order.items || []).map((item) => item.beatId).filter(Boolean).join(',');
  const licenses = (order.items || []).map((item) => item.licenseType).filter(Boolean).join(',');

  const lineItems = (order.items || []).map((item) => ({
    quantity: item.quantity || 1,
    price_data: {
      currency,
      unit_amount: Math.round(Number(item.unitPriceSnapshot || item.baseUnitPriceSnapshot || 0) * 100),
      product_data: {
        name: `${item.beatTitleSnapshot} — ${item.licenseNameSnapshot}`,
        metadata: {
          orderId: order.id,
          beatId: item.beatId,
          beatSlug: item.beatSlug,
          license: item.licenseType,
          licenseType: item.licenseType,
          baseUnitPrice: String(item.baseUnitPriceSnapshot ?? item.unitPriceSnapshot ?? ''),
          finalUnitPrice: String(item.unitPriceSnapshot ?? '')
        }
      }
    }
  }));

  return client.checkout.sessions.create({
    mode: 'payment',
    locale: 'es',
    line_items: lineItems,
    billing_address_collection: 'auto',
    customer_creation: 'always',
    allow_promotion_codes: true,
    client_reference_id: order.id,
    success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${encodeURIComponent(order.id)}`,
    cancel_url: `${baseUrl}/cancel.html`,
    metadata: {
      source: 'arikarabeats-web',
      orderId: order.id,
      beatId: beatIds,
      license: licenses,
      baseSubtotal: String(order.baseSubtotal ?? order.subtotal ?? order.total ?? ''),
      discountTotal: String(order.discountTotal ?? 0)
    },
    custom_fields: [
      {
        key: 'artist_name',
        label: { type: 'custom', custom: 'Nombre artístico (opcional)' },
        type: 'text',
        optional: true
      },
      {
        key: 'instagram',
        label: { type: 'custom', custom: 'Instagram (opcional)' },
        type: 'text',
        optional: true
      },
      {
        key: 'notes',
        label: { type: 'custom', custom: 'Nota / comentario (opcional)' },
        type: 'text',
        optional: true
      }
    ]
  });
}
