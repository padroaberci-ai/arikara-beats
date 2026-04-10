import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStripe, hasStripeSecretKey } from './stripe.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
let ordersQueue = Promise.resolve();

async function withOrdersLock(task) {
  const run = ordersQueue.then(task, task);
  ordersQueue = run.catch(() => {});
  return run;
}

async function ensureOrdersFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ORDERS_FILE);
  } catch {
    await fs.writeFile(ORDERS_FILE, '[]\n', 'utf8');
  }
}

async function readOrdersUnsafe() {
  await ensureOrdersFile();
  const raw = await fs.readFile(ORDERS_FILE, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeOrdersUnsafe(orders) {
  await ensureOrdersFile();
  const tempFile = `${ORDERS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, ORDERS_FILE);
}

function extractOrderSequence(orderId) {
  const match = String(orderId || '').match(/^ARK-(\d{6})$/);
  return match ? Number(match[1]) : 0;
}

function getHighestLocalOrderNumber(orders) {
  return orders.reduce((max, order) => Math.max(max, extractOrderSequence(order.id)), 0);
}

async function getHighestStripeOrderNumber() {
  if (!hasStripeSecretKey()) {
    return 0;
  }

  try {
    const stripe = getStripe();
    const sessions = await stripe.checkout.sessions.list({ limit: 100 });

    return sessions.data.reduce((max, session) => {
      return Math.max(
        max,
        extractOrderSequence(session.client_reference_id),
        extractOrderSequence(session.metadata?.orderId)
      );
    }, 0);
  } catch (error) {
    console.warn(`[storage] No se pudo consultar Stripe para calcular el siguiente pedido: ${error.message}`);
    return 0;
  }
}

async function nextOrderId(orders) {
  const localLast = getHighestLocalOrderNumber(orders);
  const stripeLast = await getHighestStripeOrderNumber();
  const last = Math.max(localLast, stripeLast);
  return `ARK-${String(last + 1).padStart(6, '0')}`;
}

export async function readOrders() {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    return clone(orders);
  });
}

export async function createOrder(payload) {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    const timestamp = nowIso();
    const order = {
      id: await nextOrderId(orders),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'pending_checkout',
      currency: 'EUR',
      subtotal: 0,
      total: 0,
      customer: {
        name: '',
        email: '',
        artistName: '',
        instagram: '',
        notes: ''
      },
      stripe: {
        checkoutSessionId: '',
        paymentIntentId: '',
        eventIds: [],
        paymentStatus: '',
        sessionStatus: '',
        confirmationMode: ''
      },
      notifications: {
        internalSentAt: '',
        customerSentAt: ''
      },
      items: [],
      ...payload
    };

    orders.push(order);
    await writeOrdersUnsafe(orders);
    return clone(order);
  });
}

export async function upsertOrder(payload) {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    const timestamp = nowIso();
    const nextOrder = {
      status: 'pending_checkout',
      currency: 'EUR',
      subtotal: 0,
      total: 0,
      customer: {
        name: '',
        email: '',
        artistName: '',
        instagram: '',
        notes: ''
      },
      stripe: {
        checkoutSessionId: '',
        paymentIntentId: '',
        eventIds: [],
        paymentStatus: '',
        sessionStatus: '',
        confirmationMode: ''
      },
      notifications: {
        internalSentAt: '',
        customerSentAt: ''
      },
      items: [],
      ...payload
    };

    const index = orders.findIndex((entry) => entry.id === nextOrder.id);
    if (index >= 0) {
      orders[index] = {
        ...orders[index],
        ...nextOrder,
        updatedAt: timestamp
      };
      await writeOrdersUnsafe(orders);
      return clone(orders[index]);
    }

    const createdOrder = {
      createdAt: timestamp,
      updatedAt: timestamp,
      ...nextOrder
    };

    orders.push(createdOrder);
    await writeOrdersUnsafe(orders);
    return clone(createdOrder);
  });
}

export async function getOrderById(orderId) {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    const order = orders.find((entry) => entry.id === orderId);
    return order ? clone(order) : null;
  });
}

export async function findOrderByCheckoutSessionId(sessionId) {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    const order = orders.find((entry) => entry.stripe?.checkoutSessionId === sessionId);
    return order ? clone(order) : null;
  });
}

export async function updateOrder(orderId, updater) {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    const index = orders.findIndex((entry) => entry.id === orderId);
    if (index === -1) return null;

    const current = clone(orders[index]);
    const next = await updater(current);
    if (!next) return clone(orders[index]);

    next.updatedAt = nowIso();
    orders[index] = next;
    await writeOrdersUnsafe(orders);
    return clone(next);
  });
}

export async function listOrders() {
  return withOrdersLock(async () => {
    const orders = await readOrdersUnsafe();
    return clone(
      orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    );
  });
}

export function toPublicOrderSummary(order) {
  if (!order) return null;
  return {
    id: order.id,
    createdAt: order.createdAt,
    status: order.status,
    currency: order.currency,
    total: order.total,
    customer: {
      name: order.customer?.name || '',
      email: order.customer?.email || ''
    },
    stripe: {
      paymentStatus: order.stripe?.paymentStatus || '',
      sessionStatus: order.stripe?.sessionStatus || '',
      confirmationMode: order.stripe?.confirmationMode || ''
    },
    notifications: {
      internalSentAt: order.notifications?.internalSentAt || '',
      customerSentAt: order.notifications?.customerSentAt || ''
    },
    items: (order.items || []).map((item) => ({
      beatTitleSnapshot: item.beatTitleSnapshot,
      licenseType: item.licenseType,
      unitPriceSnapshot: item.unitPriceSnapshot,
      quantity: item.quantity
    }))
  };
}
