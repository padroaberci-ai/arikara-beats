import express from 'express';
import { getBeatByReference, getLicenseById } from '../services/catalog.service.js';
import { sendCustomerOrderConfirmation, sendInternalSaleNotification } from '../services/email.service.js';
import {
  findOrderByCheckoutSessionId,
  getOrderById,
  listOrders,
  toPublicOrderSummary,
  upsertOrder,
  updateOrder
} from '../services/storage.service.js';
import {
  getCheckoutSession,
  getCheckoutSessionLineItems,
  hasStripeSecretKey,
  hasStripeWebhookSecret
} from '../services/stripe.service.js';

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

const extractCustomFields = (fields = []) =>
  fields.reduce((acc, field) => {
    const value = field.text?.value || field.dropdown?.value || '';
    acc[field.key] = value;
    return acc;
  }, {});

const fallbackLicenseName = (licenseType) => {
  const normalized = String(licenseType || '').trim().toLowerCase();
  if (normalized === 'basic') return 'Basic';
  if (normalized === 'premium') return 'Premium';
  if (normalized === 'exclusive') return 'Exclusive';
  return normalized || 'Licencia';
};

const splitLineItemDescription = (description = '') => {
  const raw = String(description || '');
  const separator = ' — ';
  if (!raw.includes(separator)) {
    return {
      beatTitleSnapshot: raw.trim(),
      licenseNameSnapshot: ''
    };
  }

  const [beatTitleSnapshot, ...rest] = raw.split(separator);
  return {
    beatTitleSnapshot: beatTitleSnapshot.trim(),
    licenseNameSnapshot: rest.join(separator).trim()
  };
};

async function recoverOrderFromStripeSession({ orderId, session }) {
  const recoveredOrderId = String(session.client_reference_id || session.metadata?.orderId || orderId || '').trim();
  if (!recoveredOrderId) {
    return null;
  }

  const existingOrder =
    (await findOrderByCheckoutSessionId(session.id)) ||
    (await getOrderById(recoveredOrderId));
  if (existingOrder) {
    return existingOrder;
  }

  const customFields = extractCustomFields(session.custom_fields);
  const recoveredItems = [];
  try {
    const lineItems = await getCheckoutSessionLineItems(session.id);

    for (const lineItem of lineItems.data || []) {
      const quantity = Math.max(1, Number(lineItem.quantity || 1));
      const rawProduct = lineItem.price?.product;
      const productMetadata = typeof rawProduct === 'object' ? rawProduct?.metadata || {} : {};
      const licenseType = String(productMetadata.licenseType || productMetadata.license || '').trim().toLowerCase();
      const beatReference = String(productMetadata.beatId || productMetadata.beatSlug || '').trim();
      const beat = beatReference ? await getBeatByReference(beatReference) : null;
      const license = licenseType ? await getLicenseById(licenseType) : null;
      const descriptionParts = splitLineItemDescription(lineItem.description);
      const rawUnitAmount = Number(lineItem.amount_subtotal ?? lineItem.amount_total ?? 0);

      recoveredItems.push({
        beatId: beat?.id || String(productMetadata.beatId || '').trim(),
        beatSlug: beat?.slug || String(productMetadata.beatSlug || '').trim(),
        beatTitleSnapshot: beat?.title || descriptionParts.beatTitleSnapshot || 'Beat',
        licenseType: license?.id || licenseType || 'basic',
        licenseNameSnapshot:
          license?.name || descriptionParts.licenseNameSnapshot || fallbackLicenseName(licenseType),
        unitPriceSnapshot: rawUnitAmount / quantity / 100,
        quantity,
        fulfillmentStatus: 'pending'
      });
    }
  } catch (error) {
    console.warn(`[orders/recover] No se pudieron leer line_items de Stripe para ${session.id}: ${error.message}`);
  }

  if (recoveredItems.length === 0) {
    const beatReferences = String(session.metadata?.beatId || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const licenseTypes = String(session.metadata?.license || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const fallbackQuantity = Math.max(beatReferences.length, licenseTypes.length, 1);
    const fallbackUnitAmount = Number(session.amount_subtotal ?? session.amount_total ?? 0) / fallbackQuantity / 100;

    for (let index = 0; index < fallbackQuantity; index += 1) {
      const beatReference = beatReferences[index] || beatReferences[0] || '';
      const licenseType = licenseTypes[index] || licenseTypes[0] || 'basic';
      const beat = beatReference ? await getBeatByReference(beatReference) : null;
      const license = await getLicenseById(licenseType);

      recoveredItems.push({
        beatId: beat?.id || beatReference,
        beatSlug: beat?.slug || '',
        beatTitleSnapshot: beat?.title || beatReference || 'Beat',
        licenseType: license?.id || licenseType,
        licenseNameSnapshot: license?.name || fallbackLicenseName(licenseType),
        unitPriceSnapshot: fallbackUnitAmount,
        quantity: 1,
        fulfillmentStatus: 'pending'
      });
    }
  }

  const recoveredOrder = await upsertOrder({
    id: recoveredOrderId,
    createdAt: session.created ? new Date(session.created * 1000).toISOString() : nowIso(),
    status: 'pending_checkout',
    currency: String(session.currency || 'eur').toUpperCase(),
    subtotal: Number(session.amount_subtotal ?? session.amount_total ?? 0) / 100,
    total: Number(session.amount_total || 0) / 100,
    customer: {
      name: getSessionCustomerName(session, ''),
      email: getSessionCustomerEmail(session, ''),
      artistName: customFields.artist_name || '',
      instagram: customFields.instagram || '',
      notes: customFields.notes || ''
    },
    stripe: {
      checkoutSessionId: session.id || '',
      paymentIntentId: session.payment_intent || '',
      eventIds: [],
      paymentStatus: session.payment_status || '',
      sessionStatus: session.status || '',
      confirmationMode: 'success_return_fallback'
    },
    notifications: {
      internalSentAt: '',
      customerSentAt: ''
    },
    items: recoveredItems
  });

  console.warn(
    `[orders/recover] pedido ${recoveredOrder.id} recreado desde Stripe session ${session.id} con ${recoveredItems.length} item(s)`
  );

  return recoveredOrder;
}

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
  const sessionOrderId = String(session.client_reference_id || session.metadata?.orderId || '').trim();
  let order = await findOrderByCheckoutSessionId(sessionId);
  if (!order && sessionOrderId) {
    order = await getOrderById(sessionOrderId);
  }
  if (!order && orderId) {
    order = await getOrderById(orderId);
  }
  if (!order) {
    order = await recoverOrderFromStripeSession({ orderId, session });
  }

  if (!order) {
    console.warn(`[orders/confirm] session=${sessionId} sin pedido asociado`);
    return { ok: false, status: 404, error: 'Pedido no encontrado para la sesión recibida' };
  }

  if (orderId && sessionOrderId && orderId !== sessionOrderId) {
    console.warn(
      `[orders/confirm] orderId recibido (${orderId}) no coincide con session.client_reference_id (${sessionOrderId}); se prioriza Stripe`
    );
  }

  if (sessionOrderId && order.id !== sessionOrderId) {
    const strictMatch = await getOrderById(sessionOrderId);
    if (strictMatch) {
      order = strictMatch;
    }
  }

  if (order.stripe?.checkoutSessionId && order.stripe.checkoutSessionId !== sessionId) {
    console.warn(
      `[orders/confirm] pedido ${order.id} tenía checkoutSessionId=${order.stripe.checkoutSessionId}; reconciliando con ${sessionId}`
    );
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
      name: getSessionCustomerName(session, order.customer?.name || ''),
      email: getSessionCustomerEmail(session, order.customer?.email || ''),
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

  const updatedOrder = await updateOrder(order.id, (currentOrder) => ({
    ...currentOrder,
    ...baseOrder,
    status: 'paid_pending_delivery',
    total: sessionTotal / 100
  }));

  if (!updatedOrder) {
    return { ok: false, status: 500, error: 'No se pudo actualizar el pedido tras confirmar el pago' };
  }

  console.log(
    `[orders/confirm] pedido ${updatedOrder.id} confirmado en fallback; estado=${updatedOrder.status} total=${updatedOrder.total} customer=${updatedOrder.customer?.email || '-'}`
  );

  const sentInternal = !updatedOrder.notifications?.internalSentAt
    ? await sendInternalSaleNotification(updatedOrder)
    : false;
  const sentCustomer = !updatedOrder.notifications?.customerSentAt
    ? await sendCustomerOrderConfirmation(updatedOrder)
    : false;

  if (!sentInternal && !sentCustomer) {
    return { ok: true, status: 200, order: updatedOrder };
  }

  const notifiedOrder = await updateOrder(updatedOrder.id, (currentOrder) => ({
    ...currentOrder,
    notifications: {
      internalSentAt: sentInternal ? nowIso() : currentOrder.notifications?.internalSentAt || '',
      customerSentAt: sentCustomer ? nowIso() : currentOrder.notifications?.customerSentAt || ''
    }
  }));

  return { ok: true, status: 200, order: notifiedOrder || updatedOrder };
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
  const sessionId = String(req.query.session_id || '');
  let order = await getOrderById(req.params.orderId);
  if (
    !order &&
    sessionId &&
    hasStripeSecretKey() &&
    !hasStripeWebhookSecret()
  ) {
    try {
      const result = await confirmOrderFromStripeSession({ orderId: req.params.orderId, sessionId });
      if (result.order) {
        order = result.order;
      }
    } catch (error) {
      console.warn('[orders/summary] No se pudo recuperar el pedido desde Stripe:', error.message);
      order =
        (await findOrderByCheckoutSessionId(sessionId)) ||
        (await getOrderById(req.params.orderId));
    }
  }
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  const isAdmin = hasAdminAccess(req);
  if (!isAdmin && (!sessionId || sessionId !== order.stripe?.checkoutSessionId)) {
    return res.status(403).json({ error: 'No autorizado para ver este resumen' });
  }

  let resolvedOrder = order;
  if (
    sessionId &&
    sessionId === order.stripe?.checkoutSessionId &&
    hasStripeSecretKey() &&
    !hasStripeWebhookSecret() &&
    order.status === 'pending_checkout'
  ) {
    try {
      const result = await confirmOrderFromStripeSession({ orderId: order.id, sessionId });
      if (result.order) {
        resolvedOrder = result.order;
      }
    } catch (error) {
      console.warn('[orders/summary] No se pudo reconciliar la sesión de Stripe:', error.message);
      resolvedOrder =
        (await findOrderByCheckoutSessionId(sessionId)) ||
        (await getOrderById(order.id)) ||
        resolvedOrder;
    }
  }

  return res.json({
    order: {
      ...toPublicOrderSummary(resolvedOrder),
      paymentObserved: resolvedOrder.status === 'paid_pending_delivery',
      degradedMode: resolvedOrder.stripe?.confirmationMode === 'success_return_fallback',
      webhookReady: hasStripeWebhookSecret()
    }
  });
});

router.post('/confirm', async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.order_id || '').trim();
  const sessionId = String(req.body?.sessionId || req.body?.session_id || '').trim();

  try {
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
    let fallbackOrder =
      (sessionId ? await findOrderByCheckoutSessionId(sessionId) : null) ||
      (orderId ? await getOrderById(orderId) : null);

    if (!fallbackOrder && sessionId && hasStripeSecretKey() && !hasStripeWebhookSecret()) {
      try {
        const session = await getCheckoutSession(sessionId);
        fallbackOrder = await recoverOrderFromStripeSession({ orderId, session });
      } catch (recoveryError) {
        console.warn('[orders/confirm] No se pudo rescatar el pedido tras error:', recoveryError.message);
      }
    }

    if (fallbackOrder) {
      return res.json({
        order: {
          ...toPublicOrderSummary(fallbackOrder),
          paymentObserved: fallbackOrder.status === 'paid_pending_delivery',
          degradedMode: true,
          webhookReady: false
        },
        warning: 'El pedido se devolvió desde almacenamiento local tras un error durante la confirmación'
      });
    }

    return res.status(500).json({ error: 'No se pudo confirmar el pedido con Stripe' });
  }
});

export default router;
