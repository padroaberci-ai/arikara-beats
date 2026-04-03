import express from 'express';
import { sendCustomerOrderConfirmation, sendInternalSaleNotification } from '../services/email.service.js';
import {
  findOrderByCheckoutSessionId,
  getOrderById,
  listOrders,
  toPublicOrderSummary,
  updateOrder
} from '../services/storage.service.js';
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
const orderTotalToCents = (order) => Math.round(Number(order.total || 0) * 100);
const orderSubtotalToCents = (order) => Math.round(Number(order.subtotal || order.total || 0) * 100);

const extractCustomFields = (fields = []) =>
  fields.reduce((acc, field) => {
    const value = field.text?.value || field.dropdown?.value || '';
    acc[field.key] = value;
    return acc;
  }, {});

async function confirmOrderFromStripeSession({ orderId, sessionId }) {
  if (!sessionId) {
    return { ok: false, status: 400, error: 'session_id requerido' };
  }
  if (!hasStripeSecretKey()) {
    return { ok: false, status: 503, error: 'Stripe no está configurado en el servidor' };
  }
  if (hasStripeWebhookSecret()) {
    return { ok: false, status: 409, error: 'La confirmación fallback está desactivada porque el webhook ya está activo' };
  }

  const session = await getCheckoutSession(sessionId);
  const derivedOrderId = orderId || session.client_reference_id || session.metadata?.orderId || '';
  let order = derivedOrderId
    ? await getOrderById(derivedOrderId)
    : await findOrderByCheckoutSessionId(sessionId);

  if (!order) {
    console.warn(`[orders/confirm] session=${sessionId} sin pedido asociado`);
    return { ok: false, status: 404, error: 'Pedido no encontrado para la sesión recibida' };
  }

  if (orderId && order.id !== orderId) {
    return { ok: false, status: 409, error: 'La sesión no corresponde con el pedido solicitado' };
  }

  if (order.stripe?.checkoutSessionId && order.stripe.checkoutSessionId !== sessionId) {
    return { ok: false, status: 409, error: 'session_id no coincide con el pedido' };
  }

  const expectedCurrency = String(order.currency || 'EUR').toLowerCase();
  const expectedSubtotal = orderSubtotalToCents(order);
  const sessionSubtotal = Number(session.amount_subtotal ?? session.amount_total ?? 0);
  const sessionTotal = Number(session.amount_total || 0);
  const paymentSettled = ['paid', 'no_payment_required'].includes(String(session.payment_status || '').toLowerCase());
  const sessionLooksPaid =
    session.status === 'complete' &&
    paymentSettled &&
    (session.client_reference_id === order.id || session.metadata?.orderId === order.id) &&
    String(session.currency || '').toLowerCase() === expectedCurrency &&
    sessionSubtotal === expectedSubtotal &&
    sessionTotal >= 0 &&
    sessionTotal <= expectedSubtotal;

  console.log(
    `[orders/confirm] order=${order.id} session=${sessionId} status=${session.status} payment_status=${session.payment_status} amount_total=${session.amount_total}`
  );

  const customFields = extractCustomFields(session.custom_fields);
  const baseOrder = {
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
      checkoutSessionId: session.id || order.stripe?.checkoutSessionId || '',
      paymentIntentId: session.payment_intent || order.stripe?.paymentIntentId || '',
      paymentStatus: session.payment_status || order.stripe?.paymentStatus || '',
      sessionStatus: session.status || order.stripe?.sessionStatus || '',
      confirmationMode: 'success_return_fallback',
      amountSubtotal: sessionSubtotal,
      amountTotal: sessionTotal,
      amountDiscount: Number(session.total_details?.amount_discount || 0)
    }
  };

  if (!sessionLooksPaid) {
    console.warn(
      `[orders/confirm] session=${sessionId} todavía no confirmada: status=${session.status} payment_status=${session.payment_status}`
    );
    const updatedPending = await updateOrder(order.id, () => baseOrder);
    return {
      ok: false,
      status: 409,
      error: 'Stripe todavía no marca esta sesión como pagada',
      order: updatedPending
    };
  }

  const sentInternal = !order.notifications?.internalSentAt
    ? await sendInternalSaleNotification(baseOrder)
    : false;
  const sentCustomer = !order.notifications?.customerSentAt
    ? await sendCustomerOrderConfirmation(baseOrder)
    : false;

  const updatedOrder = await updateOrder(order.id, (currentOrder) => ({
    ...currentOrder,
    ...baseOrder,
    status: 'paid_pending_delivery',
    total: sessionTotal / 100,
    notifications: {
      internalSentAt: sentInternal ? nowIso() : currentOrder.notifications?.internalSentAt || '',
      customerSentAt: sentCustomer ? nowIso() : currentOrder.notifications?.customerSentAt || ''
    }
  }));

  return { ok: true, status: 200, order: updatedOrder };
}

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
  const order = await getOrderById(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  const isAdmin = hasAdminAccess(req);
  const sessionId = String(req.query.session_id || '');
  if (!isAdmin && (!sessionId || sessionId !== order.stripe?.checkoutSessionId)) {
    return res.status(403).json({ error: 'No autorizado para ver este resumen' });
  }

  return res.json({
    order: {
      ...toPublicOrderSummary(order),
      paymentObserved: order.status === 'paid_pending_delivery',
      degradedMode: order.stripe?.confirmationMode === 'success_return_fallback',
      webhookReady: hasStripeWebhookSecret()
    }
  });
});

router.post('/confirm', async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const result = await confirmOrderFromStripeSession({ orderId, sessionId });

    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        order: result.order ? {
          ...toPublicOrderSummary(result.order),
          paymentObserved: result.order.status === 'paid_pending_delivery',
          degradedMode: true,
          webhookReady: false
        } : null
      });
    }

    return res.json({
      order: {
        ...toPublicOrderSummary(result.order),
        paymentObserved: true,
        degradedMode: true,
        webhookReady: false
      }
    });
  } catch (error) {
    console.error('[orders/confirm] Error inesperado:', error.message);
    return res.status(500).json({ error: 'No se pudo confirmar el pedido con Stripe' });
  }
});

export default router;
