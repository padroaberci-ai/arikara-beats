import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const generator = path.join(root, 'scripts', 'generate-seo-pages.mjs');
const catalog = path.join(frontend, 'data.js');
const issues = [];

const walkHtml = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walkHtml(target) : (entry.name.endsWith('.html') ? [target] : []);
});

const assertNoMatch = (file, pattern, message) => {
  const source = fs.readFileSync(file, 'utf8');
  if(pattern.test(source)) issues.push(`${path.relative(root, file)}: ${message}`);
};

const htmlFiles = walkHtml(frontend);
for(const file of htmlFiles){
  assertNoMatch(file, /player-timeline|player-right/, 'usa markup legado del reproductor');
  assertNoMatch(file, /class="player-volume"\s+type="range"/, 'usa el control de volumen legado');
  assertNoMatch(file, /cdn-cgi\/l\/email-protection/, 'contiene un enlace de email protegido roto');
  assertNoMatch(file, /Hasta 100K|Hasta 500K|Streams ilimitados|Full rights/i, 'incluye condiciones de licencia no confirmadas');
}

assertNoMatch(generator, /player-timeline|player-right/, 'genera markup legado del reproductor');
assertNoMatch(generator, /class="player-volume"\s+type="range"/, 'genera el control de volumen legado');
assertNoMatch(catalog, /Hasta 100K|Hasta 500K|Streams ilimitados|Full rights/i, 'conserva condiciones de licencia no confirmadas');

if(issues.length){
  console.error('Validacion frontend fallida:\n' + issues.map((issue) => `- ${issue}`).join('\n'));
  process.exit(1);
}

console.log(`Validacion frontend correcta: ${htmlFiles.length} paginas HTML y el generador usan el markup actual.`);
