(function(){
  const state = window.ARIKARA || { beats: [], licenses: [], services: [], genres: [] };
  const STORAGE_KEY = 'arikara_cart_v2';
  const LAST_ORDER_KEY = 'arikara_last_order_v1';
  const PLAYER_STATE_KEY = 'arikara_player_state_v1';
  const PLAYER_SESSION_KEY = 'arikara_player_session_v1';
  const PLAYER_HIDDEN_KEY = 'arikara_player_hidden_v1';
  const PLAYER_VOLUME_KEY = 'arikara_player_volume_v1';
  const PLAYER_PREFS_KEY = 'arikara_player_prefs_v1';
  const API_BASE = (() => {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return window.ARIKARA_API_BASE || (isLocal ? '' : 'https://arikara-beats-api.onrender.com');
  })();

  const qs = (sel, scope=document) => scope.querySelector(sel);
  const qsa = (sel, scope=document) => Array.from(scope.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const apiUrl = (path) => `${API_BASE}${path}`;
  const isCompactViewport = () => window.matchMedia('(max-width: 980px)').matches;
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const fetchWithTimeout = (resource, options = {}, timeoutMs = 12000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    return fetch(resource, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
  };
  const withRetry = async (task, retries = 0, baseDelay = 1200) => {
    let lastError;
    for(let attempt = 0; attempt <= retries; attempt += 1){
      try{
        return await task();
      }catch(err){
        lastError = err;
        if(attempt === retries) break;
        await wait(baseDelay * (attempt + 1));
      }
    }
    throw lastError;
  };

  const fmtEUR = (n) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const roundMoney = (value) => Number((Math.round(Number(value || 0) * 100) / 100).toFixed(2));
  const compareCartDiscountOrder = (a, b, indexA = 0, indexB = 0) => {
    const priceDiff = Number(b.price || 0) - Number(a.price || 0);
    if(priceDiff !== 0) return priceDiff;
    const refA = String(a.slug || a.beatId || a.title || indexA).toLowerCase();
    const refB = String(b.slug || b.beatId || b.title || indexB).toLowerCase();
    const refDiff = refA.localeCompare(refB);
    if(refDiff !== 0) return refDiff;
    return indexA - indexB;
  };
  const getCartPricing = (cart = []) => {
    const items = cart.map((item, index) => ({
      ...item,
      qty: Math.max(1, Number(item.qty || 1)),
      basePrice: roundMoney(item.price || 0),
      finalPrice: roundMoney(item.price || 0),
      discountAmount: 0,
      _index: index
    }));

    const ranked = [...items].sort((a, b) => compareCartDiscountOrder(a, b, a._index, b._index));
    ranked.slice(1).forEach((item) => {
      item.discountAmount = roundMoney(item.basePrice * 0.25);
      item.finalPrice = roundMoney(item.basePrice - item.discountAmount);
    });

    const ordered = ranked
      .sort((a, b) => a._index - b._index)
      .map(({ _index, ...item }) => item);

    const subtotal = roundMoney(ordered.reduce((sum, item) => sum + item.basePrice * item.qty, 0));
    const discount = roundMoney(ordered.reduce((sum, item) => sum + item.discountAmount * item.qty, 0));
    const total = roundMoney(ordered.reduce((sum, item) => sum + item.finalPrice * item.qty, 0));

    return { items: ordered, subtotal, discount, total };
  };
  const customerOrderStatus = (order) => {
    if(!order) return 'Pedido recibido';
    if(order.status === 'paid_pending_delivery') return 'Pago confirmado';
    return 'Pago recibido';
  };

  const sanitizeCartItems = (rawCart) => {
    if(!Array.isArray(rawCart)) return [];

    const beatsById = new Map(state.beats.map((beat) => [String(beat.id || ''), beat]));
    const beatsBySlug = new Map(state.beats.map((beat) => [String(beat.slug || ''), beat]));
    const validLicenses = new Set(
      (state.licenses || [])
        .filter((license) => license && license.id !== 'exclusive' && !license.disabled)
        .map((license) => String(license.id || '').toLowerCase())
    );
    const normalized = new Map();

    rawCart.forEach((entry) => {
      if(!entry || typeof entry !== 'object') return;

      const rawBeatId = String(entry.beatId || '').trim();
      const rawSlug = String(entry.slug || '').trim();
      const beat = beatsById.get(rawBeatId) || beatsBySlug.get(rawSlug);
      if(!beat || beat.status !== 'available') return;

      const license = String(entry.license || '').trim().toLowerCase();
      if(!validLicenses.has(license)) return;

      const price = Number(beat.prices?.[license]);
      if(!Number.isFinite(price) || price <= 0) return;

      normalized.set(beat.id, {
        beatId: beat.id,
        slug: beat.slug,
        title: beat.title,
        license,
        price,
        qty: 1
      });
    });

    return Array.from(normalized.values());
  };

  const loadCart = () => {
    try{
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      const sanitized = sanitizeCartItems(raw);
      if(JSON.stringify(raw) !== JSON.stringify(sanitized)){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    }catch{
      try{ localStorage.removeItem(STORAGE_KEY); }catch{}
      return [];
    }
  };
  const saveCart = (cart) => localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeCartItems(cart)));
  const saveLastOrderId = (orderId) => {
    try {
      if (orderId) localStorage.setItem(LAST_ORDER_KEY, orderId);
    } catch {}
  };

  const Cart = {
    get: () => loadCart(),
    add: (item) => {
      const cart = loadCart().filter((entry) => entry.beatId !== item.beatId);
      cart.push({ ...item, qty: 1 });
      saveCart(cart);
      document.dispatchEvent(new Event('cart:update'));
    },
    remove: (idx) => {
      const cart = loadCart();
      cart.splice(idx, 1);
      saveCart(cart);
      document.dispatchEvent(new Event('cart:update'));
    },
    clear: () => {
      saveCart([]);
      document.dispatchEvent(new Event('cart:update'));
    },
    total: () => getCartPricing(loadCart()).total
  };

  const syncYear = () => {
    const year = new Date().getFullYear();
    qsa('[data-year]').forEach(el => el.textContent = year);
  };
  const updateBadge = () => {
    const badge = qs('#cartBadge');
    if(!badge) return;
    const count = loadCart().length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  };
  const syncShellUi = () => {
    syncYear();
    updateBadge();
  };
  syncShellUi();
  document.addEventListener('cart:update', updateBadge);

  // Player
  const audio = new Audio();
  audio.preload = 'metadata';
  let current = null;
  let currentBeatIndex = -1;
  let playing = false;
  let pendingResume = false;
  let pendingSeek = null;
  let lastSavedSecond = -1;

  const playerTitle = qs('#playerTitle');
  const playerSubtitle = qs('#playerSubtitle');
  const playerMeta = qs('#playerMeta');
  const playerCoverImg = qs('#playerCoverImg');
  const playerCoverPlay = qs('#playerCoverPlay');
  const playerRoot = qs('.player');
  const playerTime = qs('#playerTime');
  const playerDuration = qs('#playerDuration');
  const playerSeek = qs('#playerSeek');
  const playerToggle = qs('#playerToggle');
  const playerToggleIcon = qs('#playerToggleIcon');
  const playerShuffle = qs('#playerShuffle');
  const playerPrev = qs('#playerPrev');
  const playerNext = qs('#playerNext');
  const playerLoop = qs('#playerLoop');
  const playerVolume = qs('#playerVolume');

  let previewButton = null;
  let previewButtonTarget = null;
  let pageCleanups = [];
  let pageRequestToken = 0;
  let navigationInFlight = null;
  let loopEnabled = false;
  let shuffleEnabled = false;
  let playerSheetOpen = false;
  let playerDismissed = false;

  const PLAY_ICON = '<polygon points="8,5 19,12 8,19" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  const PAUSE_ICON = '<line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const CART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2l2.1 9.2a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.77L20 8H7.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="19" r="1.4" fill="currentColor"/><circle cx="17" cy="19" r="1.4" fill="currentColor"/></svg>';
  const CHEVRON_DOWN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHEVRON_UP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const COVER_PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PLAY_ICON + '</svg>';
  const COVER_PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PAUSE_ICON + '</svg>';
  const COVER_NO_SVG = '<span>!</span>';

  if(playerRoot){
    document.body.insertAdjacentHTML('beforeend', `
      <div class="player-mobile" id="playerMobile" aria-hidden="true">
        <button class="player-mobile__surface" id="playerMobileOpen" type="button" aria-label="Abrir reproductor">
          <div class="player-mobile__cover">
            <img id="playerMobileCover" src="./assets/placeholder.svg" alt="" />
          </div>
          <div class="player-mobile__copy">
            <div class="player-mobile__title-row">
              <div class="player-mobile__title" id="playerMobileTitle">Nada reproduciendo</div>
              <span class="wave player-wave player-wave--mobile" aria-hidden="true"><span></span><span></span><span></span></span>
            </div>
            <div class="player-mobile__meta" id="playerMobileMeta">Reproduce un beat para escuchar la vista previa</div>
          </div>
        </button>
        <button class="player-mobile__toggle" id="playerMobileToggle" type="button" aria-label="Play/Pause">
          <span class="player-mobile__toggle-icon" id="playerMobileToggleIcon">
            <svg viewBox="0 0 24 24" aria-hidden="true">${PLAY_ICON}</svg>
          </span>
        </button>
        <button class="player-mobile__dismiss" id="playerMobileDismiss" type="button" aria-label="Cerrar reproductor">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="player-sheet" id="playerSheet" aria-hidden="true">
        <div class="player-sheet__backdrop" id="playerSheetBackdrop"></div>
        <div class="player-sheet__panel" role="dialog" aria-modal="true" aria-label="Reproductor">
          <div class="player-sheet__bg">
            <img id="playerSheetBg" src="./assets/placeholder.svg" alt="" />
          </div>
          <div class="player-sheet__scrim"></div>
          <div class="player-sheet__header">
            <button class="player-sheet__close" id="playerSheetClose" type="button" aria-label="Cerrar reproductor">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="player-sheet__brand">ARIKARA BEATS</div>
            <button class="player-sheet__cart" id="playerSheetCart" type="button" aria-label="Ver licencias del beat">
              ${CART_ICON}
            </button>
          </div>
          <div class="player-sheet__body">
            <div class="player-sheet__artwork">
              <img id="playerSheetCover" src="./assets/placeholder.svg" alt="" />
            </div>
            <div class="player-sheet__title" id="playerSheetTitle">Nada reproduciendo</div>
            <div class="player-sheet__meta" id="playerSheetMeta">Reproduce un beat para escuchar la vista previa</div>
            <div class="player-sheet__progress">
              <input id="playerSheetSeek" class="player-seek player-sheet__seek" type="range" min="0" max="100" value="0" />
              <div class="player-sheet__times">
                <span id="playerSheetTime">0:00</span>
                <span id="playerSheetDuration">0:00</span>
              </div>
            </div>
            <div class="player-sheet__controls">
              <button class="icon-btn" id="playerSheetShuffle" type="button" aria-label="Reproducción aleatoria" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h3l10 10h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M17 7h3v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M20 7l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M4 17h3l3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="icon-btn" id="playerSheetPrev" type="button" aria-label="Anterior">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6l-8 6 8 6V6zM8 6H6v12h2V6z" fill="currentColor"/>
                </svg>
              </button>
              <button class="icon-btn icon-btn--accent icon-btn--main" id="playerSheetToggle" type="button" aria-label="Play/Pause">
                <svg id="playerSheetToggleIcon" viewBox="0 0 24 24" aria-hidden="true">${PLAY_ICON}</svg>
              </button>
              <button class="icon-btn" id="playerSheetNext" type="button" aria-label="Siguiente">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l8 6-8 6V6zm10 0h2v12h-2V6z" fill="currentColor"/>
                </svg>
              </button>
              <button class="icon-btn" id="playerSheetLoop" type="button" aria-label="Repetir beat" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17 17H7a4 4 0 0 1 0-8h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M15 20l3-3-3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M7 7h10a4 4 0 1 1 0 8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M9 4L6 7l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div class="player-sheet__actions">
              <button class="player-sheet__cta player-sheet__cta--ghost" id="playerSheetLicenses" type="button">
                <span>Ver licencias</span>
              </button>
              <button class="player-sheet__cta" id="playerSheetCartCta" type="button">
                ${CART_ICON}
                <span>Añadir Basic al carrito</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  const playerMobile = qs('#playerMobile');
  const playerMobileOpen = qs('#playerMobileOpen');
  const playerMobileCover = qs('#playerMobileCover');
  const playerMobileTitle = qs('#playerMobileTitle');
  const playerMobileMeta = qs('#playerMobileMeta');
  const playerMobileToggle = qs('#playerMobileToggle');
  const playerMobileToggleIcon = qs('#playerMobileToggleIcon');
  const playerMobileDismiss = qs('#playerMobileDismiss');
  const playerSheet = qs('#playerSheet');
  const playerSheetBackdrop = qs('#playerSheetBackdrop');
  const playerSheetClose = qs('#playerSheetClose');
  const playerSheetBg = qs('#playerSheetBg');
  const playerSheetCover = qs('#playerSheetCover');
  const playerSheetTitle = qs('#playerSheetTitle');
  const playerSheetMeta = qs('#playerSheetMeta');
  const playerSheetSeek = qs('#playerSheetSeek');
  const playerSheetTime = qs('#playerSheetTime');
  const playerSheetDuration = qs('#playerSheetDuration');
  const playerSheetToggle = qs('#playerSheetToggle');
  const playerSheetToggleIcon = qs('#playerSheetToggleIcon');
  const playerSheetShuffle = qs('#playerSheetShuffle');
  const playerSheetPrev = qs('#playerSheetPrev');
  const playerSheetNext = qs('#playerSheetNext');
  const playerSheetLoop = qs('#playerSheetLoop');
  const playerSheetCart = qs('#playerSheetCart');
  const playerSheetLicenses = qs('#playerSheetLicenses');
  const playerSheetCartCta = qs('#playerSheetCartCta');

  const formatTime = (t) => {
    if(!Number.isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const currentBeat = () => state.beats[currentBeatIndex] || null;
  const currentTrackHeading = () => {
    const main = String(playerTitle?.textContent || '').trim() || 'Nada reproduciendo';
    const secondary = String(playerSubtitle?.textContent || '').trim();
    return secondary ? `${main} - "${secondary}"` : main;
  };
  const currentTrackMeta = () => {
    const secondary = String(playerSubtitle?.textContent || '').trim();
    const meta = String(playerMeta?.textContent || '').trim();
    return [secondary, meta].filter(Boolean).join(' · ') || 'Reproduce un beat para escuchar la vista previa';
  };
  const preservePlaybackSession = () => {
    if(!current) return;
    try{ sessionStorage.setItem(PLAYER_SESSION_KEY, '1'); }catch{}
    savePlayerState();
  };
  const openCurrentBeatLicenses = () => {
    const beat = currentBeat();
    if(!beat) return;
    preservePlaybackSession();
    window.location.href = `./beat.html?beat=${encodeURIComponent(beat.slug)}`;
  };
  const updateMobilePlayerContent = () => {
    const heading = currentTrackHeading();
    const meta = currentTrackMeta();
    const cover = playerCoverImg?.src || './assets/placeholder.svg';
    if(playerMobileTitle) playerMobileTitle.textContent = heading;
    if(playerMobileMeta) playerMobileMeta.textContent = meta;
    if(playerMobileCover){
      playerMobileCover.src = cover;
      playerMobileCover.alt = heading ? `Cover ${heading}` : '';
    }
    if(playerSheetTitle) playerSheetTitle.textContent = heading;
    if(playerSheetMeta) playerSheetMeta.textContent = meta;
    if(playerSheetBg) playerSheetBg.src = cover;
    if(playerSheetCover){
      playerSheetCover.src = cover;
      playerSheetCover.alt = heading ? `Cover ${heading}` : '';
    }
  };
  const updateSheetCartButtons = () => {
    const beat = currentBeat();
    const isAvailable = Boolean(beat) && beat.status === 'available';
    if(playerSheetCart){
      playerSheetCart.disabled = !beat;
      playerSheetCart.classList.toggle('is-disabled', !beat);
    }
    if(playerSheetLicenses){
      playerSheetLicenses.disabled = !beat;
      playerSheetLicenses.classList.toggle('is-disabled', !beat);
    }
    if(playerSheetCartCta){
      playerSheetCartCta.disabled = !isAvailable;
      playerSheetCartCta.classList.toggle('is-disabled', !isAvailable);
    }
    if(playerSheetCartCta){
      playerSheetCartCta.innerHTML = `${CART_ICON}<span>${isAvailable ? 'Añadir Basic al carrito' : 'Beat no disponible'}</span>`;
    }
  };
  const setPlayerSheetOpen = (open) => {
    playerSheetOpen = Boolean(open && playerSheet);
    if(playerSheet) playerSheet.classList.toggle('is-open', playerSheetOpen);
    document.body.classList.toggle('player-sheet-open', playerSheetOpen);
  };
  const addCurrentBeatToCart = () => {
    const beat = currentBeat();
    if(!beat || beat.status !== 'available') return;
    Cart.add({
      beatId: beat.id,
      slug: beat.slug,
      title: beat.title,
      license: 'basic',
      price: beat.prices.basic,
      qty: 1
    });
  };

  const updateToggleIcon = () => {
    if(!playerToggleIcon) return;
    playerToggleIcon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    if(playerMobileToggleIcon) playerMobileToggleIcon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${playing ? PAUSE_ICON : PLAY_ICON}</svg>`;
    if(playerSheetToggleIcon) playerSheetToggleIcon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  };
  const updateCoverIcons = () => {
    qsa('.cover-play').forEach(btn => {
      const icon = btn.querySelector('.cover-play__icon');
      if(!icon) return;
      if(btn.disabled || !btn.dataset.preview){
        icon.innerHTML = COVER_NO_SVG;
        btn.classList.remove('is-playing');
        return;
      }
      const isActive = playing && current === btn.dataset.preview;
      btn.classList.toggle('is-playing', isActive);
      icon.innerHTML = isActive ? COVER_PAUSE_SVG : COVER_PLAY_SVG;
    });
    qsa('[data-mobile-play]').forEach(btn => {
      const icon = btn.querySelector('.beat-row__mini-action-icon');
      if(!icon) return;
      const beat = state.beats[Number(btn.dataset.mobilePlay)];
      const isActive = Boolean(beat?.preview) && playing && current === beat.preview;
      btn.classList.toggle('is-playing', isActive);
      icon.innerHTML = isActive ? COVER_PAUSE_SVG : COVER_PLAY_SVG;
    });
  };
  const updatePreviewButton = () => {
    if(!previewButton || !previewButtonTarget) return;
    const svg = previewButton.querySelector('svg');
    if(!svg) return;
    svg.innerHTML = (playing && current === previewButtonTarget) ? PAUSE_ICON : PLAY_ICON;
  };
  const splitTitle = (fullTitle) => {
    const raw = String(fullTitle || '').trim();
    if(!raw) return { artist: '-', song: '' };
    let artist = raw;
    let song = '';
    if(raw.includes(' - ')){
      const parts = raw.split(' - ');
      artist = parts.shift() || '';
      song = parts.join(' - ');
    }
    song = song.trim().replace(/^["“”«»']+|["“”«»']+$/g, '');
    return { artist: artist.trim(), song: song.trim() };
  };
  const setPlayerVisible = (visible) => {
    if(playerRoot) playerRoot.classList.toggle('is-visible', visible);
    if(playerMobile) playerMobile.classList.toggle('is-visible', visible);
    document.body.classList.toggle('player-active', visible);
    if(!visible) setPlayerSheetOpen(false);
  };
  const dismissPlayer = () => {
    pause();
    playerDismissed = true;
    try{ sessionStorage.setItem(PLAYER_HIDDEN_KEY, '1'); }catch{}
    setPlayerVisible(false);
  };
  const setRangeProgress = (input, value) => {
    if(!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const safeValue = Math.min(max, Math.max(min, Number(value || 0)));
    const progress = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--range-progress', `${progress}%`);
  };
  const getStoredVolume = () => {
    try{
      const stored = Number(localStorage.getItem(PLAYER_VOLUME_KEY));
      return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.8;
    }catch{
      return 0.8;
    }
  };
  const getStoredPlayerPrefs = () => {
    try{
      return JSON.parse(localStorage.getItem(PLAYER_PREFS_KEY)) || {};
    }catch{
      return {};
    }
  };
  const savePlayerPrefs = () => {
    try{
      localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify({
        loop: loopEnabled,
        shuffle: shuffleEnabled
      }));
    }catch{}
  };
  const applyVolume = (value) => {
    const safeVolume = isCompactViewport() ? 1 : Math.min(1, Math.max(0, Number(value || 0)));
    audio.volume = safeVolume;
    audio.muted = safeVolume === 0;
    if(playerVolume) {
      playerVolume.value = String(safeVolume);
      setRangeProgress(playerVolume, safeVolume);
    }
    try{ localStorage.setItem(PLAYER_VOLUME_KEY, String(safeVolume)); }catch{}
  };
  const updateModeButtons = () => {
    if(playerLoop){
      playerLoop.classList.toggle('is-active', loopEnabled);
      playerLoop.setAttribute('aria-pressed', String(loopEnabled));
    }
    if(playerSheetLoop){
      playerSheetLoop.classList.toggle('is-active', loopEnabled);
      playerSheetLoop.setAttribute('aria-pressed', String(loopEnabled));
    }
    if(playerShuffle){
      playerShuffle.classList.toggle('is-active', shuffleEnabled);
      playerShuffle.setAttribute('aria-pressed', String(shuffleEnabled));
    }
    if(playerSheetShuffle){
      playerSheetShuffle.classList.toggle('is-active', shuffleEnabled);
      playerSheetShuffle.setAttribute('aria-pressed', String(shuffleEnabled));
    }
  };

  const syncPlayUI = () => {
    updateToggleIcon();
    updateCoverIcons();
    updatePreviewButton();
    updateModeButtons();
    if(playerRoot) playerRoot.classList.toggle('is-playing', playing);
    if(playerMobile) playerMobile.classList.toggle('is-playing', playing);
    updateMobilePlayerContent();
    updateSheetCartButtons();
  };
  syncPlayUI();

  const savePlayerState = () => {
    if(!current) return;
    const snapshot = {
      src: current,
      time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      playing,
      title: playerTitle ? playerTitle.textContent : '',
      subtitle: playerSubtitle ? playerSubtitle.textContent : '',
      meta: playerMeta ? playerMeta.textContent : '',
      cover: playerCoverImg ? playerCoverImg.src : '',
      beatIndex: currentBeatIndex,
      volume: audio.volume
    };
    try{ localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(snapshot)); }catch{}
  };
  const loadPlayerState = () => {
    try{ return JSON.parse(localStorage.getItem(PLAYER_STATE_KEY)); }catch{ return null; }
  };
  const tryResumePlayback = () => {
    if(!current) return;
    playing = true;
    syncPlayUI();
    playerDismissed = false;
    try{ sessionStorage.removeItem(PLAYER_HIDDEN_KEY); }catch{}
    setPlayerVisible(true);
    const attempt = audio.play();
    if(attempt && typeof attempt.then === 'function'){
      attempt.then(() => {
        playing = true;
        pendingResume = false;
        syncPlayUI();
        savePlayerState();
      }).catch(() => {
        playing = false;
        pendingResume = true;
        syncPlayUI();
      });
    }else{
      playing = true;
      pendingResume = false;
      syncPlayUI();
    }
  };
  const resumeOnInteraction = () => {
    if(!pendingResume) return;
    tryResumePlayback();
    if(!pendingResume) document.removeEventListener('click', resumeOnInteraction);
  };

  function play(src){
    if(!src) return;
    if(current !== src){
      audio.src = src;
      current = src;
    }
    tryResumePlayback();
  }
  function pause(){
    audio.pause();
    playing = false;
    syncPlayUI();
    savePlayerState();
  }
  function toggle(src){
    if(playing && current === src){ pause(); }
    else{ play(src); }
  }

  const playableIndices = () => state.beats.map((b,i) => b.preview ? i : null).filter(i => i !== null);
  const setPlayerCoverFallback = () => {
    if(!playerCoverPlay) return;
    if(playerCoverPlay.dataset.preview) return;
    const list = playableIndices();
    if(list.length > 0){
      playerCoverPlay.dataset.preview = state.beats[list[0]].preview;
    }
  };
  setPlayerCoverFallback();
  syncPlayUI();

  const stored = loadPlayerState();
  playerDismissed = sessionStorage.getItem(PLAYER_HIDDEN_KEY) === '1';
  const storedPrefs = getStoredPlayerPrefs();
  loopEnabled = Boolean(storedPrefs.loop);
  shuffleEnabled = Boolean(storedPrefs.shuffle);
  updateModeButtons();
  if(stored && stored.src && sessionStorage.getItem(PLAYER_SESSION_KEY) === '1'){
    current = stored.src;
    if(Number.isFinite(stored.beatIndex)) currentBeatIndex = stored.beatIndex;
    if(playerTitle && stored.title) playerTitle.textContent = stored.title;
    if(playerSubtitle){
      if(stored.subtitle){
        playerSubtitle.textContent = stored.subtitle;
      }else if(stored.title){
        const parsed = splitTitle(stored.title);
        playerTitle.textContent = parsed.artist || stored.title;
        playerSubtitle.textContent = parsed.song || '';
      }
    }
    if(playerMeta && stored.meta) playerMeta.textContent = stored.meta;
    if(playerCoverImg && stored.cover) playerCoverImg.src = stored.cover;
    if(playerCoverPlay) playerCoverPlay.dataset.preview = stored.src;
    audio.src = stored.src;
    if(Number.isFinite(stored.volume)) applyVolume(stored.volume);
    if(Number.isFinite(stored.time)) pendingSeek = stored.time;
    if(stored.playing){
      pendingResume = true;
      tryResumePlayback();
    }else{
      setPlayerVisible(!playerDismissed);
    }
    syncPlayUI();
  }else{
    setPlayerVisible(false);
  }

  const playBeatByIndex = (idx) => {
    const beat = state.beats[idx];
    if(!beat || !beat.preview) return;
    sessionStorage.setItem(PLAYER_SESSION_KEY, '1');
    currentBeatIndex = idx;
    if(playerSeek) playerSeek.value = 0;
    if(playerTime) playerTime.textContent = '0:00';
    play(beat.preview);
    const parsed = splitTitle(beat.title);
    document.dispatchEvent(new CustomEvent('player:change', { detail: {
      title: beat.title,
      artist: parsed.artist,
      song: parsed.song,
      meta: [beat.bpm ? `${beat.bpm} BPM` : '', beat.key || ''].filter(Boolean).join(' · '),
      cover: beat.cover
    }}));
    savePlayerState();
  };

  const playNext = (dir) => {
    const list = playableIndices();
    if(list.length === 0) return;
    if(shuffleEnabled && list.length > 1){
      const pool = list.filter((idx) => idx !== currentBeatIndex);
      const randomIndex = pool[Math.floor(Math.random() * pool.length)] ?? list[0];
      playBeatByIndex(randomIndex);
      return;
    }
    let pos = list.indexOf(currentBeatIndex);
    if(pos === -1) pos = 0;
    pos = (pos + dir + list.length) % list.length;
    playBeatByIndex(list[pos]);
  };

  document.addEventListener('player:change', (e) => {
    const d = e.detail || {};
    if(playerTitle) playerTitle.textContent = d.artist || d.title || '-';
    if(playerSubtitle) playerSubtitle.textContent = d.song || '';
    if(playerMeta) playerMeta.textContent = d.meta || '';
    if(playerCoverImg && d.cover){
      playerCoverImg.src = d.cover;
      playerCoverImg.alt = d.title ? 'Cover ' + d.title : '';
    }
    if(playerCoverPlay){
      playerCoverPlay.dataset.preview = current || '';
      if(!current) setPlayerCoverFallback();
    }
    syncPlayUI();
  });

  if(playerToggle){
    playerToggle.addEventListener('click', () => {
      sessionStorage.setItem(PLAYER_SESSION_KEY, '1');
      if(!current){
        const list = playableIndices();
        if(list.length > 0) playBeatByIndex(list[0]);
        return;
      }
      toggle(current);
    });
  }
  if(playerCoverPlay){
    playerCoverPlay.addEventListener('click', () => {
      sessionStorage.setItem(PLAYER_SESSION_KEY, '1');
      if(!current){
        const list = playableIndices();
        if(list.length > 0) playBeatByIndex(list[0]);
        return;
      }
      toggle(current);
    });
  }
  if(playerMobileToggle){
    playerMobileToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      sessionStorage.setItem(PLAYER_SESSION_KEY, '1');
      if(!current){
        const list = playableIndices();
        if(list.length > 0) playBeatByIndex(list[0]);
        return;
      }
      toggle(current);
    });
  }
  if(playerMobileDismiss){
    playerMobileDismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      dismissPlayer();
    });
  }
  if(playerMobileOpen){
    playerMobileOpen.addEventListener('click', () => {
      if(!current) return;
      setPlayerSheetOpen(true);
    });
  }
  if(playerSheetClose) playerSheetClose.addEventListener('click', () => setPlayerSheetOpen(false));
  if(playerSheetBackdrop) playerSheetBackdrop.addEventListener('click', () => setPlayerSheetOpen(false));
  if(playerSheetToggle){
    playerSheetToggle.addEventListener('click', () => {
      sessionStorage.setItem(PLAYER_SESSION_KEY, '1');
      if(!current){
        const list = playableIndices();
        if(list.length > 0) playBeatByIndex(list[0]);
        return;
      }
      toggle(current);
    });
  }
  document.addEventListener('click', resumeOnInteraction);
  if(playerShuffle){
    playerShuffle.addEventListener('click', () => {
      shuffleEnabled = !shuffleEnabled;
      savePlayerPrefs();
      updateModeButtons();
    });
  }
  if(playerSheetShuffle){
    playerSheetShuffle.addEventListener('click', () => {
      shuffleEnabled = !shuffleEnabled;
      savePlayerPrefs();
      updateModeButtons();
    });
  }
  if(playerPrev) playerPrev.addEventListener('click', () => playNext(-1));
  if(playerNext) playerNext.addEventListener('click', () => playNext(1));
  if(playerSheetPrev) playerSheetPrev.addEventListener('click', () => playNext(-1));
  if(playerSheetNext) playerSheetNext.addEventListener('click', () => playNext(1));
  if(playerLoop){
    playerLoop.addEventListener('click', () => {
      loopEnabled = !loopEnabled;
      savePlayerPrefs();
      updateModeButtons();
    });
  }
  if(playerSheetLoop){
    playerSheetLoop.addEventListener('click', () => {
      loopEnabled = !loopEnabled;
      savePlayerPrefs();
      updateModeButtons();
    });
  }
  if(playerSheetCart){
    playerSheetCart.addEventListener('click', () => {
      openCurrentBeatLicenses();
    });
  }
  if(playerSheetLicenses){
    playerSheetLicenses.addEventListener('click', () => {
      openCurrentBeatLicenses();
    });
  }
  if(playerSheetCartCta){
    playerSheetCartCta.addEventListener('click', () => addCurrentBeatToCart());
  }
  if(playerVolume) {
    applyVolume(isCompactViewport() ? 1 : (playerVolume.value || getStoredVolume()));
    ['input', 'change'].forEach((eventName) => {
      playerVolume.addEventListener(eventName, () => applyVolume(playerVolume.value));
    });
  }

  audio.addEventListener('loadedmetadata', () => {
    if(playerDuration) playerDuration.textContent = formatTime(audio.duration);
    if(playerSeek) setRangeProgress(playerSeek, audio.currentTime);
    if(playerSheetDuration) playerSheetDuration.textContent = formatTime(audio.duration);
    if(playerSheetSeek) setRangeProgress(playerSheetSeek, audio.currentTime);
    if(pendingSeek !== null && Number.isFinite(pendingSeek)){
      audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek);
      pendingSeek = null;
    }
  });
  audio.addEventListener('timeupdate', () => {
    if(playerTime) playerTime.textContent = formatTime(audio.currentTime);
    if(playerSeek && audio.duration){
      const progress = ((audio.currentTime / audio.duration) * 100).toFixed(2);
      playerSeek.value = progress;
      setRangeProgress(playerSeek, progress);
    }
    if(playerSheetTime) playerSheetTime.textContent = formatTime(audio.currentTime);
    if(playerSheetSeek && audio.duration){
      const progress = ((audio.currentTime / audio.duration) * 100).toFixed(2);
      playerSheetSeek.value = progress;
      setRangeProgress(playerSheetSeek, progress);
    }
    if(playing && Number.isFinite(audio.currentTime)){
      const sec = Math.floor(audio.currentTime);
      if(sec !== lastSavedSecond && sec % 2 === 0){
        lastSavedSecond = sec;
        savePlayerState();
      }
    }
  });
  audio.addEventListener('ended', () => {
    if(loopEnabled){
      audio.currentTime = 0;
      tryResumePlayback();
      return;
    }
    playNext(1);
  });
  window.addEventListener('beforeunload', savePlayerState);
  window.addEventListener('pagehide', savePlayerState);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') savePlayerState();
  });
  if(!playerVolume) applyVolume(getStoredVolume());
  if(playerSeek) setRangeProgress(playerSeek, playerSeek.value || 0);

  if(playerSeek){
    playerSeek.addEventListener('input', () => {
      if(!audio.duration) return;
      setRangeProgress(playerSeek, playerSeek.value);
      audio.currentTime = (Number(playerSeek.value) / 100) * audio.duration;
    });
  }
  if(playerSheetSeek){
    playerSheetSeek.addEventListener('input', () => {
      if(!audio.duration) return;
      setRangeProgress(playerSheetSeek, playerSheetSeek.value);
      audio.currentTime = (Number(playerSheetSeek.value) / 100) * audio.duration;
    });
  }
  document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape' && playerSheetOpen){
      setPlayerSheetOpen(false);
    }
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if(!link || !current) return;
    if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href') || '';
    if(!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try{
      const nextUrl = new URL(link.href, window.location.href);
      if(nextUrl.origin !== window.location.origin) return;
      preservePlaybackSession();
    }catch{}
  }, true);
  window.addEventListener('resize', () => {
    if(isCompactViewport()){
      applyVolume(1);
    }else{
      applyVolume(getStoredVolume());
    }
  });

  const licenseName = (id) => {
    const lic = state.licenses.find(l => l.id === id);
    return lic ? lic.name : id;
  };

  // Page routing
  const registerCleanup = (fn) => {
    if(typeof fn === 'function') pageCleanups.push(fn);
  };

  const cleanupPage = () => {
    pageCleanups.forEach((fn) => {
      try{ fn(); }catch(err){ console.error(err); }
    });
    pageCleanups = [];
    previewButton = null;
    previewButtonTarget = null;
    updatePreviewButton();
  };

  const initCatalogPage = () => {
    const list = qs('#catalogList');
    const empty = qs('#emptyState');
    if(!list || !empty) return;

    const heroHighlightImg = qs('#heroHighlightImg');
    const heroHighlightTitle = qs('#heroHighlightTitle');
    const heroHighlightMeta = qs('#heroHighlightMeta');

    const search = qs('#searchInput');
    const bpmMinEl = qs('#bpmMin');
    const bpmMaxEl = qs('#bpmMax');
    const genreEl = qs('#genreSelect');
    const sortEl = qs('#sortSelect');

    const genres = [...new Set(
      state.beats
        .map((beat) => String(beat.genre || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    if(genreEl && genreEl.options.length <= 1){
      genres.forEach(g => {
        const o = document.createElement('option');
        o.value = g;
        o.textContent = g;
        genreEl.appendChild(o);
      });
    }

    const matchesText = (beat, q) => {
      if(!q) return true;
      const s = q.trim().toLowerCase();
      if(!s) return true;
      const hay = [beat.title, beat.genre, beat.key, ...(beat.tags||[]), ...(beat.moods||[])].join(' ').toLowerCase();
      return hay.includes(s);
    };
    const matchesBpm = (beat, min, max) => {
      const bpm = Number(beat.bpm || 0);
      if(Number.isFinite(min) && bpm < min) return false;
      if(Number.isFinite(max) && bpm > max) return false;
      return true;
    };
    const matchesGenre = (beat, genre) => !genre || String(beat.genre || '').toLowerCase() === String(genre).toLowerCase();

    const sortBeats = (beats, sort) => {
      const next = [...beats];
      if(sort === 'price') next.sort((a,b) => (a.prices?.basic ?? 0) - (b.prices?.basic ?? 0));
      else if(sort === 'bpm') next.sort((a,b) => (a.bpm ?? 0) - (b.bpm ?? 0));
      else if(sort === 'az') next.sort((a,b) => String(a.title).localeCompare(String(b.title)));
      else next.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return next;
    };

    const renderRow = (beat) => {
      const isSold = beat.status === 'sold';
      const isUnavailable = beat.status && beat.status !== 'available';
      const statusLabel = isSold ? 'Vendido' : (isUnavailable ? 'No disponible' : 'Disponible');
      const statusClass = isSold ? 'badge--status-sold' : (isUnavailable ? 'badge--status-unavailable' : 'badge--status-available');
      const hasPreview = Boolean(beat.preview);
      const beatIndex = state.beats.findIndex(b => b.id === beat.id);
      const detailMeta = `${beat.bpm} BPM · ${esc(beat.key)}${beat.genre ? ` · ${esc(beat.genre)}` : ''}`;
      const tags = [...(beat.tags||[]), ...(beat.moods||[])].slice(0,5)
        .map(t => '<span class="tag">' + esc(t) + '</span>').join('');
      const coverOverlay = (!isUnavailable && hasPreview) ? `
            <button class="cover-play" type="button" data-index="${beatIndex}" data-preview="${beat.preview}" data-title="${esc(beat.title)}" data-meta="${beat.bpm} BPM - ${esc(beat.key)}" data-cover="${beat.cover}" aria-label="Reproducir preview">
              <span class="cover-play__icon">${COVER_PLAY_SVG}</span>
              <span class="wave wave--cover" aria-hidden="true"><span></span><span></span><span></span></span>
            </button>
          ` : '';
      const mobilePlay = hasPreview && !isUnavailable ? `
        <button class="beat-row__mini-action beat-row__mini-action--play" type="button" data-mobile-play="${beatIndex}" aria-label="Reproducir preview">
          <span class="beat-row__mini-action-icon">${COVER_PLAY_SVG}</span>
        </button>
      ` : '';
      const mobileLicense = !isUnavailable ? `
        <a class="beat-row__mini-action beat-row__mini-action--license" href="./beat.html?beat=${encodeURIComponent(beat.slug)}" aria-label="Ver licencias de ${esc(beat.title)}">
          <span class="beat-row__mini-action-icon">${CART_ICON}</span>
        </a>
      ` : '';
      return `
        <article class="beat-row ${isUnavailable ? 'is-unavailable' : ''}">
          <div class="beat-row__mobile-summary">
            <button class="beat-row__mobile-toggle" type="button" data-mobile-toggle="${beatIndex}" aria-expanded="false" aria-controls="beatMobilePanel-${beat.id}">
              <div class="beat-row__mobile-cover">
                <img src="${beat.cover}" alt="Cover ${esc(beat.title)}" />
              </div>
              <div class="beat-row__mobile-copy">
                <div class="beat-row__mobile-status badge ${statusClass}">${statusLabel}</div>
                <div class="beat-row__mobile-title">${esc(beat.title)}</div>
                <div class="beat-row__mobile-meta">${beat.bpm} BPM · ${esc(beat.key)}</div>
              </div>
              <span class="beat-row__mobile-chevron" aria-hidden="true">${CHEVRON_DOWN_ICON}</span>
            </button>
            <div class="beat-row__mobile-actions">
              ${mobilePlay}
              ${mobileLicense}
            </div>
          </div>
          <div class="beat-row__mobile-panel" id="beatMobilePanel-${beat.id}" hidden>
            <div class="beat-row__mobile-card">
              <div class="beat-row__mobile-hero">
                <img src="${beat.cover}" alt="Cover ${esc(beat.title)}" />
              </div>
              <div class="beat-row__mobile-body">
                <div class="badge ${statusClass}">${statusLabel}</div>
                <div class="beat-title">${esc(beat.title)}</div>
                <div class="beat-meta">
                  <span>${beat.bpm} BPM</span>
                  <span>${esc(beat.key)}</span>
                  <span>${esc(beat.genre)}</span>
                </div>
                <div class="beat-tags">${tags}</div>
                <div class="beat-row__mobile-footer">
                  <div class="beat-price">Desde ${fmtEUR(beat.prices.basic)}</div>
                  <div class="beat-row__mobile-buttons">
                    <a class="btn btn--primary btn--sm" href="./beat.html?beat=${encodeURIComponent(beat.slug)}">Ver licencias</a>
                    <button class="btn btn--ghost btn--sm" data-add data-beat-id="${beat.id}" data-slug="${beat.slug}" data-title="${esc(beat.title)}" data-license="basic" data-price="${beat.prices.basic}" ${isUnavailable ? 'disabled' : ''}>Añadir Basic</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="beat-row__desktop">
            <div class="beat-cover">
              <img src="${beat.cover}" alt="Cover ${esc(beat.title)}" />
              ${coverOverlay}
            </div>
            <div class="beat-info">
              <div class="badge ${statusClass}">${statusLabel}</div>
              <div class="beat-title">${esc(beat.title)}</div>
              <div class="beat-meta">
                <span>${detailMeta}</span>
              </div>
              <div class="beat-tags">${tags}</div>
            </div>
            <div class="beat-actions">
              <div class="beat-price">Desde ${fmtEUR(beat.prices.basic)}</div>
              <div class="beat-buttons">
                <a class="btn btn--primary btn--sm" href="./beat.html?beat=${encodeURIComponent(beat.slug)}">Licencias</a>
                <button class="btn btn--ghost btn--sm" data-add data-beat-id="${beat.id}" data-slug="${beat.slug}" data-title="${esc(beat.title)}" data-license="basic" data-price="${beat.prices.basic}" ${isUnavailable ? 'disabled' : ''}>Añadir Basic</button>
              </div>
            </div>
          </div>
        </article>
      `;
    };

    const render = () => {
      const q = search ? search.value : '';
      const min = !bpmMinEl || bpmMinEl.value === '' ? NaN : Number(bpmMinEl.value);
      const max = !bpmMaxEl || bpmMaxEl.value === '' ? NaN : Number(bpmMaxEl.value);
      const genre = genreEl ? genreEl.value : '';
      const sort = sortEl ? sortEl.value : 'latest';

      const filtered = state.beats.filter((beat) =>
        matchesText(beat, q) && matchesBpm(beat, min, max) && matchesGenre(beat, genre)
      );

      const sorted = sortBeats(filtered, sort);
      list.innerHTML = sorted.map(renderRow).join('');
      empty.classList.toggle('hidden', sorted.length !== 0);

      const collapseMobileRows = (exceptId = '') => {
        qsa('.beat-row__mobile-toggle', list).forEach((toggleBtn) => {
          const panelId = toggleBtn.getAttribute('aria-controls') || '';
          if(panelId === exceptId) return;
          toggleBtn.setAttribute('aria-expanded', 'false');
          const row = toggleBtn.closest('.beat-row');
          if(row) row.classList.remove('is-expanded');
          const panel = panelId ? qs(`#${panelId}`) : null;
          if(panel) panel.hidden = true;
          const chevron = qs('.beat-row__mobile-chevron', toggleBtn);
          if(chevron) chevron.innerHTML = CHEVRON_DOWN_ICON;
        });
      };

      qsa('.beat-row__mobile-toggle', list).forEach((toggleBtn) => {
        toggleBtn.addEventListener('click', () => {
          const panelId = toggleBtn.getAttribute('aria-controls') || '';
          const panel = panelId ? qs(`#${panelId}`) : null;
          if(!panel) return;
          const nextExpanded = toggleBtn.getAttribute('aria-expanded') !== 'true';
          collapseMobileRows(nextExpanded ? panelId : '');
          toggleBtn.setAttribute('aria-expanded', String(nextExpanded));
          panel.hidden = !nextExpanded;
          const row = toggleBtn.closest('.beat-row');
          if(row) row.classList.toggle('is-expanded', nextExpanded);
          const chevron = qs('.beat-row__mobile-chevron', toggleBtn);
          if(chevron) chevron.innerHTML = nextExpanded ? CHEVRON_UP_ICON : CHEVRON_DOWN_ICON;
        });
      });

      qsa('.cover-play[data-index]', list).forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = Number(btn.dataset.index);
          const beat = state.beats[idx];
          if(!beat || !beat.preview) return;
          if(current === beat.preview){
            toggle(beat.preview);
            return;
          }
          playBeatByIndex(idx);
        });
      });
      qsa('[data-mobile-play]', list).forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = Number(btn.dataset.mobilePlay);
          const beat = state.beats[idx];
          if(!beat || !beat.preview) return;
          if(current === beat.preview){
            toggle(beat.preview);
            return;
          }
          playBeatByIndex(idx);
        });
      });

      qsa('[data-add]', list).forEach(btn => {
        btn.addEventListener('click', () => {
          Cart.add({
            beatId: btn.dataset.beatId,
            slug: btn.dataset.slug,
            title: btn.dataset.title,
            license: btn.dataset.license,
            price: Number(btn.dataset.price),
            qty: 1
          });
        });
      });
      updateCoverIcons();
    };

    const latestBeat = state.beats.reduce((acc, beat) => {
      if(!acc) return beat;
      const accDate = new Date(acc.createdAt || 0).getTime();
      const beatDate = new Date(beat.createdAt || 0).getTime();
      return beatDate > accDate ? beat : acc;
    }, null);
    if(latestBeat && heroHighlightImg){
      heroHighlightImg.src = latestBeat.cover || './assets/placeholder.svg';
      heroHighlightImg.alt = latestBeat.title ? 'Cover ' + latestBeat.title : 'Cover';
      if(heroHighlightTitle) heroHighlightTitle.textContent = latestBeat.title || 'Último lanzamiento';
      if(heroHighlightMeta) heroHighlightMeta.textContent = `${latestBeat.genre || 'Beat'} · ${latestBeat.bpm || '-'} BPM`;
    }

    render();
    [search, bpmMinEl, bpmMaxEl, genreEl, sortEl].filter(Boolean).forEach(el => {
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });

    const servicesHome = qs('#servicesGridHome');
    if(servicesHome){
      servicesHome.innerHTML = state.services.map(s => {
        const highlight = s.highlight ? ' highlight' : '';
        const flag = s.highlight ? '<div class="license-flag">Servicio recomendado</div>' : '';
        return `
          <article class="license-card${highlight}">
            <div class="beat-title">${esc(s.name)}</div>
            <div class="beat-title">${esc(s.priceLabel)}</div>
            <div class="license-list">${s.includes.map(i => '<div>- ' + esc(i) + '</div>').join('')}</div>
            ${flag}
          </article>
        `;
      }).join('');
    }
  };

  const initBeatPage = () => {
    const slug = new URLSearchParams(window.location.search).get('beat');
    const beatIndex = state.beats.findIndex(b => b.slug === slug);
    const beat = state.beats[beatIndex];
    if(!beat) return;
    const beatUnavailable = beat.status && beat.status !== 'available';

    const beatTitle = qs('#beatTitle');
    const beatMeta = qs('#beatMeta');
    const coverImg = qs('#coverImg');
    const tagRow = qs('#tagRow');
    const previewBtn = qs('#previewBtn');
    const coverPlayBtn = qs('#beatCoverPlay');
    const licenseWrap = qs('#licenseOptions');
    const addBtn = qs('#addToCartBtn');
    if(!beatTitle || !beatMeta || !coverImg || !tagRow || !licenseWrap || !addBtn) return;

    beatTitle.textContent = beat.title;
    beatMeta.textContent = beat.bpm + ' BPM - ' + beat.key + ' - ' + beat.genre;
    coverImg.src = beat.cover;
    coverImg.alt = 'Cover ' + beat.title;

    const tags = [...(beat.tags||[]), ...(beat.moods||[])];
    tagRow.innerHTML = tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('');

    if(beat.preview){
      if(previewBtn){
        previewButton = previewBtn;
        previewButtonTarget = beat.preview;
        updatePreviewButton();
        previewBtn.addEventListener('click', () => {
          if(current === beat.preview){
            toggle(beat.preview);
            return;
          }
          playBeatByIndex(beatIndex);
        });
      }
      if(coverPlayBtn){
        coverPlayBtn.dataset.preview = beat.preview;
        coverPlayBtn.addEventListener('click', () => {
          if(current === beat.preview){
            toggle(beat.preview);
            return;
          }
          playBeatByIndex(beatIndex);
        });
      }
      updateCoverIcons();
    }else{
      if(previewBtn){
        previewBtn.setAttribute('disabled', 'true');
        previewBtn.textContent = 'Preview no disponible';
      }
      if(coverPlayBtn){
        coverPlayBtn.setAttribute('disabled', 'true');
        coverPlayBtn.removeAttribute('data-preview');
      }
      previewButton = null;
      previewButtonTarget = null;
    }

    licenseWrap.innerHTML = state.licenses.map(l => {
      const highlight = l.highlight ? ' highlight' : '';
      const active = l.id === 'basic' ? ' active' : '';
      const priceLabel = l.priceLabel || fmtEUR(l.price);
      const items = (l.includes || []).map((item, idx) => (
        `<span>${esc(item)}</span>${idx < l.includes.length - 1 ? '<span class="license-dot">·</span>' : ''}`
      )).join('');
      const flag = l.highlight ? '<div class="license-flag">Licencia recomendada</div>' : '';
      return `
        <article class="license-card license-card--beat${highlight}${active}" data-license="${l.id}">
          <div class="license-title">${esc(l.name)}</div>
          <div class="license-items">${items}</div>
          <div class="license-price">${esc(priceLabel)}</div>
          ${flag}
        </article>
      `;
    }).join('');

    const contactHref = 'mailto:arikarabeats@gmail.com?subject=Licencia%20Exclusive%20-%20' + encodeURIComponent(beat.title);

    let selected = 'basic';
    const updateAdd = () => {
      if(beatUnavailable){
        addBtn.disabled = true;
        addBtn.textContent = beat.status === 'sold' ? 'Beat vendido' : 'No disponible';
        return;
      }
      const lic = state.licenses.find(l => l.id === selected);
      if(!lic) return;
      const priceLabel = lic.priceLabel || fmtEUR(beat.prices[selected]);
      if(lic.id === 'exclusive'){
        addBtn.textContent = 'Consultar Exclusive';
      }else{
        addBtn.textContent = 'Añadir ' + lic.name + ' - ' + priceLabel;
      }
    };
    updateAdd();

    qsa('#licenseOptions .license-card').forEach(card => {
      card.addEventListener('click', () => {
        qsa('#licenseOptions .license-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selected = card.dataset.license;
        updateAdd();
      });
    });

    addBtn.addEventListener('click', () => {
      if(beatUnavailable) return;
      if(selected === 'exclusive'){
        window.location.href = contactHref;
        return;
      }
      Cart.add({
        beatId: beat.id,
        slug: beat.slug,
        title: beat.title,
        license: selected,
        price: beat.prices[selected],
        qty: 1
      });
    });
  };

  const initLicensesPage = () => {
    const licGrid = qs('#licensesGrid');
    const servGrid = qs('#servicesGrid');
    if(!licGrid || !servGrid) return;

    licGrid.innerHTML = state.licenses.map(l => {
      const highlight = l.highlight ? ' highlight' : '';
      const cta = (l.cta && l.id !== 'exclusive') ? '<div class="badge">' + esc(l.cta) + '</div>' : '';
      const contactBtn = l.id === 'exclusive' ? '<a class="btn btn--ghost btn--sm" href="mailto:arikarabeats@gmail.com?subject=Licencia%20Exclusive">Consultar</a>' : '';
      const priceLabel = l.priceLabel || fmtEUR(l.price);
      const flag = l.highlight ? '<div class="license-flag">Licencia recomendada</div>' : '';
      return `
        <article class="license-card${highlight}">
          <div class="beat-title">${esc(l.name)}</div>
          <div class="beat-title">${esc(priceLabel)}</div>
          ${cta}
          <div class="license-list">${l.includes.map(i => '<div>- ' + esc(i) + '</div>').join('')}</div>
          ${contactBtn}
          ${flag}
        </article>
      `;
    }).join('');

    servGrid.innerHTML = state.services.map(s => {
      const highlight = s.highlight ? ' highlight' : '';
      const flag = s.highlight ? '<div class="license-flag">Servicio recomendado</div>' : '';
      return `
        <article class="license-card${highlight}">
          <div class="beat-title">${esc(s.name)}</div>
          <div class="beat-title">${esc(s.priceLabel)}</div>
          <div class="license-list">${s.includes.map(i => '<div>- ' + esc(i) + '</div>').join('')}</div>
          ${flag}
        </article>
      `;
    }).join('');

    const enableCardSelection = (selector) => {
      qsa(selector).forEach(card => {
        card.addEventListener('click', () => {
          qsa(selector).forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        });
      });
    };

    enableCardSelection('#licensesGrid .license-card');
    enableCardSelection('#servicesGrid .license-card');
  };

  const renderCartItem = (item, idx) => {
    const hasDiscount = Number(item.discountAmount || 0) > 0;
    const priceMeta = hasDiscount
      ? `<div class="cart-item__notes">Antes ${fmtEUR(item.basePrice)} · Ahorro ${fmtEUR(item.discountAmount)}</div>`
      : `<div class="cart-item__notes">Precio ${fmtEUR(item.basePrice)}</div>`;

    return `
      <article class="cart-item">
        <div class="cart-item__main">
          <div class="cart-item__title">${esc(item.title)}</div>
          <div class="cart-item__meta">${esc(licenseName(item.license))}</div>
          ${priceMeta}
        </div>
        <div class="cart-item__side">
          <div class="cart-item__price">${fmtEUR(item.finalPrice)}</div>
          <button class="cart-item__remove" type="button" data-remove="${idx}">Eliminar</button>
        </div>
      </article>
    `;
  };

  const initCartPage = () => {
    const listEl = qs('#cartList');
    const emptyEl = qs('#cartEmpty');
    const subtotalEl = qs('#cartSubtotal');
    const discountEl = qs('#cartDiscount');
    const totalEl = qs('#cartTotal');
    const clearBtn = qs('#clearBtn');
    const checkoutBtn = qs('#checkoutBtn');
    if(!listEl || !emptyEl || !subtotalEl || !discountEl || !totalEl || !clearBtn || !checkoutBtn) return;

    const render = () => {
      const cart = Cart.get();
      const pricing = getCartPricing(cart);
      emptyEl.classList.toggle('hidden', cart.length !== 0);
      if(cart.length === 0){
        listEl.innerHTML = '';
        subtotalEl.textContent = '-';
        discountEl.textContent = '-';
        totalEl.textContent = '-';
        return;
      }

      listEl.innerHTML = pricing.items.map((item, idx) => renderCartItem(item, idx)).join('');
      subtotalEl.textContent = fmtEUR(pricing.subtotal);
      discountEl.textContent = pricing.discount > 0 ? `- ${fmtEUR(pricing.discount)}` : fmtEUR(0);
      totalEl.textContent = fmtEUR(pricing.total);
      qsa('[data-remove]', listEl).forEach(btn => btn.addEventListener('click', () => Cart.remove(Number(btn.dataset.remove))));
    };

    render();
    document.addEventListener('cart:update', render);
    registerCleanup(() => document.removeEventListener('cart:update', render));

    clearBtn.addEventListener('click', () => Cart.clear());
    checkoutBtn.addEventListener('click', async () => {
      const cart = Cart.get();
      if(cart.length === 0){
        alert('Tu carrito está vacío.');
        return;
      }
      try{
        const res = await withRetry(() => fetch(apiUrl('/api/checkout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: cart })
        }), 2, 1500);
        const data = await res.json();
        if(data && data.url){
          saveLastOrderId(data.orderId);
          window.location.href = data.url;
          return;
        }
        if(data?.error === 'Uno de los beats del carrito ya no existe.' || data?.error === 'Carrito inválido'){
          Cart.get();
          document.dispatchEvent(new Event('cart:update'));
          return;
        }
        alert(data?.error || 'No se pudo iniciar el pago.');
      }catch(err){
        console.error(err);
        alert('Error conectando con el checkout.');
      }
    });
  };

  const initSuccessPage = (token) => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id') || '';
    const orderIdFromUrl = params.get('order_id') || '';
    const storedOrderId = orderIdFromUrl || localStorage.getItem(LAST_ORDER_KEY) || '';
    let orderId = sessionId ? orderIdFromUrl : storedOrderId;
    const MAX_SUCCESS_RETRIES = 8;

    const titleEl = qs('#successTitle');
    const leadEl = qs('#successLead');
    const statusEl = qs('#successStatus');
    const orderIdEl = qs('#successOrderId');
    const orderDateEl = qs('#successOrderDate');
    const customerEl = qs('#successCustomer');
    const totalEl = qs('#successTotal');
    const itemsEl = qs('#successItems');
    if(!titleEl || !leadEl || !statusEl || !orderIdEl || !orderDateEl || !customerEl || !totalEl || !itemsEl) return;

    const isActiveToken = () => token === pageRequestToken;
    const renderSummary = (order) => {
      if(!order || !isActiveToken()) return;
      const paid = order.status === 'paid_pending_delivery';
      titleEl.textContent = paid ? 'Pago confirmado' : 'Pago recibido';
      if(paid){
        leadEl.textContent = 'Nuestro equipo enviará todo el material y la licencia por email una vez revise tu pedido.';
      }else{
        leadEl.textContent = 'Hemos recibido tu compra y estamos terminando de preparar el pedido para enviártelo por email.';
      }
      statusEl.textContent = customerOrderStatus(order);
      orderIdEl.textContent = order.id || '-';
      orderDateEl.textContent = order.createdAt ? new Date(order.createdAt).toLocaleString('es-ES') : '-';
      customerEl.textContent = order.customer?.email || '-';
      totalEl.textContent = fmtEUR(order.total || 0);
      itemsEl.innerHTML = (order.items || []).map(item => `
        <div class="card" style="padding:16px;border-radius:20px;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
            <div>
              <div class="beat-title">${esc(item.beatTitleSnapshot)}</div>
              <div class="beat-meta">${esc(licenseName(item.licenseType))}</div>
            </div>
            <div class="beat-title">${fmtEUR(item.unitPriceSnapshot)}</div>
          </div>
        </div>
      `).join('');
    };

    const chooseBestOrder = (primary, secondary) => {
      if(!primary) return secondary || null;
      if(!secondary) return primary;
      if(primary.status === 'paid_pending_delivery' && secondary.status !== 'paid_pending_delivery') return primary;
      if(secondary.status === 'paid_pending_delivery' && primary.status !== 'paid_pending_delivery') return secondary;
      const primaryScore = Number(Boolean(primary.customer?.email)) + Number((primary.items || []).length > 0);
      const secondaryScore = Number(Boolean(secondary.customer?.email)) + Number((secondary.items || []).length > 0);
      return secondaryScore > primaryScore ? secondary : primary;
    };

    const loadSummary = async (attempt = 0) => {
      if(!isActiveToken()) return;
      if(!sessionId && !orderId){
        leadEl.textContent = 'No hemos podido recuperar tu pedido todavía. Si ya se ha realizado el cargo, recarga la página o contacta con nuestro equipo.';
        return;
      }
      try{
        let confirmedOrder = null;
        if(sessionId){
          const confirmRes = await withRetry(() => fetchWithTimeout(apiUrl('/api/orders/confirm'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, sessionId })
          }, 9000), 4, 1400);
          if(!isActiveToken()) return;
          const confirmData = await confirmRes.json();
          if(confirmData?.order?.id){
            orderId = confirmData.order.id;
            saveLastOrderId(orderId);
            renderSummary(confirmData.order);
          }
          if(confirmData?.order){
            confirmedOrder = confirmData.order;
          }
        }

        if(!orderId){
          throw new Error('No se pudo resolver el pedido desde la sesión de pago');
        }

        const summaryRes = await withRetry(
          () => fetchWithTimeout(
            apiUrl(`/api/orders/${encodeURIComponent(orderId)}/summary?session_id=${encodeURIComponent(sessionId)}`),
            {},
            9000
          ),
          4,
          1400
        );
        if(!isActiveToken()) return;
        const summaryData = await summaryRes.json();
        if(!summaryRes.ok){
          if(confirmedOrder){
            renderSummary(confirmedOrder);
            if(confirmedOrder?.status === 'paid_pending_delivery'){
              Cart.clear();
              return;
            }
          }
          throw new Error(summaryData?.error || 'No se pudo cargar el pedido');
        }

        const finalOrder = chooseBestOrder(confirmedOrder, summaryData.order);
        if(!finalOrder){
          throw new Error('No se recibieron datos del pedido');
        }
        renderSummary(finalOrder);
        if(finalOrder?.status === 'paid_pending_delivery'){
          Cart.clear();
          return;
        }
        if(finalOrder?.status === 'pending_checkout' && attempt < MAX_SUCCESS_RETRIES){
          await wait(1400 * (attempt + 1));
          return loadSummary(attempt + 1);
        }
      }catch(err){
        console.error(err);
        if(!isActiveToken()) return;
        if(attempt < MAX_SUCCESS_RETRIES){
          await wait(1600 * (attempt + 1));
          return loadSummary(attempt + 1);
        }
        leadEl.textContent = 'Estamos terminando de preparar tu pedido. Si este mensaje persiste, recarga la página dentro de unos segundos o contacta con nuestro equipo.';
      }
    };

    loadSummary();
  };

  const initPage = () => {
    cleanupPage();
    syncShellUi();
    const token = ++pageRequestToken;
    const page = document.body.dataset.page;

    if(page === 'catalog') initCatalogPage();
    if(page === 'beat') initBeatPage();
    if(page === 'licenses') initLicensesPage();
    if(page === 'cart') initCartPage();
    if(page === 'success') initSuccessPage(token);
  };

  const updateDocumentMeta = (nextDoc) => {
    if(nextDoc.title) document.title = nextDoc.title;
    const nextDescription = nextDoc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const currentDescription = qs('meta[name="description"]');
    if(currentDescription && nextDescription){
      currentDescription.setAttribute('content', nextDescription);
    }
  };

  const replacePageShell = (nextDoc) => {
    const nextHeader = nextDoc.querySelector('.header');
    const nextMain = nextDoc.querySelector('.main');
    const nextFooter = nextDoc.querySelector('.footer');
    const currentHeader = qs('.header');
    const currentMain = qs('.main');
    const currentFooter = qs('.footer');

    if(nextHeader && currentHeader) currentHeader.replaceWith(nextHeader);
    if(nextMain && currentMain) currentMain.replaceWith(nextMain);
    if(nextFooter && currentFooter) currentFooter.replaceWith(nextFooter);
    if(nextDoc.body?.dataset?.page) document.body.dataset.page = nextDoc.body.dataset.page;
  };

  const isInternalPageLink = (href) => {
    const url = new URL(href, window.location.href);
    if(url.origin !== window.location.origin) return false;
    if(url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return false;
    const pathname = url.pathname || '/';
    return pathname.endsWith('.html') || pathname === '/' || pathname === '/index.html';
  };

  const navigateToPage = async (href, { replaceHistory = false } = {}) => {
    const url = new URL(href, window.location.href);
    if(!isInternalPageLink(url.href)){
      window.location.href = url.href;
      return;
    }

    if(navigationInFlight) {
      try{ navigationInFlight.abort(); }catch{}
    }
    const controller = new AbortController();
    navigationInFlight = controller;

    try{
      const response = await fetch(url.href, {
        headers: { 'X-Requested-With': 'arikara-shell' },
        signal: controller.signal
      });
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if(controller !== navigationInFlight) return;

      const parser = new DOMParser();
      const nextDoc = parser.parseFromString(html, 'text/html');
      if(!nextDoc.querySelector('.main')) throw new Error('Documento HTML incompleto');

      replacePageShell(nextDoc);
      updateDocumentMeta(nextDoc);
      if(replaceHistory){
        history.replaceState({}, '', url.href);
      }else if(url.href !== window.location.href){
        history.pushState({}, '', url.href);
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      initPage();
    }catch(err){
      if(err.name === 'AbortError') return;
      console.error('[navigation]', err);
      window.location.href = url.href;
    }finally{
      if(navigationInFlight === controller){
        navigationInFlight = null;
      }
    }
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if(!link) return;
    if(event.defaultPrevented || event.button !== 0) return;
    if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if(link.target && link.target !== '_self') return;
    const href = link.getAttribute('href');
    if(!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
    if(link.hasAttribute('download')) return;
    if(!isInternalPageLink(link.href)) return;
    event.preventDefault();
    navigateToPage(link.href);
  });

  window.addEventListener('popstate', () => {
    navigateToPage(window.location.href, { replaceHistory: true });
  });

  initPage();
})();
