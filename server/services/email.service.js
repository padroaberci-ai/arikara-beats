const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;

const formatEUR = (amount, currency = 'EUR') => {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency
    }).format(Number(amount || 0));
  } catch {
    return `${Number(amount || 0).toFixed(2)} ${currency}`;
  }
};

const renderItems = (items = []) =>
  items
    .map(
      (item) =>
        `<li><strong>${item.beatTitleSnapshot}</strong> — ${item.licenseType.toUpperCase()} · ${formatEUR(
          item.unitPriceSnapshot
        )}</li>`
    )
    .join('');

function getInternalNotificationEmail() {
  return (
    process.env.ORDER_NOTIFICATION_EMAIL ||
    process.env.SALES_NOTIFICATION_EMAIL ||
    process.env.EMAIL_TO ||
    ''
  ).trim();
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();

  if (!apiKey || !from) {
    return null;
  }

  return { apiKey, from };
}

async function sendMail({ to, subject, text, html }) {
  const config = getResendConfig();
  if (!config) {
    console.warn('[email] transport=resend disabled: falta RESEND_API_KEY o EMAIL_FROM. Se omite el envío de correo.');
    return false;
  }

  if (typeof fetch !== 'function') {
    console.error('[email] transport=resend unavailable: fetch no está disponible en este runtime.');
    return false;
  }

  const payload = {
    from: config.from,
    to: [to],
    subject,
    text,
    html
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }

      if (!response.ok) {
        console.error(
          `[email] transport=resend error (intento ${attempt}/2) → to=${to} subject="${subject}" status=${response.status}:`,
          body?.message || body?.error || response.statusText || 'Error desconocido'
        );
      } else {
        console.log(
          `[email] transport=resend sent → to=${to} subject="${subject}" id=${body?.id || '-'}`
        );
        return true;
      }
    } catch (error) {
      clearTimeout(timer);
      console.error(
        `[email] transport=resend error (intento ${attempt}/2) → to=${to} subject="${subject}":`,
        error.name === 'AbortError' ? 'Request timeout' : error.message
      );
    }

    if (attempt < 2) {
      await wait(600);
    }
  }

  return false;
}

export async function sendInternalSaleNotification(order) {
  const to = getInternalNotificationEmail();
  if (!to) {
    console.warn('[email] ORDER_NOTIFICATION_EMAIL/SALES_NOTIFICATION_EMAIL no configurado. Se omite aviso interno.');
    return false;
  }

  console.log(`[email] transport=resend internal queued → order=${order.id} to=${to}`);

  const subject = `[NUEVO PEDIDO] ${order.id}`;
  const text = [
    'Nueva venta recibida',
    '',
    `Pedido: ${order.id}`,
    `Estado: ${order.status}`,
    `Cliente: ${order.customer?.name || '-'}`,
    `Email: ${order.customer?.email || '-'}`,
    `Nombre artístico: ${order.customer?.artistName || '-'}`,
    `Instagram: ${order.customer?.instagram || '-'}`,
    `Notas: ${order.customer?.notes || '-'}`,
    '',
    'Items:',
    ...(order.items || []).map(
      (item) =>
        `- ${item.beatTitleSnapshot} · ${item.licenseType.toUpperCase()} · ${formatEUR(item.unitPriceSnapshot)}`
    ),
    '',
    `Total: ${formatEUR(order.total, order.currency)}`,
    `Checkout session: ${order.stripe?.checkoutSessionId || '-'}`,
    `Payment intent: ${order.stripe?.paymentIntentId || '-'}`
  ].join('\n');

  const html = `
    <h2>Nueva venta en ARIKARA BEATS</h2>
    <p><strong>Pedido:</strong> ${order.id}<br />
    <strong>Estado:</strong> ${order.status}<br />
    <strong>Cliente:</strong> ${order.customer?.name || '-'}<br />
    <strong>Email:</strong> ${order.customer?.email || '-'}<br />
    <strong>Nombre artístico:</strong> ${order.customer?.artistName || '-'}<br />
    <strong>Instagram:</strong> ${order.customer?.instagram || '-'}<br />
    <strong>Notas:</strong> ${order.customer?.notes || '-'}</p>
    <h3>Items</h3>
    <ul>${renderItems(order.items)}</ul>
    <p><strong>Total:</strong> ${formatEUR(order.total, order.currency)}</p>
    <p><strong>Checkout session:</strong> ${order.stripe?.checkoutSessionId || '-'}<br />
    <strong>Payment intent:</strong> ${order.stripe?.paymentIntentId || '-'}</p>
  `;

  return sendMail({ to, subject, text, html });
}

export async function sendCustomerOrderConfirmation(order) {
  const to = order.customer?.email;
  if (!to) {
    console.warn(`[email] Pedido ${order.id} sin email de cliente. Se omite confirmación.`);
    return false;
  }

  console.log(`[email] transport=resend customer queued → order=${order.id} to=${to}`);

  const subject = `Tu compra en ARIKARA BEATS ha sido recibida · ${order.id}`;
  const text = [
    `Hola ${order.customer?.name || ''},`,
    '',
    'Hemos recibido correctamente tu compra en ARIKARA BEATS.',
    'En breve revisaremos el pedido y te enviaremos manualmente a este correo el material correspondiente y la licencia.',
    '',
    'Resumen del pedido:',
    ...(order.items || []).map(
      (item) =>
        `- ${item.beatTitleSnapshot} · ${item.licenseType.toUpperCase()} · ${formatEUR(item.unitPriceSnapshot)}`
    ),
    '',
    `Total: ${formatEUR(order.total, order.currency)}`,
    '',
    'Gracias por confiar en ARIKARA BEATS.'
  ].join('\n');

  const html = `
    <h2>Compra recibida correctamente</h2>
    <p>Hola ${order.customer?.name || ''},</p>
    <p>Hemos recibido correctamente tu compra en <strong>ARIKARA BEATS</strong>.</p>
    <p>En breve revisaremos el pedido y te enviaremos manualmente a este correo el material correspondiente y la licencia.</p>
    <h3>Resumen del pedido</h3>
    <ul>${renderItems(order.items)}</ul>
    <p><strong>Total:</strong> ${formatEUR(order.total, order.currency)}</p>
    <p>Gracias por confiar en ARIKARA BEATS.</p>
  `;

  return sendMail({ to, subject, text, html });
}
