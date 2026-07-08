/* Hutzenthaler Wedding – Foto-Portal
   Vanilla JS + Supabase (Auth + Storage + RPC)
   Zugriff nur mit Passwort: Gast oder Admin (gemeinsames Konto-Modell). */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ttlvnxjlorejwntxxxzt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bHZueGpsb3JlandudHh4eHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NjM5MjgsImV4cCI6MjA5OTAzOTkyOH0.B9OtpkmV7qNs6CK0EVzRNJcPtzBHNrj9NwN4repfXlI';
const BUCKET = 'wedding';
const ADMIN_EMAIL = 'admin@hochzeit.local';
const GUEST_EMAIL = 'gast@hochzeit.local';
const GUEST_UPLOAD_SLUG = 'gaesteupload';
const NO_UPLOAD_SLUGS = ['fotobox'];
const URL_TTL = 60 * 60 * 24; // signierte URLs: 24h

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = document.getElementById('app');
const lightbox = document.getElementById('lightbox');
const lbStage = document.getElementById('lb-stage');
const lbCounter = document.getElementById('lb-counter');
const lbDownload = document.getElementById('lb-download');
const btnNewAlbum = document.getElementById('btn-new-album');
const btnLogout = document.getElementById('btn-logout');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];

let session = null;
let isAdmin = false;
let albumsCache = null;
let currentMedia = [];
let lbIndex = 0;
let transformsBroken = false;
const urlCache = new Map(); // path bzw. path#w<width> -> signierte URL

/* ---------------- helpers ---------------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const extOf = (name) => name.split('.').pop().toLowerCase();
const isImage = (name) => IMAGE_EXT.includes(extOf(name));
const isVideo = (name) => VIDEO_EXT.includes(extOf(name));

function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/* ---------------- signierte URLs ---------------- */

async function signPaths(paths) {
  const missing = [...new Set(paths)].filter((p) => !urlCache.has(p));
  const chunks = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, URL_TTL);
    if (error) throw error;
    (data || []).forEach((d) => { if (d.signedUrl) urlCache.set(d.path, d.signedUrl); });
  }));
}

function originalUrl(path) {
  return urlCache.get(path);
}

// Vorgenerierte Thumbnails: thumbs/<album>/<datei>.jpg
const thumbPathOf = (path) => `thumbs/${path}.jpg`;
const preThumb = (path) => urlCache.get(thumbPathOf(path)) || null;

async function thumbUrl(path, width) {
  if (transformsBroken || !isImage(path)) return originalUrl(path);
  const key = `${path}#w${width}`;
  if (urlCache.has(key)) return urlCache.get(key);
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, URL_TTL, { transform: { width, quality: 78 } });
  if (error || !data?.signedUrl) return originalUrl(path);
  urlCache.set(key, data.signedUrl);
  return data.signedUrl;
}

/* ---------------- daten ---------------- */

async function fetchAlbums(force = false) {
  if (albumsCache && !force) return albumsCache;
  const { data, error } = await supabase
    .from('albums')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  albumsCache = data;
  return data;
}

async function listAlbumFiles(slug) {
  const files = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(slug, {
      limit: pageSize,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) throw error;
    const batch = (data || []).filter((f) => f.id && (isImage(f.name) || isVideo(f.name)));
    files.push(...batch);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return files.map((f) => ({
    name: f.name,
    path: `${slug}/${f.name}`,
    size: f.metadata?.size || 0,
    video: isVideo(f.name),
  }));
}

/* ---------------- auth / login ---------------- */

function applySessionUi() {
  isAdmin = session?.user?.email === ADMIN_EMAIL;
  btnNewAlbum.hidden = !isAdmin;
  btnLogout.hidden = !session;
}

function renderLogin(errorMsg = '') {
  btnNewAlbum.hidden = true;
  btnLogout.hidden = true;
  app.innerHTML = `
    <section class="hero" style="padding-bottom:12px">
      <p class="hero-kicker">Korfu · 05. Juni 2026</p>
      <h1 class="hero-script">Nathalie <em>&amp;</em> Leon</h1>
      <p class="hero-sub">Das Fotoalbum unserer Hochzeit</p>
      <div class="hero-divider" aria-hidden="true"><span></span></div>
    </section>
    <form class="login-card glass" id="login-form">
      <label for="login-pw">Passwort</label>
      <input id="login-pw" type="password" placeholder="Passwort von der Einladung" autocomplete="current-password" required autofocus>
      <p class="form-error" id="login-error" role="alert" ${errorMsg ? '' : 'hidden'}>${esc(errorMsg)}</p>
      <button class="btn btn-gold" type="submit" style="width:100%;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <span>Eintreten</span>
      </button>
    </form>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('login-pw').value;
    const err = document.getElementById('login-error');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    err.hidden = true;
    let res = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: pw });
    if (res.error) res = await supabase.auth.signInWithPassword({ email: GUEST_EMAIL, password: pw });
    btn.disabled = false;
    if (res.error) {
      err.textContent = 'Falsches Passwort – bitte erneut versuchen.';
      err.hidden = false;
      return;
    }
    session = res.data.session;
    applySessionUi();
    route();
  });
}

btnLogout.addEventListener('click', async () => {
  await supabase.auth.signOut();
  session = null;
  albumsCache = null;
  urlCache.clear();
  applySessionUi();
  renderLogin();
});

/* ---------------- router ---------------- */

window.addEventListener('hashchange', route);

async function route() {
  closeLightbox();
  if (!session) { renderLogin(); return; }
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/album\/([^/]+)/);
  try {
    if (m) await renderAlbum(decodeURIComponent(m[1]));
    else await renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="state-box"><p>Etwas ist schiefgelaufen. Bitte Seite neu laden.</p></div>`;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------------- home ---------------- */

async function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <p class="hero-kicker">Korfu · 05. Juni 2026</p>
      <h1 class="hero-script">Nathalie <em>&amp;</em> Leon</h1>
      <p class="hero-sub">Alle Momente unseres schönsten Tages – von euch allen festgehalten. Schaut euch die Bilder an, ladet eure eigenen hoch und nehmt eure Lieblingsmomente mit nach Hause.</p>
      <div class="hero-divider" aria-hidden="true"><span></span></div>
    </section>
    <section class="album-grid" id="album-grid">
      ${'<div class="skeleton"></div>'.repeat(2)}
    </section>`;

  const albums = await fetchAlbums(true);
  const grid = document.getElementById('album-grid');

  if (!albums.length) {
    grid.outerHTML = `<div class="state-box"><p>Noch keine Alben vorhanden.</p></div>`;
    return;
  }

  grid.innerHTML = albums.map((a) => `
    <a class="album-card" href="#/album/${encodeURIComponent(a.slug)}" data-slug="${esc(a.slug)}">
      <div class="album-cover-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>
      </div>
      <div class="album-meta">
        <span class="album-title">${esc(a.name)}</span>
        <span class="album-count" data-count>…</span>
      </div>
    </a>`).join('');

  albums.forEach(async (a) => {
    const card = grid.querySelector(`[data-slug="${CSS.escape(a.slug)}"]`);
    if (!card) return;
    try {
      const files = await listAlbumFiles(a.slug);
      card.querySelector('[data-count]').textContent =
        files.length === 1 ? '1 Datei' : `${files.length} Dateien`;
      const cover = files.find((f) => !f.video) || files[0] || null;
      if (cover) {
        await signPaths([cover.path, thumbPathOf(cover.path)]);
        const img = new Image();
        img.className = 'album-cover';
        img.alt = '';
        const pre = preThumb(cover.path);
        img.onerror = () => { transformsBroken = true; img.onerror = null; img.src = originalUrl(cover.path); };
        img.src = pre || await thumbUrl(cover.path, 800);
        card.insertBefore(img, card.querySelector('.album-meta'));
      }
    } catch { /* Zähler bleibt "…" */ }
  });
}

/* ---------------- album ---------------- */

function canUploadTo(slug) {
  if (NO_UPLOAD_SLUGS.includes(slug)) return false;
  return isAdmin || slug === GUEST_UPLOAD_SLUG;
}

async function renderAlbum(slug) {
  activeFilter = 'all';
  const albums = await fetchAlbums();
  const album = albums.find((a) => a.slug === slug);
  if (!album) { location.hash = '#/'; return; }
  const uploadAllowed = canUploadTo(slug);

  app.innerHTML = `
    <a class="breadcrumb" href="#/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Alle Alben
    </a>
    <div class="album-head glass">
      <h2>${esc(album.name)}</h2>
      <div class="head-actions">
        ${uploadAllowed ? `
        <button class="btn" id="btn-upload" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0L8 8m4-4l4 4M5 20h14" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Fotos hochladen</span>
        </button>` : ''}
        <button class="btn btn-gold" id="btn-download-all" type="button" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Alle herunterladen</span>
        </button>
      </div>
      <p class="head-sub" id="album-sub">Wird geladen …</p>
      <div class="filter-bar" id="filter-bar" hidden>
        <button class="chip active" data-filter="all" type="button">Alle <i></i></button>
        <button class="chip" data-filter="photo" type="button">Fotos <i></i></button>
        <button class="chip" data-filter="video" type="button">Videos <i></i></button>
      </div>
    </div>
    ${uploadAllowed ? `
    <div class="upload-zone" id="upload-zone" hidden>
      <p>Dateien hierher ziehen oder auswählen – Fotos und Videos, gerne in voller Auflösung.</p>
      <button class="btn btn-gold" id="btn-pick" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>
        <span>Dateien auswählen</span>
      </button>
      <input type="file" id="file-input" multiple accept="image/*,video/*" hidden>
      <div class="upload-progress" id="upload-progress"></div>
    </div>` : ''}
    <div class="photo-grid" id="photo-grid">
      ${'<div class="skeleton"></div>'.repeat(12)}
    </div>`;

  if (uploadAllowed) {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    document.getElementById('btn-upload').addEventListener('click', () => {
      zone.hidden = !zone.hidden;
      if (!zone.hidden) zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.getElementById('btn-pick').addEventListener('click', () => input.click());
    input.addEventListener('change', () => uploadFiles(slug, [...input.files]));
    ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('dragover'); }));
    zone.addEventListener('drop', (e) => uploadFiles(slug, [...e.dataTransfer.files]));
  }

  await loadAlbumGrid(slug);
}

let albumFiles = [];
let activeFilter = 'all';

async function loadAlbumGrid(slug) {
  const sub = document.getElementById('album-sub');
  const files = await listAlbumFiles(slug);
  await signPaths([
    ...files.map((f) => f.path),
    ...files.map((f) => thumbPathOf(f.path)),
  ]);
  albumFiles = files;

  const total = files.reduce((s, f) => s + f.size, 0);
  if (sub) sub.textContent = files.length
    ? `${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'}${total ? ` · ${fmtBytes(total)}` : ''}`
    : 'Noch keine Fotos – sei die/der Erste!';

  const dlAll = document.getElementById('btn-download-all');
  if (dlAll) dlAll.disabled = !files.length;

  // Filterleiste: Zähler setzen + einmalig verdrahten
  const bar = document.getElementById('filter-bar');
  if (bar) {
    const nVideo = files.filter((f) => f.video).length;
    const counts = { all: files.length, photo: files.length - nVideo, video: nVideo };
    bar.querySelectorAll('.chip').forEach((c) => {
      c.querySelector('i').textContent = counts[c.dataset.filter];
      c.classList.toggle('active', c.dataset.filter === activeFilter);
    });
    bar.hidden = !files.length;
    if (!bar._wired) {
      bar._wired = true;
      bar.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        activeFilter = chip.dataset.filter;
        bar.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderGrid();
      });
    }
  }

  renderGrid();

  const dlBtn = document.getElementById('btn-download-all');
  if (dlBtn && !dlBtn._wired) {
    dlBtn._wired = true;
    dlBtn.addEventListener('click', () => downloadAll(slug));
  }
}

function renderGrid() {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  const files = activeFilter === 'all'
    ? albumFiles
    : albumFiles.filter((f) => (activeFilter === 'video' ? f.video : !f.video));
  currentMedia = files;

  if (!files.length) {
    grid.innerHTML = `<div class="state-box" style="grid-column:1/-1">
      <p>${activeFilter === 'video' ? 'Keine Videos in diesem Album.'
        : activeFilter === 'photo' ? 'Keine Fotos in diesem Album.'
        : 'Dieses Album wartet noch auf seine ersten Momente.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = files.map((f, i) => `
    <button class="photo-tile" data-index="${i}" type="button" aria-label="${esc(f.name)} öffnen">
      ${f.video
        ? `<span class="tile-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>`
        : ''}
    </button>`).join('');

  if (!grid._wired) {
    grid._wired = true;
    grid.addEventListener('click', (e) => {
      const tile = e.target.closest('.photo-tile');
      if (tile) openLightbox(Number(tile.dataset.index));
    });
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      if (!entry.isIntersecting) return;
      const tile = entry.target;
      io.unobserve(tile);
      const f = files[Number(tile.dataset.index)];
      if (!f) return;
      const pre = preThumb(f.path);
      if (f.video && !pre) {
        // Kein Standbild vorhanden -> Notlösung: Video-Metadaten laden
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.src = originalUrl(f.path) + '#t=0.5';
        v.addEventListener('loadeddata', () => v.classList.add('loaded'), { once: true });
        tile.prepend(v);
        return;
      }
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.onload = () => img.classList.add('loaded');
      if (pre) {
        img.onerror = async () => {
          img.onerror = () => { img.onerror = null; img.src = originalUrl(f.path); };
          img.src = await thumbUrl(f.path, 640);
        };
        img.src = pre;
      } else {
        img.onerror = () => {
          transformsBroken = true;
          img.onerror = null;
          img.src = originalUrl(f.path);
        };
        img.src = await thumbUrl(f.path, 640);
      }
      tile.prepend(img);
    });
  }, { rootMargin: '600px' });

  grid.querySelectorAll('.photo-tile').forEach((t) => io.observe(t));
}

/* ---------------- upload ---------------- */

function sanitizeFileName(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'datei';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'bin';
  return `${base}.${ext}`;
}

async function uploadOne(path, file, onProgress) {
  const { data: { session: s } } = await supabase.auth.getSession();
  if (!s) throw new Error('Nicht eingeloggt');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${s.access_token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    if (file.type) xhr.setRequestHeader('content-type', file.type);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Upload fehlgeschlagen (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
    xhr.send(file);
  });
}

// Thumbnail (max 640px JPEG) im Browser erzeugen – Foto oder Video-Standbild
function drawToJpeg(source, w, h) {
  const scale = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
}

async function makeThumb(file) {
  try {
    if (file.type.startsWith('image/')) {
      const bmp = await createImageBitmap(file);
      const blob = await drawToJpeg(bmp, bmp.width, bmp.height);
      bmp.close?.();
      return blob;
    }
    if (file.type.startsWith('video/')) {
      return await new Promise((resolve) => {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = URL.createObjectURL(file);
        let settled = false;
        const done = (blob) => {
          if (settled) return;
          settled = true;
          URL.revokeObjectURL(v.src);
          resolve(blob);
        };
        v.onerror = () => done(null);
        v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
        v.onseeked = async () => done(await drawToJpeg(v, v.videoWidth, v.videoHeight));
        setTimeout(() => done(null), 10000);
      });
    }
  } catch { /* Thumbnail ist optional */ }
  return null;
}

async function uploadFiles(slug, files) {
  if (!canUploadTo(slug)) { toast('In dieses Album kann nicht hochgeladen werden.'); return; }
  const valid = files.filter((f) => isImage(f.name) || isVideo(f.name) || f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!valid.length) { toast('Bitte nur Fotos oder Videos hochladen.'); return; }

  const progressBox = document.getElementById('upload-progress');
  progressBox.innerHTML = '';
  const rows = valid.map((f) => {
    const row = document.createElement('div');
    row.className = 'up-row';
    row.innerHTML = `
      <span class="up-name">${esc(f.name)}</span>
      <span class="up-bar"><i></i></span>
      <span class="up-status"><span class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></span></span>`;
    progressBox.appendChild(row);
    return row;
  });

  let ok = 0, fail = 0;
  for (let i = 0; i < valid.length; i++) {
    const f = valid[i];
    const bar = rows[i].querySelector('.up-bar > i');
    const status = rows[i].querySelector('.up-status');
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const path = `${slug}/${stamp}-${sanitizeFileName(f.name)}`;
    try {
      await uploadOne(path, f, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
      bar.style.width = '100%';
      status.innerHTML = `<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      ok++;
      try {
        const tb = await makeThumb(f);
        if (tb) await uploadOne(`thumbs/${path}.jpg`, new File([tb], 'thumb.jpg', { type: 'image/jpeg' }), () => {});
      } catch { /* Grid hat Fallbacks */ }
    } catch (err) {
      console.error(err);
      status.innerHTML = `<svg class="fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>`;
      fail++;
    }
  }

  toast(fail
    ? `${ok} hochgeladen, ${fail} fehlgeschlagen.`
    : `${ok} ${ok === 1 ? 'Datei' : 'Dateien'} erfolgreich hochgeladen – danke!`);
  await loadAlbumGrid(slug);
}

/* ---------------- download ---------------- */

async function downloadBlob(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function downloadAll(slug) {
  const btn = document.getElementById('btn-download-all');
  const label = btn.querySelector('span');
  const files = currentMedia;
  if (!files.length) return;

  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > 700 * 1024 * 1024) {
    const goOn = confirm(`Dieses Album ist ${fmtBytes(total)} groß. Der ZIP-Download kann den Browser überfordern – auf dem Handy lieber einzelne Bilder speichern.\n\nTrotzdem fortfahren?`);
    if (!goOn) return;
  }

  btn.disabled = true;
  try {
    const zip = new JSZip();
    for (let i = 0; i < files.length; i++) {
      label.textContent = `Lade ${i + 1} / ${files.length} …`;
      const res = await fetch(originalUrl(files[i].path));
      if (!res.ok) continue;
      zip.file(files[i].name, await res.blob(), { compression: 'STORE' });
    }
    label.textContent = 'Packe ZIP …';
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hochzeit-${slug}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    label.textContent = 'Alle herunterladen';
    toast('ZIP-Download gestartet.');
  } catch (err) {
    console.error(err);
    label.textContent = 'Alle herunterladen';
    toast('Download fehlgeschlagen – bitte erneut versuchen.');
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- lightbox / karussell ---------------- */

function openLightbox(index) {
  lbIndex = index;
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  renderLightbox();
}

function closeLightbox() {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  lbStage.innerHTML = '';
  document.body.style.overflow = '';
}

function renderLightbox() {
  const f = currentMedia[lbIndex];
  if (!f) return;
  lbCounter.textContent = `${lbIndex + 1} / ${currentMedia.length}`;
  lbStage.innerHTML = '';

  if (f.video) {
    const v = document.createElement('video');
    v.src = originalUrl(f.path);
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    lbStage.appendChild(v);
  } else {
    const img = new Image();
    img.alt = f.name;
    img.src = originalUrl(f.path); // volle Original-Auflösung
    lbStage.appendChild(img);
  }

  [lbIndex - 1, lbIndex + 1].forEach((i) => {
    const n = currentMedia[i];
    if (n && !n.video) { const pre = new Image(); pre.src = originalUrl(n.path); }
  });
}

function lbStep(dir) {
  if (!currentMedia.length) return;
  lbIndex = (lbIndex + dir + currentMedia.length) % currentMedia.length;
  renderLightbox();
}

lightbox.querySelector('.lb-close').addEventListener('click', closeLightbox);
lightbox.querySelector('.lb-prev').addEventListener('click', () => lbStep(-1));
lightbox.querySelector('.lb-next').addEventListener('click', () => lbStep(1));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target === lbStage) closeLightbox(); });
lbDownload.addEventListener('click', async () => {
  const f = currentMedia[lbIndex];
  if (!f) return;
  lbDownload.disabled = true;
  try { await downloadBlob(originalUrl(f.path), f.name); }
  catch { toast('Download fehlgeschlagen.'); }
  finally { lbDownload.disabled = false; }
});

document.addEventListener('keydown', (e) => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lbStep(-1);
  if (e.key === 'ArrowRight') lbStep(1);
});

let touchX = null;
lbStage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
lbStage.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 48) lbStep(dx > 0 ? -1 : 1);
  touchX = null;
}, { passive: true });

/* ---------------- neues Album (Admin) ---------------- */

const dlg = document.getElementById('dlg-album');
const form = document.getElementById('form-album');
const albumError = document.getElementById('album-error');

btnNewAlbum.addEventListener('click', () => {
  form.reset();
  albumError.hidden = true;
  dlg.showModal();
});
dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  albumError.hidden = true;
  const name = form.name.value.trim();
  const pin = form.pin.value;
  const submitBtn = form.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  try {
    const { data, error } = await supabase.rpc('create_album', { p_name: name, p_pin: pin });
    if (error) {
      if (error.message.includes('INVALID_PIN')) throw new Error('Falscher PIN.');
      if (error.message.includes('duplicate')) throw new Error('Ein Album mit diesem Namen existiert bereits.');
      throw new Error('Album konnte nicht angelegt werden.');
    }
    dlg.close();
    albumsCache = null;
    toast(`Album „${data.name}" wurde angelegt.`);
    location.hash = `#/album/${encodeURIComponent(data.slug)}`;
    if (location.hash === `#/album/${encodeURIComponent(data.slug)}`) route();
  } catch (err) {
    albumError.textContent = err.message;
    albumError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------------- start ---------------- */

(async () => {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  applySessionUi();
  route();
})();
