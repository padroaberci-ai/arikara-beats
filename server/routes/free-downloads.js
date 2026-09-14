import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBeatByReference } from '../services/catalog.service.js';
import { sendInternalFreeDownloadNotification } from '../services/email.service.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'assets', 'audio');
const CONSENT_VERSION = 'free-download-v1';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const rateBucket = new Map();
const rateSalt = crypto.randomBytes(32).toString('hex');
const generatedTokenSecret = crypto.randomBytes(48).toString('hex');

const hash = (value) => crypto.createHash('sha256').update(`${rateSalt}:${value}`).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value) && value.length <= 254;
const safeSource = (value) => ['catalog', 'product', 'player-sheet', 'seo-listing', 'site'].includes(value) ? value : 'site';
const tokenSecret = () => String(process.env.FREE_DOWNLOADS_TOKEN_SECRET || generatedTokenSecret).trim();
const isDownloadable = (beat) => Boolean(
  beat && beat.status === 'available' && beat.freeDownload !== false && (beat.freeDownloadUrl || beat.preview)
);

const validateFreeDownloadPayload = (body = {}) => {
  const email = normalizeEmail(body.email);
  if (String(body.website || '').trim()) return { status: 400, code: 'INVALID_REQUEST' };
  if (!isEmail(email)) return { status: 400, code: 'INVALID_EMAIL' };
  if (body.downloadConsent !== true || body.consentVersion !== CONSENT_VERSION) {
    return { status: 400, code: 'INVALID_CONSENT' };
  }
  const beatId = String(body.beatId || '').trim();
  if (!/^ab-\d{3}$/i.test(beatId)) return { status: 400, code: 'INVALID_BEAT' };
  return { email, beatId, source: safeSource(body.source) };
};

const rateLimit = (key, limit) => {
  const now = Date.now();
  const previous = (rateBucket.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (previous.length >= limit) {
    rateBucket.set(key, previous);
    return false;
  }
  previous.push(now);
  rateBucket.set(key, previous);
  return true;
};

const makeToken = (beatId) => {
  const payload = Buffer.from(JSON.stringify({ beatId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

const readToken = (token) => {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || !tokenSecret()) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.beatId || !Number.isFinite(parsed.exp) || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const resolveAudioFile = (beat) => {
  const rawPath = String(beat?.freeDownloadUrl || beat?.preview || '');
  if (!rawPath.startsWith('./assets/audio/') || !rawPath.endsWith('.mp3')) return null;
  const file = path.resolve(AUDIO_ROOT, rawPath.replace('./assets/audio/', ''));
  return file.startsWith(`${AUDIO_ROOT}${path.sep}`) ? file : null;
};

const filenameFor = (beat) => `${String(beat.slug || beat.id).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-mp3-con-tag.mp3`;
const noStore = (res) => res.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });

router.post('/', async (req, res) => {
  noStore(res);
  const body = req.body || {};
  const validation = validateFreeDownloadPayload(body);
  if (validation.code) return res.status(validation.status).json({ code: validation.code });
  const { email, beatId, source } = validation;
  const remoteIp = String(req.ip || req.socket?.remoteAddress || 'unknown');

  try {
    const beat = await getBeatByReference(beatId);
    if (!beat) return res.status(404).json({ code: 'BEAT_NOT_FOUND' });
    if (!isDownloadable(beat)) return res.status(409).json({ code: 'BEAT_UNAVAILABLE' });

    const audioFile = resolveAudioFile(beat);
    if (!audioFile) return res.status(409).json({ code: 'DOWNLOAD_UNAVAILABLE' });
    try {
      await fs.access(audioFile);
    } catch {
      return res.status(409).json({ code: 'DOWNLOAD_UNAVAILABLE' });
    }
    if (!rateLimit(`ip:${hash(remoteIp)}`, 12) || !rateLimit(`email:${hash(email)}`, 4)) {
      return res.status(429).json({ code: 'RATE_LIMITED' });
    }

    const download = {
      id: '',
      email,
      beatId: beat.id,
      beatSlug: beat.slug,
      beatTitleSnapshot: beat.title,
      downloadConsentVersion: CONSENT_VERSION,
      source,
      createdAt: new Date().toISOString()
    };
    const sent = await sendInternalFreeDownloadNotification(download);
    if (!sent) {
      return res.status(503).json({ code: 'NOTIFICATION_UNAVAILABLE' });
    }

    return res.json({
      ok: true,
      downloadUrl: `/api/free-downloads/file/${encodeURIComponent(beat.id)}?token=${encodeURIComponent(makeToken(beat.id))}`
    });
  } catch {
    return res.status(503).json({ code: 'STORAGE_UNAVAILABLE' });
  }
});

router.get('/file/:beatId', async (req, res) => {
  noStore(res);
  const token = readToken(req.query.token);
  const beatId = String(req.params.beatId || '').trim();
  if (!token || token.beatId !== beatId) return res.status(403).json({ code: 'DOWNLOAD_NOT_AUTHORIZED' });

  try {
    const beat = await getBeatByReference(beatId);
    if (!isDownloadable(beat)) return res.status(404).json({ code: 'DOWNLOAD_NOT_FOUND' });
    const audioFile = resolveAudioFile(beat);
    if (!audioFile) return res.status(404).json({ code: 'DOWNLOAD_NOT_FOUND' });
    await fs.access(audioFile);
    return res.download(audioFile, filenameFor(beat));
  } catch {
    return res.status(404).json({ code: 'DOWNLOAD_NOT_FOUND' });
  }
});

export { CONSENT_VERSION, isDownloadable, normalizeEmail, resolveAudioFile, validateFreeDownloadPayload };
export default router;
