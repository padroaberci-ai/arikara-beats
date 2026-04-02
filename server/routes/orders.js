import express from 'express';
import { sendCustomerOrderConfirmation, sendInternalSaleNotification } from '../services/email.service.js';
import { getOrderById, listOrders, toPublicOrderSummary, updateOrder } from '../services/storage.service.js';
import { getCheckoutSession, hasStripeSecretKey, hasStripeWebhookSecret } from '../services/stripe.service.js';

const router = express.Router();

const isLocalRequest = (req) => {
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  return ip.includes('127.0.0.1') || ip.includes('::1');
};

const hasAdminAccess = (req) => {
  const configuredKey = process.env.ORDERS_API_KEY;
  const providedKey = req.get('x-orders-key') || req.query.key;
  if (configuredKey) {
    return providedKey === configuredKey;
  }
  return isLocalRequest(req);
};

const nowIso = () => new Date().toISOString();

const extractCustomFields = (fields = []) =>
  fields.reduce((acc, field) => {
    const value = field.text?.value || field.dropdown?.value || '';
    acc[field.key] = value;
    return acc;
  }, {});

router.get('/', async (req, res) => {
  if (!hasAdminAccess(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const orders = await listOrders();
  return res.json({
    orders: orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      customerEmail: order.customer?.email || '',
      total: order.total,
      currency: order.currency,
      items: (order.items || []).length
    }))
  });
});

router.get('/:orderId', async (req, res) => {
  if (!hasAdminAccess(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const order = await getOrderById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  return res.json({ order });
});

router.get('/:orderId/summary', async (req, res) => {
  let order = await getOrderById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  const isAdmin = hasAdminAccess(req);
  const sessionId = String(req.query.session_id || '');
  if (!isAdmin && (!sessionId || sessionId !== order.stripe?.checkoutSessionId)) {
    return res.status(403).json({ error: 'No autorizado para ver este resumen' });
  }

  let paymentObserved = false;
  let degradedMode = false;

  if (
    sessionId &&
    sessionId === order.stripe?.checkoutSessionId &&
    hasStripeSecretKey() &&
    !hasStripeWebhookSecret() &&
    order.status === 'pending_checkout'
  ) {
    try {
      const session = await getCheckoutSession(sessionId);
      const customFields = extractCustomFields(session.custom_fields);
      const sessionLooksPaid = session.status === 'complete' && session.payment_status === 'paid';

      order = {
        ...order,
        customer: {
          ...order.customer,
          name: session.customer_details?.name || order.customer?.name || '',
          email: session.customer_details?.email || session.customer_email || order.customer?.email || '',
          artistName: customFields.artist_name || order.customer?.artistName || '',
          instagram: customFields.instagram || order.customer?.instagram || '',
          notes: customFields.notes || order.customer?.notes || ''
        },
        stripe: {
          ...order.stripe,
          paymentIntentId: session.payment_intent || order.stripe?.paymentIntentId || '',
          paymentStatus: session.payment_status || order.stripe?.paymentStatus || '',
          sessionStatus: session.status || order.stripe?.sessionStatus || '',
          confirmationMode: hasStripeWebhookSecret() ? 'webhook' : 'success_return_fallback'
        }
      };

      if (sessionLooksPaid) {
        paymentObserved = true;
        degradedMode = !hasStripeWebhookSecret();
        order.status = 'paid_pending_delivery';
      }

      const sentInternal = paymentObserved && !order.notifications?.internalSentAt
        ? await sendInternalSaleNotification(order)
        : false;
      const sentCustomer = paymentObserved && !order.notifications?.customerSentAt
        ? await sendCustomerOrderConfirmation(order)
        : false;

      const updated = {
        ...order,
        notifications: {
          internalSentAt: sentInternal ? nowIso() : order.notifications?.internalSentAt || '',
          customerSentAt: sentCustomer ? nowIso() : order.notifications?.customerSentAt || ''
        }
      };

      order = await updateOrder(order.id, () => updated);
    } catch (error) {
      console.warn('[orders] No se pudo reconciliar session de Stripe en summary:', error.message);
    }
  }

  return res.json({
    order: {
      ...toPublicOrderSummary(order),
      paymentObserved,
      degradedMode,
      webhookReady: hasStripeWebhookSecret()
    }
  });
});

export default router;
