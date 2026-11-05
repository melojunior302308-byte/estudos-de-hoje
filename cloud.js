/* Camada de compatibilidade: responde a claude.use('db') e claude.use('assets')
   usando um projeto Supabase do próprio usuário (login por e-mail e senha). */
(function () {
  const C = window.CLOUD_CFG || {};
  const on = !!(C.url && C.key && !/COLE|SEU-PROJETO/i.test(C.url + C.key) && window.supabase);
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });
  let sb = null, loginP = null, skip = false;
  try { skip = sessionStorage.getItem('cloud_skip') == '1'; } catch (e) {}
  if (on) {
    sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  function mapErr(e) {
    const m = String((e && e.message) || ''), c = String((e && (e.code || e.status || e.statusCode)) || '');
    if (c == '42501' || c == '401' || c == '403' || /row-level|permission|not authorized/i.test(m)) return err('permission_denied', m);
    if (/jwt|token/i.test(m)) return err('unauthenticated', m);
    if (/failed to fetch|network|load failed/i.test(m)) return err('offline', m);
    return err(c || 'falha', m);
  }

  /* ---------- login ---------- */
  function mount(el) {
    if (document.body) document.body.appendChild(el);
    else addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
  }
  function login() {
    if (loginP) return loginP;
    loginP = new Promise((res, rej) => {
      const w = document.createElement('div');
      w.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px';
      w.innerHTML = '<form class="box" style="width:100%;max-width:380px;margin:0"><b style="font-size:1.1rem">Entrar na sua conta</b>' +
        '<div class="mu" style="margin:4px 0 10px">Usada para sincronizar seu progresso e guardar os manuais.</div>' +
        '<label>E-mail</label><input id="cl_e" type="email" autocomplete="username" required>' +
        '<label>Senha</label><input id="cl_p" type="password" autocomplete="current-password" required>' +
        '<div id="cl_m" style="color:var(--no);min-height:1.3em;font-size:.9rem"></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px"><button class="btn" type="submit">Entrar</button>' +
        '<button class="btn g" type="button" id="cl_x">Agora não</button></div></form>';
      mount(w);
      const f = w.querySelector('form'), m = w.querySelector('#cl_m');
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        m.textContent = 'Entrando...';
        const { data, error } = await sb.auth.signInWithPassword({ email: w.querySelector('#cl_e').value.trim(), password: w.querySelector('#cl_p').value });
        if (error || !data.session) { m.textContent = 'E-mail ou senha incorretos.'; return; }
        w.remove(); res(data.session);
      };
      w.querySelector('#cl_x').onclick = () => {
        try { sessionStorage.setItem('cloud_skip', '1'); } catch (e) {}
        skip = true; w.remove(); rej(err('unauthenticated'));
      };
    });
    loginP.then(() => { loginP = null; }, () => { loginP = null; });
    return loginP;
  }
  async function authed() {
    if (!on) throw err('not_configured');
    let s = null;
    try { s = (await sb.auth.getSession()).data.session; } catch (e) {}
    if (s) return s;
    if (skip) throw err('unauthenticated');
    return login();
  }
  window.cloudLogin = async function () {
    if (!on) { alert('A conta na nuvem ainda não foi configurada neste site (falta preencher o config.js).'); return; }
    skip = false;
    try { sessionStorage.removeItem('cloud_skip'); } catch (e) {}
    try { await authed(); } catch (e) { return; }
    if (typeof SY !== 'undefined') { SY.st = 'init'; SY.started = 0; if (typeof syUI == 'function') syUI(); }
    try { await manInit(); } catch (e) {}
    try { await syInit(); } catch (e) {}
  };

  /* ---------- banco (documentos) ---------- */
  const cache = new Map(), subs = new Set();
  let rt = null;
  const snapDoc = (col, id) => { const m = cache.get(col), d = m && m.get(id); return { id, exists: d !== undefined, data: () => d }; };
  function emit(s) {
    const m = cache.get(s.col) || new Map();
    try {
      if (s.id == null) s.cb({ size: m.size, docs: [...m].map(([id, d]) => ({ id, exists: true, data: () => d })) });
      else s.cb(snapDoc(s.col, s.id));
    } catch (e) { console.error(e); }
  }
  const fire = (col) => subs.forEach((s) => { if (s.col === col) emit(s); });
  async function load(col) {
    const { data, error } = await sb.from('docs').select('id,data').eq('col', col);
    if (error) throw mapErr(error);
    const m = new Map(); data.forEach((r) => m.set(r.id, r.data)); cache.set(col, m);
  }
  function ensureRT() {
    if (rt) return;
    rt = sb.channel('docs-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (p) => {
      const row = p.eventType == 'DELETE' ? p.old : p.new;
      if (!row) return;
      const m = cache.get(row.col);
      if (!m) return;
      if (p.eventType == 'DELETE') m.delete(row.id); else m.set(row.id, row.data);
      fire(row.col);
    }).subscribe(async (st) => {
      if (st == 'SUBSCRIBED') for (const col of [...cache.keys()]) { try { await load(col); fire(col); } catch (e) {} }
    });
  }
  function local(col, id, d) {
    const m = cache.get(col);
    if (!m) return;
    if (d === null) m.delete(id); else m.set(id, d);
    fire(col);
  }
  function watch(col, id, cb, ecb) {
    const s = { col, id, cb, ecb };
    subs.add(s);
    (async () => {
      try { await authed(); ensureRT(); if (!cache.has(col)) await load(col); emit(s); }
      catch (e) { if (ecb) ecb(mapErr(e)); }
    })();
    return () => subs.delete(s);
  }
  const db = {
    collection(col) {
      return {
        onSnapshot: (cb, ecb) => watch(col, null, cb, ecb),
        doc(id) {
          const get = async () => {
            const { data, error } = await sb.from('docs').select('data').eq('col', col).eq('id', id).maybeSingle();
            if (error) throw mapErr(error);
            return { id, exists: !!data, data: () => (data ? data.data : undefined) };
          };
          const put = async (d) => {
            const { error } = await sb.from('docs').upsert({ col, id, data: d, updated_at: new Date().toISOString() });
            if (error) throw mapErr(error);
            local(col, id, d);
          };
          return {
            id, get,
            set: put,
            async update(d) {
              const cur = await get();
              if (!cur.exists) throw err('not-found');
              await put(Object.assign({}, cur.data(), d));
            },
            async delete() {
              const { error } = await sb.from('docs').delete().eq('col', col).eq('id', id);
              if (error) throw mapErr(error);
              local(col, id, null);
            },
            onSnapshot: (cb, ecb) => watch(col, id, cb, ecb),
          };
        },
      };
    },
  };

  /* ---------- arquivos (PDFs e capas) ---------- */
  const BUCKET = 'blobs';
  const assets = {
    async upload(file, opts) {
      const s = await authed(), id = crypto.randomUUID();
      const { error } = await sb.storage.from(BUCKET).upload(s.user.id + '/' + id, file, { contentType: (opts && opts.type) || file.type || 'application/octet-stream' });
      if (error) {
        const m = String(error.message || '');
        throw err(/exceed|too large|size|payload/i.test(m) ? 'too_large' : /quota|storage limit/i.test(m) ? 'quota_exceeded' : 'store_unavailable', m);
      }
      return { id, sizeBytes: file.size };
    },
    async delete(id) {
      const s = await authed();
      const { error } = await sb.storage.from(BUCKET).remove([s.user.id + '/' + id]);
      if (error) throw mapErr(error);
    },
  };
  async function blob(id) {
    const s = await authed();
    const { data, error } = await sb.storage.from(BUCKET).download(s.user.id + '/' + id);
    if (error || !data) throw mapErr(error || {});
    return data;
  }
  window.cloudBlob = async (id) => (await blob(id)).arrayBuffer();

  /* capas: <img data-blob="ID"> vira uma imagem carregada com o seu login */
  const urls = new Map();
  async function hydrate(img) {
    const id = img.getAttribute('data-blob');
    img.removeAttribute('data-blob');
    try {
      if (!urls.has(id)) urls.set(id, URL.createObjectURL(await blob(id)));
      img.src = urls.get(id);
    } catch (e) { urls.delete(id); if (img.onerror) img.onerror(); }
  }
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType != 1) continue;
      if (n.matches && n.matches('img[data-blob]')) hydrate(n);
      if (n.querySelectorAll) n.querySelectorAll('img[data-blob]').forEach(hydrate);
    }
  }).observe(document, { childList: true, subtree: true });

  /* ---------- objeto "claude" esperado pelo app ---------- */
  window.claude = {
    async use(name) {
      if (name == 'db') { await authed(); return db; }
      if (name == 'assets') { await authed(); return assets; }
      throw err('unsupported');
    },
  };
})();
