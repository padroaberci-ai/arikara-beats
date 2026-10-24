import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CLIP_DURATION_SECONDS = 30;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioRoot = path.join(root, 'frontend', 'assets', 'audio');
const catalogSource = await fs.readFile(path.join(root, 'frontend', 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(catalogSource, sandbox, { filename: 'frontend/data.js' });

const readSynchsafeInt = (buffer, offset) => (
  ((buffer[offset] & 0x7f) << 21)
  | ((buffer[offset + 1] & 0x7f) << 14)
  | ((buffer[offset + 2] & 0x7f) << 7)
  | (buffer[offset + 3] & 0x7f)
);

const skipId3v2 = (buffer) => {
  if (buffer.subarray(0, 3).toString('ascii') !== 'ID3' || buffer.length < 10) return 0;
  const size = readSynchsafeInt(buffer, 6);
  return Math.min(buffer.length, 10 + size + ((buffer[5] & 0x10) ? 10 : 0));
};

const frameInfo = (buffer, offset) => {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (buffer[offset + 1] >> 3) & 0x03;
  const layerBits = (buffer[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const version = versionBits === 3 ? 'mpeg1' : versionBits === 2 ? 'mpeg2' : 'mpeg2.5';
  const bitrates = version === 'mpeg1'
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = version === 'mpeg1' ? [44100, 48000, 32000] : version === 'mpeg2' ? [22050, 24000, 16000] : [11025, 12000, 8000];
  const sampleRate = sampleRates[sampleRateIndex];
  const samplesPerFrame = version === 'mpeg1' ? 1152 : 576;
  const frameLength = Math.floor(((version === 'mpeg1' ? 144000 : 72000) * bitrates[bitrateIndex]) / sampleRate) + padding;
  return frameLength > 4 && offset + frameLength <= buffer.length ? { frameLength, samplesPerFrame, sampleRate } : null;
};

const makeClip = async (beat) => {
  const sourceRelative = String(beat.preview || '');
  const targetRelative = String(beat.freeDownloadUrl || '');
  if (!sourceRelative.startsWith('./assets/audio/') || !targetRelative.startsWith('./assets/audio/')) {
    throw new Error(`${beat.id}: rutas de audio no válidas`);
  }
  const source = path.join(audioRoot, sourceRelative.replace('./assets/audio/', ''));
  const target = path.join(audioRoot, targetRelative.replace('./assets/audio/', ''));
  const data = await fs.readFile(source);
  const prefixLength = skipId3v2(data);
  let offset = prefixLength;
  let samples = 0;
  let sampleRate = 0;

  while (offset < data.length) {
    const frame = frameInfo(data, offset);
    if (!frame) throw new Error(`${beat.id}: MP3 no compatible o corrupto en el frame de audio`);
    sampleRate ||= frame.sampleRate;
    if (frame.sampleRate !== sampleRate) throw new Error(`${beat.id}: cambios de sample rate no compatibles`);
    const adjustedTarget = CLIP_DURATION_SECONDS * sampleRate;
    if (samples + frame.samplesPerFrame > adjustedTarget) break;
    samples += frame.samplesPerFrame;
    offset += frame.frameLength;
  }
  if (samples === 0) throw new Error(`${beat.id}: no se pudo extraer un clip de audio`);
  await fs.writeFile(target, data.subarray(0, offset));
  return { target: path.basename(target), seconds: samples / sampleRate };
};

const beats = sandbox.window.ARIKARA?.beats || [];
const downloadable = beats.filter((beat) => beat.status === 'available' && beat.freeDownload !== false);
for (const beat of downloadable) {
  const result = await makeClip(beat);
  console.log(`${beat.id} ${result.target} ${result.seconds.toFixed(3)}s`);
}
