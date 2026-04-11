/* server/index.js
   Minimal backend for ARIKARA BEATS (MVP)
*/

import express from 'express';
import dotenv from 'dotenv';

import checkoutRoute from './routes/checkout.js';
import ordersRoute from './routes/orders.js';
import stripeWebhook from './webhooks/stripe.js';

dotenv.config();

const app = express();
const defaultAllowedOrigins = [
  'https://arikarabeats.com',
  'https://www.arikarabeats.com',
  'https://arikarabeats.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .concat(defaultAllowedOrigins)
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-orders-key');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

/* Stripe webhook (raw body) */
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

/* Body parsing */
app.use(express.json({ limit: '1mb' }));

/* API */
app.use('/api/checkout', checkoutRoute);
app.use('/api/orders', ordersRoute);

/* Healthcheck */
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'ARIKARA BEATS API'
  });
});

/* Fallback */
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[ARIKARA] server running on http://localhost:${PORT}`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('[ARIKARA] Stripe checkout desactivado: falta STRIPE_SECRET_KEY en .env');
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[ARIKARA] Webhook Stripe en modo espera: falta STRIPE_WEBHOOK_SECRET');
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.warn('[ARIKARA] transport=resend disabled: falta RESEND_API_KEY o EMAIL_FROM');
  }
});
