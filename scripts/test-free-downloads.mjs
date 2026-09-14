import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  CONSENT_VERSION,
  isDownloadable,
  normalizeEmail,
  resolveAudioFile,
  validateFreeDownloadPayload
} from '../server/routes/free-downloads.js';
import { sendInternalFreeDownloadNotification } from '../server/services/email.service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const source = await fs.readFile(path.join(frontend, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const beats = sandbox.window.ARIKARA.beats;
const available = beats.find((beat) => beat.status === 'available' && beat.preview);
const sold = beats.find((beat) => beat.status === 'sold');

assert.ok(available, 'Debe existir al menos un beat disponible con preview para la prueba.');
assert.ok(sold, 'Debe existir al menos un beat vendido para la prueba.');
assert.equal(normalizeEmail('  ARTIST@Example.COM '), 'artist@example.com');
assert.equal(isDownloadable(available), true);
assert.equal(isDownloadable(sold), false);
assert.equal(isDownloadable({ ...available, freeDownload: false }), false);
assert.equal(validateFreeDownloadPayload({}).code, 'INVALID_EMAIL');
assert.equal(validateFreeDownloadPayload({ email: 'invalid' }).code, 'INVALID_EMAIL');
assert.equal(validateFreeDownloadPayload({ email: 'artist@example.test', beatId: available.id }).code, 'INVALID_CONSENT');
assert.deepEqual(
  validateFreeDownloadPayload({
    email: ' ARTIST@Example.test ',
    beatId: available.id,
    downloadConsent: true,
    consentVersion: CONSENT_VERSION,
    source: 'product'
  }),
  { email: 'artist@example.test', beatId: available.id, source: 'product' }
);

const previewFile = resolveAudioFile(available);
assert.ok(previewFile?.endsWith('.mp3'), 'La descarga debe resolver un MP3 con tag.');
await fs.access(previewFile);
assert.equal(resolveAudioFile({ preview: '../../server/data/orders.json' }), null);
assert.equal(resolveAudioFile({ preview: './assets/audio/../../server/data/orders.json' }), null);
assert.equal(resolveAudioFile({ preview: './assets/audio/not-an-mp3.wav' }), null);

const productHtml = await fs.readFile(path.join(frontend, 'beats', available.slug, 'index.html'), 'utf8');
const soldHtml = await fs.readFile(path.join(frontend, 'beats', sold.slug, 'index.html'), 'utf8');
const listingHtml = await fs.readFile(path.join(frontend, 'type-beats', 'maka', 'index.html'), 'utf8');
const appSource = await fs.readFile(path.join(frontend, 'app.js'), 'utf8');
const routeSource = await fs.readFile(path.join(root, 'server', 'routes', 'free-downloads.js'), 'utf8');
assert.match(productHtml, /id="freeDownloadBtn"/);
assert.match(listingHtml, /data-free-download/);
assert.doesNotMatch(soldHtml, /data-free-download/);
const analyticsPayloads = Array.from(appSource.matchAll(/trackEvent\('(free_download_[^']+)',\s*\{([^}]*)\}\)/g));
assert.deepEqual(analyticsPayloads.map((match) => match[1]), [
  'free_download_open',
  'free_download_submit',
  'free_download_success',
  'free_download_error'
]);
analyticsPayloads.forEach((match) => assert.doesNotMatch(match[2], /email/i));
assert.doesNotMatch(routeSource, /free-download-storage|writeFile|server\/data/);
assert.doesNotMatch(routeSource, /marketingConsent/);
assert.doesNotMatch(appSource, /marketingConsent/);

const previousFetch = globalThis.fetch;
const previousResendKey = process.env.RESEND_API_KEY;
const previousEmailFrom = process.env.EMAIL_FROM;
let mailPayload = null;
process.env.RESEND_API_KEY = 'simulated-resend-key';
process.env.EMAIL_FROM = 'ARIKARA BEATS <no-reply@example.test>';
globalThis.fetch = async (_url, options) => {
  mailPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({ id: 'simulated-message' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

try {
  const sent = await sendInternalFreeDownloadNotification({
    id: 'FD-000001',
    beatId: 'ab-999',
    beatTitleSnapshot: 'Prueba <con tag>',
    email: 'artist@example.test',
    downloadConsentVersion: 'free-download-v1',
    source: 'product',
    createdAt: '2026-09-14T12:00:00.000Z'
  });
  assert.equal(sent, true);
  assert.deepEqual(mailPayload.to, ['arikarabeats@gmail.com']);
  assert.match(mailPayload.subject, /DESCARGA GRATIS/);
  assert.match(mailPayload.text, /ab-999/);
  assert.match(mailPayload.text, /artist@example\.test/);
  assert.match(mailPayload.text, /Versión del consentimiento: free-download-v1/);
  assert.match(mailPayload.text, /Origen: product/);
  assert.match(mailPayload.text, /2026-09-14T12:00:00.000Z/);
  assert.match(mailPayload.html, /Prueba &lt;con tag&gt;/);
  assert.doesNotMatch(mailPayload.html, /Prueba <con tag>/);
  assert.doesNotMatch(mailPayload.text, /newsletter|comercial|ofertas/i);
  assert.doesNotMatch(mailPayload.html, /newsletter|comercial|ofertas/i);
} finally {
  globalThis.fetch = previousFetch;
  if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResendKey;
  if (previousEmailFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = previousEmailFrom;
}

console.log('Validacion de descargas gratuitas correcta: catálogo, resolución segura, markup generado y aviso interno simulado verificados.');
