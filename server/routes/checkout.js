import express from 'express';
import { getBeatByReference, getLicenseById, isBeatPurchasable, isLicensePurchasable } from '../services/catalog.service.js';
import { createOrder, updateOrder } from '../services/storage.service.js';
import { createCheckoutSession, hasStripeSecretKey } from '../services/stripe.service.js';

const router = express.Router();
const currency = (process.env.STRIPE_CURRENCY || 'eur').toUpperCase();

router.post('/', async (req, res) => {
  try {
    if (!hasStripeSecretKey()) {
      return res.status(503).json({ error: 'Stripe no está configurado todavía en el servidor.' });
    }

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrito vacío' });
    }

    const normalized = new Map();

    for (const rawItem of items) {
      const beatIdReference = String(rawItem?.beatId || '').trim();
      const slugReference = String(rawItem?.slug || '').trim();
      const reference = beatIdReference || slugReference;
      const licenseType = String(rawItem?.license || '').trim().toLowerCase();

      if (!reference || !licenseType) {
        return res.status(400).json({ error: 'Carrito inválido' });
      }

      if (licenseType === 'exclusive') {
        return res.status(400).json({ error: 'La licencia Exclusive se gestiona por contacto directo.' });
      }

      const beat =
        (beatIdReference ? await getBeatByReference(beatIdReference) : null) ||
        (slugReference ? await getBeatByReference(slugReference) : null);
      if (!beat) {
        return res.status(400).json({ error: 'Uno de los beats del carrito ya no existe.' });
      }
      if (!isBeatPurchasable(beat)) {
        return res.status(400).json({ error: `El beat ${beat.title} no está disponible para compra.` });
      }

      const license = await getLicenseById(licenseType);
      if (!isLicensePurchasable(license)) {
        return res.status(400).json({ error: `La licencia ${licenseType} no está disponible para compra.` });
      }

      const existing = normalized.get(beat.id);
      if (existing && existing.licenseType !== licenseType) {
        return res.status(400).json({ error: `Solo puedes comprar una licencia por beat: ${beat.title}.` });
      }
      if (existing) continue;

      const unitPrice = Number(beat.prices?.[licenseType]);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({ error: `Precio inválido para ${beat.title}.` });
      }

      normalized.set(beat.id, {
        beatId: beat.id,
        beatSlug: beat.slug,
        beatTitleSnapshot: beat.title,
        licenseType,
        licenseNameSnapshot: license.name,
        unitPriceSnapshot: unitPrice,
        quantity: 1,
        fulfillmentStatus: 'pending'
      });
    }

    const orderItems = Array.from(normalized.values());
    if (orderItems.length === 0) {
      return res.status(400).json({ error: 'Carrito vacío' });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.unitPriceSnapshot * item.quantity, 0);
    const draftOrder = await createOrder({
      status: 'pending_checkout',
      currency,
      subtotal,
      total: subtotal,
      items: orderItems
    });

    const session = await createCheckoutSession({ order: draftOrder });
    const order = await updateOrder(draftOrder.id, (currentOrder) => ({
      ...currentOrder,
      stripe: {
        ...currentOrder.stripe,
        checkoutSessionId: session.id,
        sessionStatus: session.status || '',
        confirmationMode: process.env.STRIPE_WEBHOOK_SECRET ? 'webhook' : 'success_return_fallback'
      }
    }));

    console.log(
      `[checkout] order=${order.id} session=${session.id} status=${session.status || 'unknown'} amount=${Math.round(
        subtotal * 100
      )} currency=${currency}`
    );

    return res.json({ url: session.url, orderId: order.id });
  } catch (err) {
    console.error('[checkout]', err.message);
    return res.status(500).json({ error: 'Error creando sesión de pago' });
  }
});

export default router;
