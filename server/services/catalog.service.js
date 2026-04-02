import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DATA_PATH = path.join(__dirname, '..', '..', 'frontend', 'data.js');

let cache = {
  mtimeMs: 0,
  catalog: null
};

const clone = (value) => JSON.parse(JSON.stringify(value));

async function loadCatalogFromFrontend() {
  const stats = await fs.stat(FRONTEND_DATA_PATH);
  if (cache.catalog && cache.mtimeMs === stats.mtimeMs) {
    return clone(cache.catalog);
  }

  const source = await fs.readFile(FRONTEND_DATA_PATH, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: FRONTEND_DATA_PATH });

  if (!sandbox.window?.ARIKARA?.beats || !sandbox.window?.ARIKARA?.licenses) {
    throw new Error('No se pudo cargar el catálogo canónico desde frontend/data.js');
  }

  cache = {
    mtimeMs: stats.mtimeMs,
    catalog: sandbox.window.ARIKARA
  };

  return clone(cache.catalog);
}

export async function getCatalog() {
  return loadCatalogFromFrontend();
}

export async function getBeatByReference(reference) {
  const catalog = await getCatalog();
  return catalog.beats.find((beat) => beat.id === reference || beat.slug === reference) || null;
}

export async function getLicenseById(id) {
  const catalog = await getCatalog();
  return catalog.licenses.find((license) => license.id === id) || null;
}

export function isBeatPurchasable(beat) {
  return Boolean(beat) && beat.status === 'available';
}

export function isLicensePurchasable(license) {
  return Boolean(license) && license.id !== 'exclusive' && !license.disabled;
}
