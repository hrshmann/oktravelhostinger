/* OK FOR TRAVEL AND TOURISM CO — admin panel */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'okt-admin-key';

  const state = { key: '', packages: [], enquiries: [], settings: {}, editing: null };

  function getKey() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return state.key; } }
  function setKey(k) { state.key = k; try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ } }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': state.key, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') { logout(); throw new Error('Session expired — please sign in again.'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML = icon(type === 'error' ? 'info' : 'check') + esc(msg);
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const money = (n) => (state.settings.currencySymbol || '$') + Number(n || 0).toLocaleString();

  /* ---------------------------------------------------------------- auth */
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.key = $('#pwd').value;
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: state.key }) });
      setKey(state.key);
      enter();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  function logout() {
    setKey('');
    $('#adminView').classList.remove('show');
    $('#loginView').style.display = '';
  }
  $('#logout').addEventListener('click', logout);

  async function enter() {
    $('#loginView').style.display = 'none';
    $('#adminView').classList.add('show');
    await loadAll();
  }

  async function loadAll() {
    try {
      const [pk, st, enq, status] = await Promise.all([
        api('/api/packages'), api('/api/settings'), api('/api/enquiries'), api('/api/status'),
      ]);
      state.packages = pk; state.settings = st; state.enquiries = enq;
      $('#kProv').textContent = { duffel: 'Duffel (live)', travelpayouts: 'Aviasales (live)', demo: 'Demo fares' }[status.flightProvider] || status.flightProvider;
      renderAll();
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderAll() {
    renderDashboard();
    renderPackages();
    renderEnquiries();
    fillSettings();
  }

  /* ---------------------------------------------------------------- views */
  function show(view) {
    $$('.side [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
    scrollTo({ top: 0 });
  }
  $$('.side [data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

  function renderDashboard() {
    $('#kTotal').textContent = state.packages.length;
    $('#kActive').textContent = state.packages.filter((p) => p.active !== false).length;
    $('#kEnq').textContent = state.enquiries.length;
    $('#cntPkg').textContent = state.packages.length;
    $('#cntEnq').textContent = state.enquiries.length;
    $('#dashEnq').innerHTML = state.enquiries.length ? state.enquiries.slice(0, 5).map(enqHtml).join('') : '<div class="empty-sm">No enquiries yet. They appear here when visitors click a WhatsApp button.</div>';
  }

  /* ------------------------------------------------------------- packages */
  function renderPackages() {
    const q = ($('#admSearch').value || '').toLowerCase();
    const list = state.packages.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.title} ${p.destination} ${p.category}`.toLowerCase().includes(q));
    $('#catList').innerHTML = [...new Set(state.packages.map((p) => p.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('');
    if (!list.length) {
      $('#pkgRows').innerHTML = '<div class="empty-sm">No packages yet — click “New package” to create one.</div>';
      return;
    }
    $('#pkgRows').innerHTML = list.map(({ p, i }) => `
      <div class="pkg-row${p.active === false ? ' inactive' : ''}" data-i="${i}">
        <div class="move"><button data-move="-1" aria-label="Move up">${icon('up')}</button><button data-move="1" aria-label="Move down" style="transform:rotate(180deg)">${icon('up')}</button></div>
        <img src="${esc(p.image)}" alt="" onerror="this.style.visibility='hidden'">
        <div><h4>${esc(p.title)}</h4><small>${esc(p.destination)} · ${esc(p.category)} · ${esc(p.days)}D/${esc(p.nights)}N${p.badge ? ' · ' + esc(p.badge) : ''}</small>
          <div class="price" style="text-align:left;margin-top:4px">${money(p.price)} ${p.oldPrice > p.price ? `<s style="color:var(--muted);font-weight:500;font-size:.85rem">${money(p.oldPrice)}</s>` : ''}</div></div>
        <div class="toggles">
          <label class="switch"><input type="checkbox" data-toggle="active" ${p.active !== false ? 'checked' : ''}><i></i>Live</label>
          <label class="switch"><input type="checkbox" data-toggle="featured" ${p.featured ? 'checked' : ''}><i></i>Featured</label>
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-act="edit" title="Edit">${icon('edit')}</button>
          <button class="icon-btn" data-act="dup" title="Duplicate">${icon('copy')}</button>
          <button class="icon-btn danger" data-act="del" title="Delete">${icon('trash')}</button>
        </div>
      </div>`).join('');
  }
  $('#admSearch').addEventListener('input', renderPackages);

  async function saveAllPackages(msg) {
    try {
      state.packages = await api('/api/packages', { method: 'PUT', body: JSON.stringify(state.packages) });
      renderPackages(); renderDashboard();
      if (msg) toast(msg);
    } catch (err) { toast(err.message, 'error'); loadAll(); }
  }

  $('#pkgRows').addEventListener('click', async (e) => {
    const row = e.target.closest('.pkg-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const p = state.packages[i];
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const j = i + Number(mv.dataset.move);
      if (j < 0 || j >= state.packages.length) return;
      [state.packages[i], state.packages[j]] = [state.packages[j], state.packages[i]];
      return saveAllPackages('Order updated');
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') openEditor(p);
    if (act === 'dup') {
      const copy = { ...JSON.parse(JSON.stringify(p)), id: undefined, title: p.title + ' (copy)', active: false };
      try {
        const created = await api('/api/packages', { method: 'POST', body: JSON.stringify(copy) });
        state.packages.splice(i + 1, 0, created);
        await saveAllPackages('Package duplicated (hidden until you publish it)');
      } catch (err) { toast(err.message, 'error'); }
    }
    if (act === 'del') {
      if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
      try {
        await api('/api/packages/' + encodeURIComponent(p.id), { method: 'DELETE' });
        state.packages.splice(i, 1);
        renderPackages(); renderDashboard();
        toast('Package deleted');
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('#pkgRows').addEventListener('change', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const p = state.packages[Number(t.closest('.pkg-row').dataset.i)];
    p[t.dataset.toggle] = t.checked;
    try {
      await api('/api/packages/' + encodeURIComponent(p.id), { method: 'PUT', body: JSON.stringify(p) });
      renderPackages(); renderDashboard();
      toast(t.dataset.toggle === 'active' ? (t.checked ? 'Package is live' : 'Package hidden') : 'Updated');
    } catch (err) { toast(err.message, 'error'); }
  });

  /* --------------------------------------------------------------- editor */
  const form = $('#pkgForm');
  const drawer = $('#drawer');

  function openEditor(p) {
    state.editing = p || null;
    $('#drawerTitle').textContent = p ? 'Edit package' : 'New package';
    const d = p || { days: 5, nights: 4, rating: 4.8, active: true, featured: false, inclusions: [], itinerary: [] };
    ['title', 'destination', 'category', 'days', 'nights', 'price', 'oldPrice', 'rating', 'badge', 'image', 'description'].forEach((k) => { form[k].value = d[k] ?? ''; });
    form.inclusions.value = (d.inclusions || []).join('\n');
    form.itinerary.value = (d.itinerary || []).join('\n');
    form.active.checked = d.active !== false;
    form.featured.checked = !!d.featured;
    $('#imgPrev').src = d.image || '';
    drawer.classList.add('open');
    setTimeout(() => form.title.focus(), 300);
  }
  function closeEditor() { drawer.classList.remove('open'); }
  $$('[data-new-pkg]').forEach((b) => b.addEventListener('click', () => { show('packages'); openEditor(null); }));
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) closeEditor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });
  form.image.addEventListener('input', () => { $('#imgPrev').src = form.image.value; });

  // Resize uploads in the browser so packages.json stays small.
  $('#imgUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      form.image.value = c.toDataURL('image/jpeg', 0.8);
      $('#imgPrev').src = form.image.value;
      URL.revokeObjectURL(img.src);
      toast('Image added');
    };
    img.onerror = () => toast('Could not read that image', 'error');
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const data = {
      ...(state.editing || {}),
      title: form.title.value.trim(),
      destination: form.destination.value.trim(),
      category: form.category.value.trim(),
      days: Number(form.days.value) || 1,
      nights: Number(form.nights.value) || 0,
      price: Number(form.price.value) || 0,
      oldPrice: Number(form.oldPrice.value) || 0,
      rating: Math.min(5, Number(form.rating.value) || 0),
      badge: form.badge.value.trim(),
      image: form.image.value.trim(),
      description: form.description.value.trim(),
      inclusions: lines(form.inclusions.value),
      itinerary: lines(form.itinerary.value),
      active: form.active.checked,
      featured: form.featured.checked,
    };
    try {
      if (state.editing) {
        const saved = await api('/api/packages/' + encodeURIComponent(state.editing.id), { method: 'PUT', body: JSON.stringify(data) });
        state.packages[state.packages.indexOf(state.editing)] = saved;
        toast('Package saved');
      } else {
        const created = await api('/api/packages', { method: 'POST', body: JSON.stringify(data) });
        state.packages.push(created);
        toast('Package created');
      }
      closeEditor(); renderPackages(); renderDashboard();
    } catch (err) { toast(err.message, 'error'); }
  });

  /* -------------------------------------------------------- import/export */
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.packages, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `okfortravel-packages-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const list = JSON.parse(await file.text());
      if (!Array.isArray(list)) throw new Error('File must contain a list of packages');
      if (!confirm(`Replace all ${state.packages.length} packages with ${list.length} from the file?`)) return;
      state.packages = list.map((p) => ({ ...p, id: p.id || Math.random().toString(36).slice(2, 10) }));
      await saveAllPackages('Packages imported');
    } catch (err) { toast(err.message, 'error'); }
  });

  /* ------------------------------------------------------------ enquiries */
  function enqHtml(q) {
    const phone = (q.phone || '').replace(/\D/g, '');
    return `<div class="enq">
      <div>
        <div class="meta"><span class="tag">${esc(q.type || 'Enquiry')}</span><span>${icon('clock')} ${esc(new Date(q.createdAt).toLocaleString())}</span>${q.name ? `<span>${icon('users')} ${esc(q.name)}</span>` : ''}${q.phone ? `<span>${icon('phone')} ${esc(q.phone)}</span>` : ''}</div>
        <pre>${esc(q.message)}</pre>
      </div>
      <div class="row-actions">
        ${phone ? `<a class="icon-btn wa" href="https://wa.me/${phone}" target="_blank" rel="noopener" title="Reply on WhatsApp">${icon('whatsapp')}</a>` : ''}
        <button class="icon-btn danger" data-del-enq="${esc(q.id)}" title="Delete">${icon('trash')}</button>
      </div>
    </div>`;
  }
  function renderEnquiries() {
    $('#enqList').innerHTML = state.enquiries.length ? state.enquiries.map(enqHtml).join('') : '<div class="empty-sm">No enquiries yet.</div>';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-enq]');
    if (!b) return;
    try {
      await api('/api/enquiries/' + encodeURIComponent(b.dataset.delEnq), { method: 'DELETE' });
      state.enquiries = state.enquiries.filter((q) => q.id !== b.dataset.delEnq);
      renderEnquiries(); renderDashboard();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#refreshEnq').addEventListener('click', async () => {
    try { state.enquiries = await api('/api/enquiries'); renderEnquiries(); renderDashboard(); toast('Refreshed'); } catch (err) { toast(err.message, 'error'); }
  });

  /* ------------------------------------------------------------- settings */
  const sform = $('#settingsForm');
  function fillSettings() {
    const s = state.settings;
    $$('[name]', sform).forEach((el) => {
      const [a, b] = el.name.split('.');
      el.value = (b ? (s[a] || {})[b] : s[a]) ?? '';
    });
    $('#statsFields').innerHTML = (s.stats || []).map((st, i) => `
      <div class="fg" style="margin-bottom:8px" data-stat="${i}">
        <input class="inp" data-k="value" type="number" value="${esc(st.value)}" aria-label="Value">
        <input class="inp" data-k="suffix" value="${esc(st.suffix)}" placeholder="+" aria-label="Suffix">
        <input class="inp c2" data-k="label" value="${esc(st.label)}" aria-label="Label">
      </div>`).join('');
  }
  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = { ...state.settings, social: { ...(state.settings.social || {}) } };
    $$('[name]', sform).forEach((el) => {
      const [a, b] = el.name.split('.');
      if (b) s[a][b] = el.value.trim(); else s[a] = el.value.trim();
    });
    s.whatsapp = s.whatsapp.replace(/\D/g, '');
    s.currency = (s.currency || 'USD').toUpperCase();
    s.stats = $$('[data-stat]').map((row) => ({
      value: Number($('[data-k=value]', row).value) || 0,
      suffix: $('[data-k=suffix]', row).value,
      label: $('[data-k=label]', row).value,
    }));
    try {
      state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      fillSettings();
      toast('Settings saved — refresh the website to see changes');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#testWa').addEventListener('click', () => {
    const n = sform.whatsapp.value.replace(/\D/g, '');
    if (n.length < 8) return toast('Enter a full international number first', 'error');
    window.open(`https://wa.me/${n}?text=${encodeURIComponent('Test message from the OK FOR TRAVEL website admin panel ✅')}`, '_blank', 'noopener');
  });

  /* ----------------------------------------------------------------- boot */
  hydrateIcons();
  state.key = getKey();
  if (state.key) {
    api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: state.key }) }).then(enter).catch(logout);
  }
})();
