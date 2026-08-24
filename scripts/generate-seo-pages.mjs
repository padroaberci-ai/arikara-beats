import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const frontendDir = path.join(root, 'frontend');
const siteUrl = 'https://arikarabeats.com';
const dataCode = fs.readFileSync(path.join(frontendDir, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataCode, sandbox);
const data = sandbox.window.ARIKARA || { beats: [], licenses: [] };
const beats = [...(data.beats || [])];
const licenses = data.licenses || [];

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));
const slugify = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' y ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
const stripAsset = (value = '') => String(value).replace(/^\.\//, '');
const relAsset = (value, prefix = '../../') => `${prefix}${stripAsset(value || './assets/placeholder.svg')}`;
const absAsset = (value) => `${siteUrl}/${stripAsset(value || './assets/placeholder.svg')}`;
const beatHref = (beat, prefix = '../../') => `${prefix}beats/${beat.slug}/`;
const genreHref = (genre, prefix = '../../') => `${prefix}generos/${slugify(genre)}/`;
const artistHref = (artist, prefix = '../../') => `${prefix}type-beats/${slugify(artist)}/`;
const fmtEUR = (value) => Number(value || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const titleParts = (title = '') => {
  const normalized = String(title).replace(/–/g, '-').trim();
  const [beforeType] = normalized.split(/type beat/i);
  const artist = (beforeType || normalized.split(' - ')[0] || 'ARIKARA').replace(/[-–]+$/g, '').trim();
  const quote = normalized.match(/["“”](.*?)["“”]/);
  const song = quote?.[1] || normalized.split(' - ').slice(1).join(' - ').replace(/^['"“”]+|['"“”]+$/g, '').trim();
  return { artist: artist || 'ARIKARA', song: song || normalized };
};
const latestFirst = (items) => [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
const uniqueBy = (items, getKey) => {
  const map = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if(key && !map.has(key)) map.set(key, item);
  });
  return [...map.values()];
};
const cleanDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.trimStart() + '\n');
};
const jsonLd = (value) => `<script type="application/ld+json" data-seo>${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;

const header = (prefix = '../../') => `
<header class="header">
  <div class="container header__inner">
    <div class="header-left">
      <a class="btn btn--ghost btn--sm header-contact" href="mailto:arikarabeats@gmail.com?subject=Contacto%20directo%20-%20ARIKARA%20BEATS">Contacto directo</a>
    </div>
    <a class="logo" href="${prefix}index.html" aria-label="ARIKARA BEATS">
      <img class="logo-image" src="${prefix}assets/logo-white.png" alt="ARIKARA BEATS" />
      <span class="sr-only">ARIKARA BEATS</span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a class="nav-link" href="${prefix}index.html">Beats</a>
      <a class="nav-link" href="${prefix}licencias.html">Licencias</a>
      <a class="btn btn--ghost btn--sm" href="${prefix}cart.html">Carrito <span id="cartBadge" class="badge badge--accent hidden" style="margin-left:6px;">0</span></a>
    </nav>
  </div>
</header>`;
const footer = () => `
<footer class="footer">
  <div class="container footer__inner">
    <div>
      <div style="font-weight:700;">ARIKARA BEATS</div>
      <p>Beats premium, licencias transparentes y entrega manual por email.</p>
      <div>(c) <span data-year></span> ARIKARA BEATS</div>
    </div>
    <div>
      <div style="font-weight:700;">Contacto</div>
      <div>arikarabeats@gmail.com</div>
      <div>@arikarastudios</div>
    </div>
  </div>
</footer>`;
const player = (prefix = '../../') => `
<div class="player">
  <div class="container player__inner">
    <div class="player-left">
      <div class="player-cover card" id="playerCover">
        <img id="playerCoverImg" src="${prefix}assets/placeholder.svg" alt="" />
        <button class="cover-play cover-play--player" id="playerCoverPlay" type="button" aria-label="Play/Pause"><span class="cover-play__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span></button>
      </div>
      <div class="player-info">
        <div class="player-title-row"><div class="player-title" id="playerTitle">Nada reproduciendo</div><span class="wave player-wave" aria-hidden="true"><span></span><span></span><span></span></span></div>
        <div class="player-subtitle" id="playerSubtitle"></div>
        <div class="player-meta" id="playerMeta">Reproduce un beat para escuchar la vista previa</div>
      </div>
    </div>
    <div class="player-center">
      <div class="player-timeline"><span id="playerTime">0:00</span><input id="playerSeek" class="player-seek" type="range" min="0" max="100" value="0" /><span id="playerDuration">0:00</span></div>
      <div class="player-buttons">
        <button class="icon-btn" id="playerShuffle" type="button" aria-label="Reproducción aleatoria" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l10 10h3M17 7h3v3M20 7l-4 4M4 17h3l3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn" id="playerPrev" type="button" aria-label="Anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6l-8 6 8 6V6zM8 6H6v12h2V6z" fill="currentColor"/></svg></button>
        <button class="icon-btn icon-btn--accent icon-btn--main" id="playerToggle" type="button" aria-label="Play/Pause"><svg id="playerToggleIcon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></button>
        <button class="icon-btn" id="playerNext" type="button" aria-label="Siguiente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l8 6-8 6V6zm10 0h2v12h-2V6z" fill="currentColor"/></svg></button>
        <button class="icon-btn" id="playerLoop" type="button" aria-label="Repetir beat" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 17H7a4 4 0 0 1 0-8h11M15 20l3-3-3-3M7 7h10a4 4 0 1 1 0 8H6M9 4L6 7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>
    <div class="player-right"><div class="volume-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z" fill="currentColor"/></svg><input id="playerVolume" class="player-volume" type="range" min="0" max="1" step="0.01" value="0.8" /></div></div>
  </div>
</div>`;

const head = ({ title, description, canonical, image, prefix = '../../', robots = '' }) => `
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  ${robots ? `<meta name="robots" content="${escapeHtml(robots)}" />` : ''}
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${image}" />
  <link rel="icon" type="image/png" href="${prefix}assets/favicon.png" />
  <link rel="apple-touch-icon" href="${prefix}assets/favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Spectral:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${prefix}style.css" />
  <script src="${prefix}data.js" defer></script>
  <script src="${prefix}app.js" defer></script>
</head>`;

const trustStrip = `
<div class="trust-strip" aria-label="Confianza">
  <span>Pago seguro con Stripe</span>
  <span>Entrega manual por email</span>
  <span>Licencias claras</span>
  <span>Contacto directo</span>
</div>`;

const licensePreview = () => licenses.map((license) => {
  const priceLabel = license.priceLabel || fmtEUR(license.price);
  const flag = license.highlight ? '<div class="license-flag">Licencia recomendada</div>' : '';
  return `<article class="license-card license-card--compact${license.highlight ? ' highlight' : ''}"><div class="license-title">${escapeHtml(license.name)}</div><div class="license-price">${escapeHtml(priceLabel)}</div><div class="license-list">${(license.includes || []).slice(0, 4).map((item) => `<div>- ${escapeHtml(item)}</div>`).join('')}</div>${flag}</article>`;
}).join('');

const beatCard = (beat, prefix = '../../') => {
  const status = beat.status === 'sold' ? 'Vendido' : beat.status === 'available' ? 'Disponible' : 'No disponible';
  const statusClass = beat.status === 'sold' ? 'badge--status-sold' : beat.status === 'available' ? 'badge--status-available' : 'badge--status-unavailable';
  return `<article class="seo-card ${beat.status !== 'available' ? 'is-unavailable' : ''}">
    <a class="seo-card__media" href="${beatHref(beat, prefix)}"><img src="${relAsset(beat.cover, prefix)}" alt="Cover ${escapeHtml(beat.title)}" loading="lazy" /></a>
    <div class="seo-card__body">
      <span class="badge ${statusClass}">${status}</span>
      <h3><a href="${beatHref(beat, prefix)}">${escapeHtml(beat.title)}</a></h3>
      <p>${escapeHtml(beat.genre)} · ${beat.bpm} BPM · ${escapeHtml(beat.key)}</p>
      <a class="btn btn--primary btn--sm" href="${beatHref(beat, prefix)}">Ver licencias</a>
    </div>
  </article>`;
};

cleanDir(path.join(frontendDir, 'beats'));
cleanDir(path.join(frontendDir, 'type-beats'));
cleanDir(path.join(frontendDir, 'generos'));

for (const beat of beats) {
  const parts = titleParts(beat.title);
  const canonical = `${siteUrl}/beats/${beat.slug}/`;
  const description = `${beat.title}: ${beat.genre}, ${beat.bpm} BPM, ${beat.key}. Escucha preview y compra licencia Basic o Premium con pago seguro Stripe. Entrega manual por email.`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'MusicRecording',
        '@id': `${canonical}#music`,
        name: beat.title,
        byArtist: { '@type': 'MusicGroup', name: 'ARIKARA BEATS' },
        genre: beat.genre,
        image: absAsset(beat.cover),
        url: canonical,
        duration: beat.duration || undefined
      },
      {
        '@type': 'Product',
        '@id': `${canonical}#product`,
        name: beat.title,
        image: absAsset(beat.cover),
        description,
        brand: { '@type': 'Brand', name: 'ARIKARA BEATS' },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'EUR',
          price: beat.prices?.basic || 29.99,
          availability: beat.status === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          url: canonical
        }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Beats', item: siteUrl },
          { '@type': 'ListItem', position: 2, name: beat.genre, item: `${siteUrl}/generos/${slugify(beat.genre)}/` },
          { '@type': 'ListItem', position: 3, name: beat.title, item: canonical }
        ]
      }
    ].filter(Boolean)
  };
  write(path.join(frontendDir, 'beats', beat.slug, 'index.html'), `<!doctype html>
<html lang="es">
${head({ title: `${beat.title} | ${beat.genre} | ARIKARA BEATS`, description, canonical, image: absAsset(beat.cover) })}
<body data-page="beat" data-beat-slug="${escapeHtml(beat.slug)}">
${header('../../')}
<main class="main">
  <section class="section section--tight">
    <div class="container breadcrumb"><a href="../../index.html">Beats</a><span>/</span><a href="${genreHref(beat.genre)}">${escapeHtml(beat.genre)}</a><span>/</span><span>${escapeHtml(parts.song)}</span></div>
  </section>
  <section class="section">
    <div class="container beat-layout">
      <div class="card beat-hero">
        <div class="beat-hero__media">
          <img id="coverImg" src="${relAsset(beat.cover)}" alt="Cover ${escapeHtml(beat.title)}" />
          <div class="beat-hero__overlay">
            <div class="eyebrow">Beat</div>
            <h1 id="beatTitle">${escapeHtml(beat.title)}</h1>
            <p id="beatMeta" class="beat-hero__meta">${beat.bpm} BPM - ${escapeHtml(beat.key)} - ${escapeHtml(beat.genre)}</p>
            <div id="tagRow" class="beat-tags">${[...(beat.tags || []), ...(beat.moods || [])].map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="beat-hero__actions">
          <button id="previewBtn" class="btn btn--primary btn--preview" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"></svg>Reproducir preview</button>
        </div>
      </div>
      <div class="card license-panel">
        <h2>Licencia para ${escapeHtml(parts.song)}</h2>
        <p class="lead">Selecciona la licencia que necesitas para tu lanzamiento. El material y la licencia se envían manualmente por email tras confirmar el pago.</p>
        ${trustStrip}
        <div id="licenseOptions" class="license-grid license-grid--beat" style="margin-top:16px;">${licensePreview()}</div>
        <div style="margin-top:18px;display:grid;gap:10px;"><button id="addToCartBtn" class="btn btn--primary" type="button">Añadir</button><a class="btn btn--ghost" href="../../cart.html">Ir al carrito</a></div>
      </div>
    </div>
  </section>
  <section class="section"><div class="container seo-links"><h2>También encaja con</h2><a href="${artistHref(parts.artist)}">${escapeHtml(parts.artist)} type beats</a><a href="${genreHref(beat.genre)}">${escapeHtml(beat.genre)} beats</a><a href="../../licencias.html">Comparar licencias</a><a href="mailto:arikarabeats@gmail.com?subject=${encodeURIComponent(`Consulta ${beat.title}`)}">Contacto directo</a></div></section>
</main>
${footer()}
${player('../../')}
${jsonLd(graph)}
</body>
</html>`);
}

const artistGroups = new Map();
for (const beat of beats) {
  const artist = titleParts(beat.title).artist;
  const key = slugify(artist);
  if(!artistGroups.has(key)) artistGroups.set(key, { artist, beats: [] });
  artistGroups.get(key).beats.push(beat);
}
for (const [artistSlug, group] of artistGroups) {
  const items = latestFirst(group.beats);
  const canonical = `${siteUrl}/type-beats/${artistSlug}/`;
  const description = `${group.artist} type beats de ARIKARA BEATS: instrumentales urbanas con guitarras españolas, licencias claras y pago seguro Stripe.`;
  write(path.join(frontendDir, 'type-beats', artistSlug, 'index.html'), `<!doctype html>
<html lang="es">
${head({ title: `${group.artist} Type Beats | ARIKARA BEATS`, description, canonical, image: absAsset(items[0]?.cover) })}
<body data-page="seo-listing">
${header('../../')}
<main class="main"><section class="section"><div class="container seo-hero"><div class="eyebrow">Type beats</div><h1>${escapeHtml(group.artist)} Type Beats</h1><p class="lead">Instrumentales con identidad urbana, guitarras españolas y licencias listas para tu próximo release.</p>${trustStrip}</div></section><section class="section"><div class="container seo-grid">${items.map((beat) => beatCard(beat)).join('')}</div></section></main>
${footer()}
${player('../../')}
${jsonLd({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${group.artist} Type Beats`, url: canonical, hasPart: items.map((beat) => ({ '@type': 'MusicRecording', name: beat.title, url: `${siteUrl}/beats/${beat.slug}/` })) })}
</body></html>`);
}

const genreGroups = new Map();
for (const beat of beats) {
  const genre = String(beat.genre || '').trim();
  if(!genre) continue;
  const key = slugify(genre);
  if(!genreGroups.has(key)) genreGroups.set(key, { genre, beats: [] });
  genreGroups.get(key).beats.push(beat);
}
for (const [genreSlug, group] of genreGroups) {
  const items = latestFirst(group.beats);
  const canonical = `${siteUrl}/generos/${genreSlug}/`;
  const description = `${group.genre} beats de ARIKARA BEATS: previews, BPM, tonalidad y licencias claras con entrega manual por email.`;
  write(path.join(frontendDir, 'generos', genreSlug, 'index.html'), `<!doctype html>
<html lang="es">
${head({ title: `${group.genre} Beats | ARIKARA BEATS`, description, canonical, image: absAsset(items[0]?.cover) })}
<body data-page="seo-listing">
${header('../../')}
<main class="main"><section class="section"><div class="container seo-hero"><div class="eyebrow">Género</div><h1>${escapeHtml(group.genre)} Beats</h1><p class="lead">Catálogo curado por género con BPM claros, tono y licencias listas para publicar.</p>${trustStrip}</div></section><section class="section"><div class="container seo-grid">${items.map((beat) => beatCard(beat)).join('')}</div></section></main>
${footer()}
${player('../../')}
${jsonLd({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${group.genre} Beats`, url: canonical, hasPart: items.map((beat) => ({ '@type': 'MusicRecording', name: beat.title, url: `${siteUrl}/beats/${beat.slug}/` })) })}
</body></html>`);
}

const sitemapUrls = [
  { loc: siteUrl + '/', priority: '1.0' },
  { loc: siteUrl + '/licencias.html', priority: '0.8' },
  ...beats.map((beat) => ({ loc: `${siteUrl}/beats/${beat.slug}/`, lastmod: beat.createdAt ? new Date(beat.createdAt).toISOString().slice(0, 10) : undefined, priority: '0.9' })),
  ...[...artistGroups.keys()].map((slug) => ({ loc: `${siteUrl}/type-beats/${slug}/`, priority: '0.7' })),
  ...[...genreGroups.keys()].map((slug) => ({ loc: `${siteUrl}/generos/${slug}/`, priority: '0.7' }))
];
write(path.join(frontendDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((entry) => `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}<priority>${entry.priority}</priority></url>`).join('\n')}
</urlset>`);
write(path.join(frontendDir, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /success.html
Disallow: /cancel.html
Sitemap: ${siteUrl}/sitemap.xml`);
write(path.join(frontendDir, '_redirects'), `/beats/:slug /beats/:slug/index.html 200
/type-beats/:slug /type-beats/:slug/index.html 200
/generos/:slug /generos/:slug/index.html 200`);

console.log(`[seo] Generated ${beats.length} beat pages, ${artistGroups.size} artist pages and ${genreGroups.size} genre pages.`);
