// Universe – iPhone (PWA) хувилбар.
// Компьютерийн LightNote-ын Google Drive дээрх "Universe" хавтсыг уншиж, засна.
// Сервер байхгүй: бүх зүйл утас <-> Google Drive хооронд шууд явна.
'use strict';

const CLIENT_ID = '990414814781-7lnnv5srkl3flm3luhfk2i8coidtnk3o.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const API = 'https://www.googleapis.com';
const FOLDER = 'application/vnd.google-apps.folder';
const META_DIR = '_universe';
const LEARN_MS = 8 * 60 * 1000;
const QUIZ_MS = 2 * 60 * 1000;
const STEPS = [1, 3, 7];
const MAX_REVIEW = 3;
const LEARN_HOUR = 20;

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('u.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('u.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('u.' + k); } catch {} },
};

// el('div.cls', {text, html, onclick, ...attrs}, ...children)
function el(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.');
  const e = document.createElement(t || 'div');
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== '') e.append(c);
  return e;
}
function toast(t, ms = 1800) {
  const x = el('div.toast', { text: t });
  document.body.append(x);
  setTimeout(() => x.remove(), ms);
}
function setStatus(t) { $('#status').textContent = t || ''; }
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- markdown (компьютерийнхтэй ижил: $...$ ба $$...$$ томьёо) ----------
const md = window.markdownit({
  html: true, linkify: true, breaks: false,
  highlight: (code, lang) => {
    try { if (lang && hljs.getLanguage(lang)) return '<pre class="hljs"><code>' + hljs.highlight(code, { language: lang }).value + '</code></pre>'; } catch {}
    return '';
  },
});
function render(t) {
  const keep = [];
  const put = (h) => { keep.push(h); return 'KXPH' + (keep.length - 1) + 'XK'; };
  t = String(t || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => put(katex.renderToString(m, { displayMode: true, throwOnError: false })))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, a, m) => a + put(katex.renderToString(m, { throwOnError: false })));
  const html = md.render(t).replace(/KXPH(\d+)XK/g, (_, i) => keep[+i]);
  return DOMPurify.sanitize(html, { ADD_TAGS: ['semantics', 'annotation'], ADD_ATTR: ['encoding'] });
}
const inline = (t) => render(t).replace(/^<p>|<\/p>\s*$/g, '');

// ---------- Google нэвтрэлт (redirect, утсанд хамгийн найдвартай) ----------
const REDIRECT = location.origin + location.pathname;
let token = LS.get('token', null);

function signIn(silent) {
  const nonce = Math.random().toString(36).slice(2);
  LS.set('nonce', nonce);
  LS.set('route', location.hash || '#/');
  if (silent) LS.set('silentAt', Date.now());
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state: nonce,
  });
  const email = LS.get('email', '');
  if (email) q.set('login_hint', email);
  if (silent) q.set('prompt', 'none');
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
  return new Promise(() => {}); // хуудас шилжинэ
}

// Google-ээс буцаж ирэхэд #access_token=... ирнэ
function readAuthResponse() {
  if (!/access_token=|error=/.test(location.hash)) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const route = LS.get('route', '#/');
  history.replaceState(null, '', location.pathname + route);
  if (h.get('state') !== LS.get('nonce', '')) return;
  if (h.get('access_token')) {
    token = { t: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000 - 60000 };
    LS.set('token', token);
    LS.del('silentAt');
  } else {
    token = null;
    LS.del('token');
    LS.set('authError', h.get('error'));
  }
}

async function ensureToken() {
  if (token && token.exp > Date.now()) return token.t;
  // нууцаар (prompt=none) дахин авах. Сүүлийн 30 секундэд оролдсон бол нэвтрэх товч харуулна
  if (LS.get('email', '') && Date.now() - LS.get('silentAt', 0) > 30000) return signIn(true);
  throw new Error('signin');
}

async function api(method, path, { json, body, type, raw } = {}) {
  if (!navigator.onLine) throw new Error('offline');
  const t = await ensureToken();
  const headers = { Authorization: 'Bearer ' + t };
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (type) headers['Content-Type'] = type;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 60000);
  let r;
  try { r = await fetch(API + path, { method, headers, body, signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'Drive хариу өгсөнгүй (60 сек)' : 'Сүлжээний алдаа: ' + e.message); }
  finally { clearTimeout(tm); }
  if (r.status === 401) { token = null; LS.del('token'); await ensureToken(); }
  if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (raw) return r;
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

// ---------- Drive ----------
const FIELDS = 'id,name,mimeType,parents,md5Checksum,modifiedTime,size,appProperties';
const S = { files: new Map(), kids: new Map(), root: null, meta: null };

function index(list) {
  S.files = new Map(list.map((f) => [f.id, f]));
  S.kids = new Map();
  for (const f of list) for (const p of f.parents || []) {
    if (!S.kids.has(p)) S.kids.set(p, []);
    S.kids.get(p).push(f);
  }
  const root = list.find((f) => f.mimeType === FOLDER && f.appProperties && f.appProperties.universeRoot === '1');
  S.root = root ? root.id : null;
  S.meta = root ? (S.kids.get(root.id) || []).find((f) => f.mimeType === FOLDER && f.name === META_DIR) : null;
}

async function loadAll() {
  setStatus('…');
  if (!S.root && !view.childElementCount) view.replaceChildren(el('div.msg', { text: 'Drive-аас уншиж байна…' }));
  const all = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ q: 'trashed=false', pageSize: '1000', spaces: 'drive', fields: `nextPageToken,files(${FIELDS})` });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await api('GET', '/drive/v3/files?' + q);
    all.push(...r.files);
    pageToken = r.nextPageToken;
    setStatus(all.length + '…');
  } while (pageToken);
  index(all);
  LS.set('files', all);
  setStatus('');
  if (!LS.get('email', '')) {
    try { const a = await api('GET', '/drive/v3/about?fields=user(emailAddress)'); LS.set('email', a.user.emailAddress); } catch {}
  }
}

function pathOf(f) {
  const parts = [];
  let cur = f;
  while (cur && cur.id !== S.root) { parts.unshift(cur.name); cur = S.files.get((cur.parents || [])[0]); }
  return parts.join('/');
}
function byPath(rel) {
  let cur = S.root;
  for (const name of rel.split('/').filter(Boolean)) {
    const k = (S.kids.get(cur) || []).find((f) => f.name === name);
    if (!k) return null;
    cur = k.id;
  }
  return S.files.get(cur);
}

// Файлыг md5-аар нь кэшлэнэ: интернэтгүй үед ч өмнө нээсэн файл уншигдана
async function getBlob(f) {
  const key = `/cache/${f.id}?m=${f.md5Checksum || f.modifiedTime}`;
  let cache = null;
  try { cache = await caches.open('universe-files'); } catch {}
  if (cache) { const hit = await cache.match(key); if (hit) return hit.blob(); }
  const r = await api('GET', `/drive/v3/files/${f.id}?alt=media`, { raw: true });
  const blob = await r.blob();
  if (cache) {
    try {
      for (const k of await cache.keys()) if (k.url.includes(`/cache/${f.id}?`)) await cache.delete(k);
      await cache.put(key, new Response(blob));
    } catch {}
  }
  return blob;
}
const getText = async (f) => (await getBlob(f)).text();

async function updateFile(f, text, mime) {
  const r = await api('PATCH', `/upload/drive/v3/files/${f.id}?uploadType=media&fields=${FIELDS}`, { body: text, type: mime || 'text/markdown; charset=utf-8' });
  Object.assign(f, r);
  return f;
}
async function createFile(name, parent, text, mime = 'text/markdown') {
  const b = 'univ' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${b}--`;
  const f = await api('POST', `/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`, { body, type: 'multipart/related; boundary=' + b });
  S.files.set(f.id, f);
  if (!S.kids.has(parent)) S.kids.set(parent, []);
  S.kids.get(parent).push(f);
  return f;
}
async function createFolder(name, parent) {
  const f = await api('POST', `/drive/v3/files?fields=${FIELDS}`, { json: { name, mimeType: FOLDER, parents: [parent] } });
  S.files.set(f.id, f);
  if (!S.kids.has(parent)) S.kids.set(parent, []);
  S.kids.get(parent).push(f);
  return f;
}

// ---------- дэлгэцүүд ----------
const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const TEXT = new Set(['txt', 'py', 'c', 'cpp', 'h', 'hpp', 'js', 'ts', 'json', 'java', 'cs', 'sql', 'html', 'css', 'sh', 'csv', 'xml', 'yml', 'yaml', 'go', 'rs', 'kt', 'r', 'm', 'tex']);
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
function icon(f) {
  if (f.mimeType === FOLDER) return '📁';
  const e = ext(f.name);
  if (e === 'md') return '📝';
  if (e === 'ipynb') return '📓';
  if (IMG.has(e)) return '🖼️';
  if (e === 'pdf') return '📕';
  if (['ppt', 'pptx'].includes(e)) return '📊';
  if (['doc', 'docx'].includes(e)) return '📘';
  if (['mp4', 'mov', 'mkv', 'webm'].includes(e)) return '🎬';
  return '📄';
}
const shown = (f) => !f.name.startsWith('.') && !f.name.startsWith('~') && !(f.parents && f.parents[0] === S.root && f.name === META_DIR);
const sortKids = (a) => a.filter(shown).sort((x, y) => (x.mimeType === FOLDER) !== (y.mimeType === FOLDER) ? (x.mimeType === FOLDER ? -1 : 1) : x.name.localeCompare(y.name, undefined, { numeric: true }));

let dirty = false; // засварлаж байгаа текст хадгалагдаагүй
function header(title, back) {
  $('#title').textContent = title;
  $('#back').hidden = !back;
  $('#back').onclick = () => {
    if (dirty && !confirm('Хадгалаагүй өөрчлөлт байна. Гарах уу?')) return;
    dirty = false;
    location.replace(back); // эцэг хавтас / файл руу (түүх хуримтлуулахгүй)
  };
}

function showSignIn() {
  header('Universe');
  view.replaceChildren(el('div.center', null,
    el('h1', { text: 'Universe' }),
    el('p.ln-dim', { text: 'Компьютер дээрх тэмдэглэлүүдээ Google Drive-аар дамжуулан уншиж, засна.' }),
    el('button.btn.primary', { text: 'Google-ээр нэвтрэх', onclick: () => { LS.del('silentAt'); signIn(false); } }),
    LS.get('authError', '') ? el('p.ln-warn', { text: 'Алдаа: ' + LS.get('authError') }) : ''));
}

function showFolder(id) {
  const f = S.files.get(id);
  const isRoot = id === S.root;
  header(isRoot ? 'Universe' : f ? f.name : 'Universe', isRoot ? null : '#/');
  const kids = sortKids(S.kids.get(id) || []);
  const search = el('input.search', { placeholder: 'Хайх', type: 'search' });
  const list = el('div.list');
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    const items = q ? sortKids([...S.files.values()].filter((x) => x.mimeType !== FOLDER && pathOf(x).toLowerCase().includes(q) && !pathOf(x).startsWith(META_DIR) && !pathOf(x).split('/').some((p) => p.startsWith('.')))) : kids;
    list.replaceChildren(...items.map((x) => el('div.row', { onclick: () => (location.hash = (x.mimeType === FOLDER ? '#/d/' : '#/f/') + x.id) },
      el('span.i', { text: icon(x) }),
      el('span.n', { text: q ? pathOf(x) : x.name }),
      x.mimeType === FOLDER ? el('span.chev', { text: '›' }) : el('span.m', { text: new Date(x.modifiedTime).toLocaleDateString() }))));
    if (!items.length) list.replaceChildren(el('div.empty', { text: q ? 'Олдсонгүй' : 'Хоосон хавтас' }));
  };
  search.addEventListener('input', fill);
  fill();
  const crumb = isRoot ? '' : el('div.crumb', { text: 'Universe / ' + pathOf(f) });
  const fab = el('button.fab', { text: '+', 'aria-label': 'Шинэ', onclick: () => newItem(id) });
  view.replaceChildren(search, crumb, list, fab);
}

async function newItem(parent) {
  const name = prompt('Шинэ note-ын нэр (хавтас үүсгэх бол төгсгөлд нь / тавина):', 'New note');
  if (!name || !name.trim()) return;
  try {
    if (name.trim().endsWith('/')) { await createFolder(name.trim().replace(/\/+$/, ''), parent); showFolder(parent); return; }
    const n = /\.[a-z0-9]+$/i.test(name.trim()) ? name.trim() : name.trim() + '.md';
    const f = await createFile(n, parent, '');
    location.hash = '#/e/' + f.id;
  } catch (e) { toast('Алдаа: ' + e.message, 3000); }
}

function driveLink(f) { return `https://drive.google.com/file/d/${f.id}/view`; }

async function showFile(id) {
  const f = S.files.get(id);
  if (!f) return showMsg('Файл олдсонгүй');
  header(f.name.replace(/\.md$/i, ''), '#/d/' + (f.parents || [S.root])[0]);
  const e = ext(f.name);
  view.replaceChildren(el('div.msg', { text: 'Уншиж байна…' }));
  try {
    if (e === 'md') {
      const text = await getText(f);
      const doc = el('div.doc', { html: render(text) });
      await fixImages(doc, f);
      view.replaceChildren(el('div.bar', null, el('button.btn', { text: '✎ Засах', onclick: () => (location.hash = '#/e/' + f.id) })), doc);
    } else if (e === 'ipynb') {
      const nb = JSON.parse(await getText(f));
      view.replaceChildren(el('div.bar', null,
        el('a.btn.primary', { text: 'Colab-д нээх', href: `https://colab.research.google.com/drive/${f.id}`, target: '_blank' })), renderNotebook(nb));
    } else if (IMG.has(e)) {
      const url = URL.createObjectURL(await getBlob(f));
      view.replaceChildren(el('div.doc', null, el('img', { src: url, alt: f.name })));
    } else if (TEXT.has(e)) {
      const text = await getText(f);
      let html;
      try { html = hljs.getLanguage(e) ? hljs.highlight(text, { language: e }).value : hljs.highlightAuto(text).value; } catch { html = null; }
      const code = el('code'); if (html) code.innerHTML = html; else code.textContent = text;
      view.replaceChildren(el('div.bar', null, el('button.btn', { text: '✎ Засах', onclick: () => (location.hash = '#/e/' + f.id) })), el('div.doc', null, el('pre.hljs', null, code)));
    } else {
      view.replaceChildren(el('div.center', null, el('div', { text: icon(f), style: 'font-size:56px' }), el('p', { text: f.name }),
        el('a.btn.primary', { text: 'Google Drive-д нээх', href: driveLink(f), target: '_blank' })));
    }
  } catch (err) { handleErr(err); }
}

// note доторх ".assets/img.png" зургуудыг Drive-аас татаж харуулна
async function fixImages(doc, note) {
  const dir = pathOf(note).split('/').slice(0, -1).join('/');
  await Promise.all([...doc.querySelectorAll('img')].map(async (img) => {
    const src = decodeURIComponent(img.getAttribute('src') || '');
    if (/^(https?:|data:|blob:)/.test(src)) return;
    const f = byPath(src) || byPath((dir ? dir + '/' : '') + src);
    if (!f) { img.alt = '[зураг олдсонгүй: ' + src + ']'; return; }
    try { img.src = URL.createObjectURL(await getBlob(f)); } catch {}
  }));
  for (const a of doc.querySelectorAll('a[href]')) a.target = '_blank';
}

function renderNotebook(nb) {
  const lang = (nb.metadata && (nb.metadata.language_info || {}).name) || 'python';
  const src = (s) => (Array.isArray(s) ? s.join('') : String(s || ''));
  const wrap = el('div.doc');
  for (const c of nb.cells || []) {
    const cell = el('div.cell');
    if (c.cell_type === 'markdown') { cell.innerHTML = render(src(c.source)); wrap.append(cell); continue; }
    const code = el('code');
    try { code.innerHTML = hljs.highlight(src(c.source), { language: hljs.getLanguage(lang) ? lang : 'python' }).value; } catch { code.textContent = src(c.source); }
    cell.append(el('div.lbl', { text: c.execution_count ? `In [${c.execution_count}]` : 'In [ ]' }), el('pre.hljs', null, code));
    for (const o of c.outputs || []) {
      const out = el('div.out');
      if (o.output_type === 'stream') out.textContent = src(o.text);
      else if (o.output_type === 'error') { out.classList.add('err'); out.textContent = (o.traceback || []).join('\n').replace(/\x1b\[[0-9;]*m/g, ''); }
      else if (o.data) {
        if (o.data['image/png']) out.append(el('img', { src: 'data:image/png;base64,' + src(o.data['image/png']).trim() }));
        else if (o.data['image/jpeg']) out.append(el('img', { src: 'data:image/jpeg;base64,' + src(o.data['image/jpeg']).trim() }));
        else if (o.data['text/html']) { out.style.whiteSpace = 'normal'; out.innerHTML = DOMPurify.sanitize(src(o.data['text/html'])); }
        else if (o.data['text/latex']) out.innerHTML = render(src(o.data['text/latex']));
        else out.textContent = src(o.data['text/plain']);
      }
      cell.append(out);
    }
    wrap.append(cell);
  }
  return wrap;
}

async function showEdit(id) {
  const f = S.files.get(id);
  if (!f) return showMsg('Файл олдсонгүй');
  header('✎ ' + f.name, '#/f/' + id);
  view.replaceChildren(el('div.msg', { text: 'Уншиж байна…' }));
  let text = '';
  try { text = await getText(f); } catch (e) { return handleErr(e); }
  const ta = el('textarea.edit', { spellcheck: 'false', autocapitalize: 'off' });
  ta.value = text;
  dirty = false;
  const save = el('button.btn.primary', { text: 'Хадгалах', disabled: true });
  ta.addEventListener('input', () => { dirty = ta.value !== text; save.disabled = !dirty; });
  save.onclick = async () => {
    save.disabled = true;
    save.textContent = 'Хадгалж байна…';
    try {
      await updateFile(f, ta.value, ext(f.name) === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
      text = ta.value;
      dirty = false;
      toast('Хадгаллаа ✓ Компьютер дээр хэдэн минутын дараа шинэчлэгдэнэ');
      location.replace('#/f/' + f.id);
    } catch (e) { toast('Хадгалж чадсангүй: ' + e.message, 3500); save.disabled = false; }
    save.textContent = 'Хадгалах';
  };
  view.replaceChildren(el('div.bar', null, save, el('button.btn', { text: 'Болих', onclick: () => $('#back').onclick() })), ta);
}

function showMsg(t) { header('Universe', '#/'); view.replaceChildren(el('div.msg', { text: t })); }

function handleErr(e) {
  if (e.message === 'signin') return showSignIn();
  if (e.message === 'offline') return showMsg('Интернэт алга. Өмнө нь нээсэн файлууд л харагдана.');
  showMsg('Алдаа: ' + e.message);
}

// ---------- өдрийн хичээл (компьютерийнхтэй ижил learn.json) ----------
function mergeLearn(a = {}, b = {}) {
  const done = { ...(b.done || {}) };
  for (const [id, d] of Object.entries(a.done || {})) if (!done[id] || (d.date || '') >= (done[id].date || '')) done[id] = d;
  const rev = new Map();
  for (const r of [...(b.reviews || []), ...(a.reviews || [])]) {
    const k = r.lid + '#' + r.qi;
    const o = rev.get(k);
    if (!o || (r.due || '') > (o.due || '')) rev.set(k, r);
  }
  const lastA = a.lastDay || '', lastB = b.lastDay || '';
  const newer = lastA >= lastB ? a : b;
  return { ...b, ...a, done, reviews: [...rev.values()], lastDay: newer.lastDay, streak: newer.streak || 0, skipDate: newer.skipDate, snoozeUntil: newer.snoozeUntil };
}

const L = {
  lessons: [], p: { done: {}, reviews: [] }, loaded: false,
  async load() {
    if (!S.meta) { this.lessons = []; return; }
    const metaKids = S.kids.get(S.meta.id) || [];
    const lf = metaKids.find((f) => f.name === 'learn.json');
    const dir = metaKids.find((f) => f.mimeType === FOLDER && f.name === 'lessons');
    const files = dir ? (S.kids.get(dir.id) || []).filter((f) => /\.json$/i.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1)) : [];
    const lessons = [], seen = new Set();
    for (const f of files) {
      try { for (const l of JSON.parse(await getText(f)).lessons || []) if (l && l.id && !seen.has(l.id)) { seen.add(l.id); lessons.push(l); } } catch {}
    }
    this.lessons = lessons;
    let p = {};
    if (lf) { try { p = JSON.parse(await getText(lf)); } catch {} }
    p = mergeLearn(LS.get('learnLocal', {}), p); // интернэтгүй үед хийсэн хичээл
    p.done = p.done || {}; p.reviews = p.reviews || [];
    this.p = p;
    this.loaded = true;
  },
  async save() {
    LS.set('learnLocal', this.p);
    try {
      await loadAll();
      const lf = (S.kids.get(S.meta.id) || []).find((f) => f.name === 'learn.json');
      let remote = {};
      if (lf) { try { remote = JSON.parse(await (await api('GET', `/drive/v3/files/${lf.id}?alt=media`, { raw: true })).text()); } catch {} }
      const merged = mergeLearn(this.p, remote);
      const out = JSON.stringify(merged, null, 1);
      if (lf) await updateFile(lf, out, 'application/json'); else await createFile('learn.json', S.meta.id, out, 'application/json');
      this.p = merged;
      LS.del('learnLocal');
    } catch (e) { toast('Интернэт орж ирэхэд хадгална'); }
    paintDot();
  },
  byId(id) { return this.lessons.find((l) => l.id === id); },
  daily() { return this.lessons.filter((l) => l.kind !== 'note'); },
  next() { return this.daily().find((l) => !this.p.done[l.id]); },
  remaining() { return this.daily().filter((l) => !this.p.done[l.id]).length; },
  doneToday() { const t = dayKey(); return Object.entries(this.p.done).some(([id, d]) => d.date === t && !(this.byId(id) || {}).kind); },
  pending() { return this.loaded && !this.doneToday() && !!this.next(); },
  due() { const t = dayKey(); return (this.p.reviews || []).filter((r) => r.due <= t && this.byId(r.lid) && this.byId(r.lid).quiz[r.qi]); },
};
let timer = null, rec = null;
const stopTimer = () => { if (timer) clearInterval(timer); timer = null; };
const stopRec = () => { try { if (rec && rec.state === 'recording') rec.stop(); } catch {} };
function paintDot() { $('#learnBtn').classList.toggle('dot', L.pending()); }

async function showLearn(mode) {
  header('Өдрийн хичээл', '#/');
  stopTimer(); stopRec();
  if (!L.loaded) { view.replaceChildren(el('div.msg', { text: 'Уншиж байна…' })); try { await L.load(); } catch (e) { return handleErr(e); } }
  const l = L.next();
  const box = el('div.center');
  if (!S.meta || !L.lessons.length) box.append(el('p', { text: 'Хичээл олдсонгүй. Компьютер дээрээ LightNote-ыг нээж sync хийнэ үү.' }));
  else if (!l) box.append(el('h2', { text: 'Бүх хичээл дууслаа 🎉' }), el('p.ln-dim', { text: 'Компьютер дээрээ шинэ хичээлийн файл нэмээрэй.' }));
  else {
    if (L.doneToday()) box.append(el('div.ln-ok', { text: '✓ Өнөөдрийн хичээлээ хийсэн байна' }));
    box.append(el('div.ln-sub', { text: l.subject }), el('h2', { text: l.title }),
      el('p.ln-dim', { text: `${l.cards.length} карт · 8 минут, дараа нь ${l.quiz.length + Math.min(MAX_REVIEW, L.due().length)} асуулт · 2 минут` }),
      el('div.bar', { style: 'justify-content:center' },
        el('button.btn.primary', { text: L.doneToday() ? 'Дараагийн хичээл' : 'Эхлэх', onclick: () => startLesson(l) }),
        mode === 'auto' ? el('button.btn', { text: '30 минутын дараа', onclick: () => { L.p.snoozeUntil = Date.now() + 30 * 60000; L.save(); location.hash = '#/'; } }) : '',
        mode === 'auto' ? el('button.btn', { text: 'Өнөөдөр алгасах', onclick: () => { L.p.skipDate = dayKey(); L.save(); location.hash = '#/'; } }) : ''));
    const n = L.remaining();
    if (n <= 7) box.append(el('div.ln-warn', { text: `${n} хоногийн хичээл үлдлээ.` }));
  }
  if (L.p.streak) box.append(el('p.ln-dim', { text: `🔥 ${L.p.streak} хоног дараалан` }));
  box.append(el('p', null, el('button.btn', { text: 'Түүх', onclick: showHistory })));
  view.replaceChildren(box);
}

let LS_state = {};
function startLesson(l, review = false) {
  LS_state = { l, review, ci: 0, endAt: Date.now() + LEARN_MS };
  stopTimer();
  if (!review) timer = setInterval(tickLearn, 500);
  renderCard();
}
function tickLearn() {
  const t = $('.ln-time');
  if (!t) return;
  const left = LS_state.endAt - Date.now();
  t.textContent = left > 0 ? mmss(left) : 'Quiz-ийн цаг боллоо';
  t.classList.toggle('due', left <= 0);
}
function renderCard() {
  stopRec();
  const { l, review, ci } = LS_state;
  const c = l.cards[ci];
  header(l.subject, '#/learn');
  const head = el('div.ln-head', null, el('div.t', { text: l.title }), review ? '' : el('div.ln-time'));
  const card = el('div.ln-card', null, el('div.ln-card-title', { text: c.title || '' }));
  if (c.type === 'speak') card.append(speakCard(c));
  else card.append(el('div.doc', { style: 'padding:0;background:none', html: render(c.body) }));
  const last = ci === l.cards.length - 1;
  const go = (i) => { LS_state.ci = i; renderCard(); };
  const dots = el('div.ln-dots', null, l.cards.map((_, i) => el('span' + (i === ci ? '.on' : i < ci ? '.seen' : ''))));
  const nav = el('div.ln-nav', null,
    el('button.btn', { text: '←', disabled: ci === 0, onclick: () => go(ci - 1) }),
    dots,
    last ? (review ? el('button.btn.primary', { text: 'Түүх', onclick: showHistory }) : el('button.btn.primary', { text: 'Quiz →', onclick: startQuiz }))
      : el('button.btn.primary', { text: '→', onclick: () => go(ci + 1) }));
  view.replaceChildren(head, card, nav, !last && !review ? el('p', { style: 'text-align:center' }, el('button.btn', { text: 'Шууд quiz руу', onclick: startQuiz })) : '');
  // хуруугаар зүүн/баруун тийш шудрах
  let x0 = null;
  card.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -60 && !last) go(ci + 1); else if (dx > 60 && ci > 0) go(ci - 1);
  });
  tickLearn();
  window.scrollTo(0, 0);
}
function speakCard(c) {
  const wrap = el('div.ln-speak');
  wrap.append(el('ol', null, (c.prompts || []).map((q) => el('li', { text: q }))));
  if (c.tip) wrap.append(el('div.ln-dim', { text: c.tip }));
  const audio = el('audio', { controls: true, hidden: true });
  const sample = el('div.ln-sample', { hidden: true, html: render(c.sample || '') });
  const btn = el('button.btn.rec', { text: '● Бичүүлэх' });
  btn.onclick = async () => {
    if (rec && rec.state === 'recording') return stopRec();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audio.src = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        audio.hidden = false;
        btn.textContent = '● Дахин бичүүлэх'; btn.classList.remove('on');
      };
      rec.start();
      btn.textContent = '■ Зогсоох'; btn.classList.add('on');
    } catch { btn.textContent = 'Микрофон зөвшөөрөгдөөгүй'; }
  };
  wrap.append(el('div.bar', null, btn, el('button.btn', { text: 'Жишээ хариулт', onclick: () => (sample.hidden = !sample.hidden) })), audio, sample);
  return wrap;
}

function startQuiz() {
  stopTimer(); stopRec();
  const l = LS_state.l;
  const items = l.quiz.map((q, qi) => ({ lid: l.id, qi, q }));
  for (const r of L.due().slice(0, MAX_REVIEW)) items.push({ lid: r.lid, qi: r.qi, q: L.byId(r.lid).quiz[r.qi], review: r });
  const answers = new Array(items.length).fill(-1);
  const end = Date.now() + QUIZ_MS;
  header('Quiz', '#/learn');
  const time = el('div.ln-time');
  const list = el('div');
  items.forEach((it, i) => list.append(el('div.ln-q', null,
    el('div.ln-q-title', null, el('b', { text: i + 1 + '. ' }), it.review ? el('span.ln-tag', { text: 'Давтлага' }) : '', el('span', { html: inline(it.q.q) })),
    it.q.options.map((o, oi) => el('label.ln-opt', null, el('input', { type: 'radio', name: 'q' + i, onchange: () => (answers[i] = oi) }), el('span', { html: inline(o) }))))));
  const submit = el('button.btn.primary', { text: 'Шалгах' });
  let finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    stopTimer();
    const t = dayKey();
    let score = 0, total = 0;
    const qs = list.querySelectorAll('.ln-q');
    items.forEach((it, i) => {
      const ok = answers[i] === it.q.answer;
      const box = qs[i];
      box.classList.add(ok ? 'right' : 'wrong');
      box.querySelectorAll('input').forEach((x) => (x.disabled = true));
      const labels = box.querySelectorAll('.ln-opt');
      if (labels[it.q.answer]) labels[it.q.answer].classList.add('correct');
      if (!ok && answers[i] >= 0 && labels[answers[i]]) labels[answers[i]].classList.add('chosen');
      box.append(el('div.ln-explain', { html: (ok ? '✓ ' : answers[i] < 0 ? '— Хариулаагүй. ' : '✗ ') + render(it.q.explain || '') }));
      const key = (r) => r.lid === it.lid && r.qi === it.qi;
      let r = L.p.reviews.find(key);
      if (!it.review) { total++; if (ok) score++; }
      if (ok) {
        if (r) { r.step = (r.step || 0) + 1; if (r.step >= STEPS.length) L.p.reviews = L.p.reviews.filter((x) => !key(x)); else r.due = addDays(t, STEPS[r.step]); }
      } else {
        if (!r) { r = { lid: it.lid, qi: it.qi }; L.p.reviews.push(r); }
        r.step = 0; r.due = addDays(t, STEPS[0]);
      }
    });
    if (!l.kind && L.p.lastDay !== t) { L.p.streak = L.p.lastDay === addDays(t, -1) ? (L.p.streak || 0) + 1 : 1; L.p.lastDay = t; }
    L.p.done[l.id] = { date: t, score, total, answers: answers.slice(0, l.quiz.length) };
    L.save();
    time.textContent = `${score} / ${total}`;
    view.prepend(el('div.center', { style: 'padding:16px' }, el('h2', { text: `${score} / ${total} зөв` }), el('div.ln-dim', { text: `🔥 ${L.p.streak} хоног · ${L.remaining()} хичээл үлдсэн` })));
    submit.textContent = 'Дуусгах';
    submit.onclick = () => (location.hash = '#/');
    window.scrollTo(0, 0);
  };
  submit.onclick = finish;
  view.replaceChildren(el('div.ln-head', null, el('div.t', { text: l.title }), time), list, el('div.ln-nav', null, el('div'), submit));
  const tick = () => { const left = end - Date.now(); time.textContent = mmss(left); time.classList.toggle('due', left < 20000); if (left <= 0) finish(); };
  tick();
  timer = setInterval(tick, 300);
  window.scrollTo(0, 0);
}

function showHistory() {
  stopTimer(); stopRec();
  header('Түүх', '#/learn');
  const rows = Object.entries(L.p.done).map(([id, d]) => ({ l: L.byId(id), d })).filter((x) => x.l).sort((a, b) => (a.d.date < b.d.date ? 1 : -1));
  const list = el('div.list');
  for (const { l, d } of rows) list.append(el('div.row', { onclick: () => l.cards && l.cards.length && startLesson(l, true) },
    el('span.m', { text: d.date.slice(5) }), el('span.n', { text: `${l.subject} · ${l.title}` }), el('span.m', { text: `${d.score}/${d.total}` })));
  if (!rows.length) list.append(el('div.empty', { text: 'Одоохондоо хийсэн хичээл алга' }));
  view.replaceChildren(el('p.ln-dim', { text: `Нийт ${rows.length} хичээл · 🔥 ${L.p.streak || 0} хоног · давтлагад ${L.p.reviews.length} асуулт (өнөөдөр ${L.due().length})` }), list);
}

// 20:00-аас хойш апп нээхэд өнөөдрийн хичээлээ хийгээгүй бол санал болгоно
function autoLearn() {
  if (!L.pending() || new Date().getHours() < LEARN_HOUR) return false;
  if (L.p.skipDate === dayKey() || (L.p.snoozeUntil && Date.now() < L.p.snoozeUntil)) return false;
  if (sessionStorage.getItem('u.autoShown') === dayKey()) return false;
  sessionStorage.setItem('u.autoShown', dayKey());
  location.hash = '#/learn?auto';
  return true;
}

// ---------- чиглүүлэлт ----------
async function route() {
  stopTimer(); stopRec();
  const h = location.hash || '#/';
  if (!token && !LS.get('files', null)) return showSignIn();
  if (!S.root) return showMsg('Drive дээр "Universe" хавтас олдсонгүй. Компьютер дээрээ LightNote → Settings → Sync асаана уу.');
  let m;
  if (h.startsWith('#/learn')) return showLearn(h.includes('auto') ? 'auto' : '');
  if ((m = h.match(/^#\/f\/(.+)/))) return showFile(m[1]);
  if ((m = h.match(/^#\/e\/(.+)/))) return showEdit(m[1]);
  if ((m = h.match(/^#\/d\/(.+)/)) && S.files.has(m[1])) return showFolder(m[1]);
  return showFolder(S.root);
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
$('#learnBtn').onclick = () => (location.hash = '#/learn');
$('#refresh').onclick = async () => {
  try { await loadAll(); L.loaded = false; await L.load(); paintDot(); toast('Шинэчлэгдлээ'); route(); } catch (e) { handleErr(e); }
};
window.addEventListener('online', () => setStatus(''));
window.addEventListener('offline', () => setStatus('офлайн'));

async function start() {
  readAuthResponse();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cached = LS.get('files', null);
  if (cached) index(cached); // эхлээд кэшээс шууд харуулна
  if (!navigator.onLine) setStatus('офлайн');
  if (cached) route();
  if (!token && !LS.get('email', '')) { if (!cached) showSignIn(); return; }
  try {
    await loadAll();
    if (!cached || !/^#\/(f|e)\//.test(location.hash)) await route();
    try { await L.load(); paintDot(); autoLearn(); } catch {}
  } catch (e) {
    setStatus('');
    if (!cached || e.message === 'signin') handleErr(e); else toast(e.message, 3000);
  }
  // буцаж апп руу ороход шинэчилнэ
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || dirty || !navigator.onLine) return;
    try { await loadAll(); L.loaded = false; await L.load(); paintDot(); if (!/^#\/(f|e|learn)/.test(location.hash)) route(); } catch {}
  });
}
start();
