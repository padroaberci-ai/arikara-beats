(function(){
  const state = window.ARIKARA || { beats: [], licenses: [], services: [], genres: [] };
  const STORAGE_KEY = 'arikara_cart_v2';
  const LAST_ORDER_KEY = 'arikara_last_order_v1';
  const PLAYER_STATE_KEY = 'arikara_player_state_v1';
  const PLAYER_SESSION_KEY = 'arikara_player_session_v1';
  const API_BASE = (() => {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return window.ARIKARA_API_BASE || (isLocal ? '' : 'https://arikara-beats-api.onrender.com');
  })();

  const qs = (sel, scope=document) => scope.querySelector(sel);
  const qsa = (sel, scope=document) => Array.from(scope.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const apiUrl = (path) => `${API_BASE}${path}`;
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
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
    total: () => loadCart().reduce((sum, i) => sum + Number(i.price || 0), 0)
  };

  const year = new Date().getFullYear();
  qsa('[data-year]').forEach(el => el.textContent = year);

  const badge = qs('#cartBadge');
  const updateBadge = () => {
    if(!badge) return;
    const count = loadCart().length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  };
  updateBadge();
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
  const playerPrev = qs('#playerPrev');
  const playerNext = qs('#playerNext');
  const playerBack = qs('#playerBack');
  const playerForward = qs('#playerForward');
  const playerVolume = qs('#playerVolume');

  let previewButton = null;
  let previewButtonTarget = null;

  const PLAY_ICON = '<polygon points="8,5 19,12 8,19" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>';
  const PAUSE_ICON = '<line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const COVER_PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PLAY_ICON + '</svg>';
  const COVER_PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">' + PAUSE_ICON + '</svg>';
  const COVER_NO_SVG = '<span>!</span>';

  const formatTime = (t) => {
    if(!Number.isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const updateToggleIcon = () => {
    if(!playerToggleIcon) return;
    playerToggleIcon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
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
    document.body.classList.toggle('player-active', visible);
  };

  const syncPlayUI = () => {
    updateToggleIcon();
    updateCoverIcons();
    updatePreviewButton();
    if(playerRoot) playerRoot.classList.toggle('is-playing', playing);
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
      beatIndex: currentBeatIndex
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
    if(Number.isFinite(stored.time)) pendingSeek = stored.time;
    if(stored.playing){
      pendingResume = true;
      tryResumePlayback();
    }else{
      setPlayerVisible(true);
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
      meta: `${beat.bpm} BPM - ${beat.key}`,
      cover: beat.cover
    }}));
    savePlayerState();
  };

  const playNext = (dir) => {
    const list = playableIndices();
    if(list.length === 0) return;
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
  document.addEventListener('click', resumeOnInteraction);
  if(playerPrev) playerPrev.addEventListener('click', () => playNext(-1));
  if(playerNext) playerNext.addEventListener('click', () => playNext(1));
  if(playerBack) playerBack.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  if(playerForward) playerForward.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
  if(playerVolume) {
    audio.volume = Number(playerVolume.value || 0.8);
    playerVolume.addEventListener('input', () => { audio.volume = Number(playerVolume.value); });
  }

  audio.addEventListener('loadedmetadata', () => {
    if(playerDuration) playerDuration.textContent = formatTime(audio.duration);
    if(pendingSeek !== null && Number.isFinite(pendingSeek)){
      audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek);
      pendingSeek = null;
    }
  });
  audio.addEventListener('timeupdate', () => {
    if(playerTime) playerTime.textContent = formatTime(audio.currentTime);
    if(playerSeek && audio.duration){ playerSeek.value = ((audio.currentTime / audio.duration) * 100).toFixed(2); }
    if(playing && Number.isFinite(audio.currentTime)){
      const sec = Math.floor(audio.currentTime);
      if(sec !== lastSavedSecond && sec % 2 === 0){
        lastSavedSecond = sec;
        savePlayerState();
      }
    }
  });
  audio.addEventListener('ended', () => playNext(1));
  window.addEventListener('beforeunload', savePlayerState);

  if(playerSeek){
    playerSeek.addEventListener('input', () => {
      if(!audio.duration) return;
      audio.currentTime = (Number(playerSeek.value) / 100) * audio.duration;
    });
  }

  const licenseName = (id) => {
    const lic = state.licenses.find(l => l.id === id);
    return lic ? lic.name : id;
  };

  // Page routing
  const page = document.body.dataset.page;

  if(page === 'catalog'){
    const list = qs('#catalogList');
    const empty = qs('#emptyState');
    const heroHighlightImg = qs('#heroHighlightImg');
    const heroHighlightTitle = qs('#heroHighlightTitle');
    const heroHighlightMeta = qs('#heroHighlightMeta');

    const search = qs('#searchInput');
    const bpmMinEl = qs('#bpmMin');
    const bpmMaxEl = qs('#bpmMax');
    const genreEl = qs('#genreSelect');
    const sortEl = qs('#sortSelect');

    const genres = (state.genres && state.genres.length)
      ? state.genres
      : [...new Set(state.beats.map(b => b.genre).filter(Boolean))].sort((a,b) => a.localeCompare(b));

    genres.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; genreEl.appendChild(o); });

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
      const list = [...beats];
      if(sort === 'price') list.sort((a,b) => (a.prices?.basic ?? 0) - (b.prices?.basic ?? 0));
      else if(sort === 'bpm') list.sort((a,b) => (a.bpm ?? 0) - (b.bpm ?? 0));
      else if(sort === 'az') list.sort((a,b) => String(a.title).localeCompare(String(b.title)));
      else list.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return list;
    };

    const renderRow = (beat) => {
      const isSold = beat.status === 'sold';
      const isUnavailable = beat.status && beat.status !== 'available';
      const statusLabel = isSold ? 'Vendido' : (isUnavailable ? 'No disponible' : 'Disponible');
      const hasPreview = Boolean(beat.preview);
      const beatIndex = state.beats.findIndex(b => b.id === beat.id);
      const tags = [...(beat.tags||[]), ...(beat.moods||[])].slice(0,5)
        .map(t => '<span class="tag">' + esc(t) + '</span>').join('');
      return `
        <article class="beat-row ${isUnavailable ? 'is-unavailable' : ''}">
          <div class="beat-cover">
            <img src="${beat.cover}" alt="Cover ${esc(beat.title)}" />
            <button class="cover-play" type="button" ${hasPreview ? '' : 'disabled'} data-index="${beatIndex}" data-preview="${beat.preview}" data-title="${esc(beat.title)}" data-meta="${beat.bpm} BPM - ${esc(beat.key)}" data-cover="${beat.cover}" aria-label="${hasPreview ? 'Reproducir preview' : 'Preview no disponible'}">
              <span class="cover-play__icon">${hasPreview ? COVER_PLAY_SVG : COVER_NO_SVG}</span>
              <span class="wave wave--cover" aria-hidden="true"><span></span><span></span><span></span></span>
            </button>
          </div>
          <div class="beat-info">
            <div class="badge">${statusLabel}</div>
            <div class="beat-title">${esc(beat.title)}</div>
            <div class="beat-meta">
              <span>${beat.bpm} BPM</span>
              <span>${esc(beat.key)}</span>
              <span>${esc(beat.genre)}</span>
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
        </article>
      `;
    };

    const render = () => {
      const q = search.value;
      const min = bpmMinEl.value === '' ? NaN : Number(bpmMinEl.value);
      const max = bpmMaxEl.value === '' ? NaN : Number(bpmMaxEl.value);
      const genre = genreEl.value;
      const sort = sortEl.value;

      const filtered = state.beats.filter(b =>
        matchesText(b, q) && matchesBpm(b, min, max) && matchesGenre(b, genre)
      );

      const sorted = sortBeats(filtered, sort);
      list.innerHTML = sorted.map(renderRow).join('');
      empty.classList.toggle('hidden', sorted.length !== 0);

      qsa('.cover-play[data-index]').forEach(btn => {
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

      qsa('[data-add]').forEach(btn => {
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
    [search, bpmMinEl, bpmMaxEl, genreEl, sortEl].forEach(el => {
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
  }

  if(page === 'beat'){
    const slug = new URLSearchParams(window.location.search).get('beat');
    const beatIndex = state.beats.findIndex(b => b.slug === slug);
    const beat = state.beats[beatIndex];
    if(!beat) return;
    const beatUnavailable = beat.status && beat.status !== 'available';

    qs('#beatTitle').textContent = beat.title;
    qs('#beatMeta').textContent = beat.bpm + ' BPM - ' + beat.key + ' - ' + beat.genre;
    qs('#coverImg').src = beat.cover;
    qs('#coverImg').alt = 'Cover ' + beat.title;

    const tags = [...(beat.tags||[]), ...(beat.moods||[])];
    qs('#tagRow').innerHTML = tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('');

    const previewBtn = qs('#previewBtn');
    const coverPlayBtn = qs('#beatCoverPlay');
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

    const licenseWrap = qs('#licenseOptions');
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
    const addBtn = qs('#addToCartBtn');
    const updateAdd = () => {
      if(beatUnavailable){
        addBtn.disabled = true;
        addBtn.textContent = beat.status === 'sold' ? 'Beat vendido' : 'No disponible';
        return;
      }
      const lic = state.licenses.find(l => l.id === selected);
      if(!lic) return;
      const priceLabel = lic.priceLabel || fmtEUR(lic.price);
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
        if(selected === 'exclusive'){
          addBtn.textContent = 'Consultar Exclusive';
        }
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


  }

  if(page === 'licenses'){
    const licGrid = qs('#licensesGrid');
    const servGrid = qs('#servicesGrid');

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
  }

  if(page === 'cart'){
    const listEl = qs('#cartList');
    const emptyEl = qs('#cartEmpty');
    const totalEl = qs('#cartTotal');

    const render = () => {
      const cart = Cart.get();
      emptyEl.classList.toggle('hidden', cart.length !== 0);
      if(cart.length === 0){ listEl.innerHTML = ''; totalEl.textContent = '-'; return; }

      listEl.innerHTML = cart.map((item, idx) => `
        <div class="card" style="padding: 18px; border-radius: 22px;">
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <div>
              <div class="beat-title">${esc(item.title)}</div>
              <div class="beat-meta">${esc(licenseName(item.license))}</div>
            </div>
            <div style="text-align:right;">
              <div class="beat-title">${fmtEUR(item.price)}</div>
              <button class="btn btn--ghost btn--sm" data-remove="${idx}">Eliminar</button>
            </div>
          </div>
        </div>
      `).join('');

      totalEl.textContent = fmtEUR(Cart.total());
      qsa('[data-remove]').forEach(btn => btn.addEventListener('click', () => Cart.remove(Number(btn.dataset.remove))));
    };

    render();
    document.addEventListener('cart:update', render);

    qs('#clearBtn').addEventListener('click', () => Cart.clear());
    qs('#checkoutBtn').addEventListener('click', async () => {
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
  }

  if(page === 'success'){
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id') || '';
    const storedOrderId = localStorage.getItem(LAST_ORDER_KEY) || '';
    let orderId = sessionId ? '' : storedOrderId;
    const MAX_SUCCESS_RETRIES = 8;

    const titleEl = qs('#successTitle');
    const leadEl = qs('#successLead');
    const statusEl = qs('#successStatus');
    const orderIdEl = qs('#successOrderId');
    const orderDateEl = qs('#successOrderDate');
    const customerEl = qs('#successCustomer');
    const totalEl = qs('#successTotal');
    const itemsEl = qs('#successItems');

    const renderSummary = (order) => {
      if(!order) return;
      const paid = order.status === 'paid_pending_delivery';
      if(titleEl) titleEl.textContent = paid ? 'Pago confirmado' : 'Estamos confirmando tu pago';
      if(leadEl){
        if(paid && order.degradedMode){
          leadEl.textContent = 'Stripe ha marcado tu pago como completado y ya hemos registrado el pedido. Como el webhook firmado todavía no está activado, esta confirmación se ha hecho en modo controlado desde el retorno del checkout. El equipo te enviará manualmente el material por email.';
        }else if(paid){
          leadEl.textContent = 'Hemos recibido tu compra correctamente. El equipo te enviará manualmente el material y la licencia por email.';
        }else{
          leadEl.textContent = 'Tu pago ha sido recibido. Estamos terminando de confirmarlo para preparar el envío manual del material.';
        }
      }
      if(statusEl) statusEl.textContent = order.paymentObserved && order.degradedMode ? 'paid_pending_delivery (modo degradado)' : order.status;
      if(orderIdEl) orderIdEl.textContent = order.id || '-';
      if(orderDateEl) orderDateEl.textContent = order.createdAt ? new Date(order.createdAt).toLocaleString('es-ES') : '-';
      if(customerEl) customerEl.textContent = order.customer?.email || '-';
      if(totalEl) totalEl.textContent = fmtEUR(order.total || 0);
      if(itemsEl){
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
      }
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
      if(!sessionId && !orderId){
        if(leadEl){
          leadEl.textContent = 'No hemos podido recuperar la referencia del pago. Si ya se ha realizado el cargo, contacta con el equipo para verificarlo.';
        }
        return;
      }
      try{
        let confirmedOrder = null;
        if(sessionId){
          const confirmRes = await withRetry(() => fetch(apiUrl('/api/orders/confirm'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, sessionId })
          }), 4, 1400);
          const confirmData = await confirmRes.json();
          if(confirmData?.order?.id){
            orderId = confirmData.order.id;
            saveLastOrderId(orderId);
            renderSummary(confirmData.order);
          }
          if(confirmRes.status >= 500){
            throw new Error(confirmData?.error || 'No se pudo confirmar el pedido');
          }
          if(confirmRes.ok && confirmData?.order){
            confirmedOrder = confirmData.order;
          }
        }

        if(!orderId){
          throw new Error('No se pudo resolver el pedido desde la sesión de Stripe');
        }

        const summaryRes = await withRetry(
          () => fetch(apiUrl(`/api/orders/${encodeURIComponent(orderId)}/summary?session_id=${encodeURIComponent(sessionId)}`)),
          4,
          1400
        );
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
        if(attempt < MAX_SUCCESS_RETRIES){
          await wait(1600 * (attempt + 1));
          return loadSummary(attempt + 1);
        }
        if(leadEl){
          leadEl.textContent = 'Estamos terminando de confirmar tu compra con Stripe. Si este mensaje persiste, vuelve a cargar la página en unos segundos o contacta con el equipo.';
        }
      }
    };

    loadSummary();
  }
})();
