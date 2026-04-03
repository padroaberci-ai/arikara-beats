import nodemailer from 'nodemailer';

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

function createTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user, pass }
    });
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

function getInternalNotificationEmail() {
  return (
    process.env.ORDER_NOTIFICATION_EMAIL ||
    process.env.SALES_NOTIFICATION_EMAIL ||
    process.env.EMAIL_TO ||
    ''
  ).trim();
}

async function sendMail({ to, subject, text, html }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado. Se omite el envío de correo.');
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html
    });
    console.log(
      `[email] Enviado correctamente → to=${to} subject="${subject}" accepted=${(info.accepted || []).join(',') || '-'} rejected=${(info.rejected || []).join(',') || '-'}`
    );
  } catch (error) {
    console.error(`[email] Error enviando correo → to=${to} subject="${subject}":`, error.message);
    return false;
  }

  return true;
}

export async function sendInternalSaleNotification(order) {
  const to = getInternalNotificationEmail();
  if (!to) {
    console.warn('[email] ORDER_NOTIFICATION_EMAIL/SALES_NOTIFICATION_EMAIL no configurado. Se omite aviso interno.');
    return false;
  }

  console.log(`[email] Preparando aviso interno del pedido ${order.id} para ${to}`);

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

  console.log(`[email] Preparando confirmación al cliente del pedido ${order.id} para ${to}`);

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
