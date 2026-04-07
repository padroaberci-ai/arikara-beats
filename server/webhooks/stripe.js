import { sendCustomerOrderConfirmation, sendInternalSaleNotification } from '../services/email.service.js';
import { getOrderById, updateOrder } from '../services/storage.service.js';
import { getStripe } from '../services/stripe.service.js';

const extractCustomFields = (fields = []) =>
  fields.reduce((acc, field) => {
    const value = field.text?.value || field.dropdown?.value || '';
    acc[field.key] = value;
    return acc;
  }, {});

const getSessionCustomerEmail = (session, fallback = '') =>
  session.customer_details?.email ||
  session.customer_email ||
  (typeof session.customer === 'object' ? session.customer?.email || '' : '') ||
  fallback ||
  '';

const getSessionCustomerName = (session, fallback = '') =>
  session.customer_details?.name ||
  (typeof session.customer === 'object' ? session.customer?.name || '' : '') ||
  fallback ||
  '';

export default async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[stripe] STRIPE_WEBHOOK_SECRET no configurado. Webhook en modo espera.');
    return res.status(202).json({ received: false, webhookReady: false });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe] Firma inválida', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const session = event.data.object;
  const orderId = session.metadata?.orderId || session.client_reference_id;

  try {
    if (event.type === 'checkout.session.completed') {
      const customFields = extractCustomFields(session.custom_fields);
      const order = await getOrderById(orderId);
      if (!order) {
        console.warn(`[stripe] Pedido no encontrado para session ${session.id}`);
        return res.json({ received: true });
      }
      if (order.stripe?.eventIds?.includes(event.id)) {
        return res.json({ received: true });
      }

      const updatedOrder = await updateOrder(order.id, (currentOrder) => ({
        ...currentOrder,
        status: 'paid_pending_delivery',
        customer: {
          ...currentOrder.customer,
          name: getSessionCustomerName(session, currentOrder.customer?.name || ''),
          email: getSessionCustomerEmail(session, currentOrder.customer?.email || ''),
          artistName: customFields.artist_name || currentOrder.customer?.artistName || '',
          instagram: customFields.instagram || currentOrder.customer?.instagram || '',
          notes: customFields.notes || currentOrder.customer?.notes || ''
        },
        stripe: {
          ...currentOrder.stripe,
          checkoutSessionId: session.id || currentOrder.stripe?.checkoutSessionId || '',
          paymentIntentId: session.payment_intent || currentOrder.stripe?.paymentIntentId || '',
          paymentStatus: session.payment_status || currentOrder.stripe?.paymentStatus || '',
          sessionStatus: session.status || currentOrder.stripe?.sessionStatus || '',
          confirmationMode: 'webhook',
          eventIds: [...new Set([...(currentOrder.stripe?.eventIds || []), event.id])]
        }
      }));

      const sentInternal = !updatedOrder.notifications?.internalSentAt
        ? await sendInternalSaleNotification(updatedOrder)
        : false;
      const sentCustomer = !updatedOrder.notifications?.customerSentAt
        ? await sendCustomerOrderConfirmation(updatedOrder)
        : false;

      if (sentInternal || sentCustomer) {
        await updateOrder(updatedOrder.id, (currentOrder) => ({
          ...currentOrder,
          notifications: {
            internalSentAt: sentInternal
              ? new Date().toISOString()
              : currentOrder.notifications?.internalSentAt || '',
            customerSentAt: sentCustomer
              ? new Date().toISOString()
              : currentOrder.notifications?.customerSentAt || ''
          }
        }));
      }
    }

    if (event.type === 'checkout.session.expired') {
      const order = await getOrderById(orderId);
      if (order && !order.stripe?.eventIds?.includes(event.id) && order.status === 'pending_checkout') {
        await updateOrder(order.id, (currentOrder) => ({
          ...currentOrder,
          status: 'cancelled',
          stripe: {
            ...currentOrder.stripe,
            checkoutSessionId: session.id || currentOrder.stripe?.checkoutSessionId || '',
            eventIds: [...new Set([...(currentOrder.stripe?.eventIds || []), event.id])]
          }
        }));
      }
    }
  } catch (err) {
    console.error('[stripe] Error procesando webhook', err.message);
    return res.status(500).send('Webhook handler failed');
  }

  res.json({ received: true });
}
