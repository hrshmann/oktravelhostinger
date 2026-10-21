/* OK FOR TRAVEL AND TOURISM CO — public website logic */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const FALLBACK_IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b437a"/><stop offset="1" stop-color="#12b5a5"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><path d="M0 230 90 150l60 50 90-90 160 120v70H0z" fill="#fff" opacity=".15"/><circle cx="310" cy="80" r="28" fill="#f5b83d" opacity=".8"/></svg>');

  const state = {
    settings: {},
    packages: [],
    pkgFilter: 'All',
    flights: null,
    sort: 'price',
    from: null,
    to: null,
    adults: 1,
  };

  /* ------------------------------------------------------------------ API */
  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML = icon(type === 'error' ? 'info' : 'check') + esc(msg);
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
    setTimeout(() => el.remove(), 3600);
  }

  function money(n, cur) {
    const c = (cur || state.settings.currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
    } catch (e) {
      return (state.settings.currencySymbol || '') + Math.round(n).toLocaleString();
    }
  }

  /* ------------------------------------------------------------- WhatsApp */
  function waNumber() { return String(state.settings.whatsapp || '').replace(/\D/g, ''); }

  function openWhatsApp(message, meta = {}) {
    const number = waNumber();
    if (!number) { toast('WhatsApp number is not configured yet.', 'error'); return; }
    // Log the enquiry for the admin inbox (fire and forget).
    try {
      fetch('/api/enquiries', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page: location.pathname, ...meta }),
      }).catch(() => {});
    } catch (e) { /* ignore */ }
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) location.href = url;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wa]');
    if (b) { e.preventDefault(); openWhatsApp(b.dataset.wa, { type: 'General' }); }
  });

  /* ------------------------------------------------------------- settings */
  function applySettings() {
    const s = state.settings;
    $$('[data-bind]').forEach((el) => { if (s[el.dataset.bind] != null) el.textContent = s[el.dataset.bind]; });
    $$('[data-bind-href="tel"]').forEach((el) => { el.href = 'tel:' + String(s.phone || '').replace(/[^\d+]/g, ''); });
    $$('[data-bind-href="mailto"]').forEach((el) => { el.href = 'mailto:' + (s.email || ''); });
    $$('[data-social]').forEach((el) => {
      const link = (s.social || {})[el.dataset.social];
      if (link && link !== '#') { el.href = link; el.target = '_blank'; el.rel = 'noopener'; }
    });
    if (s.heroTitle) {
      const words = esc(s.heroTitle).split(' ');
      const last = words.pop();
      $('[data-bind-html="heroTitleHtml"]').innerHTML = `${words.join(' ')} <em>${last}</em>`;
    }
    if (s.heroImage) $('#heroBg').style.backgroundImage = `url("${s.heroImage.replace(/"/g, '%22')}")`;
    if (s.companyName) document.title = `${s.companyName} — Flights, Holidays, Umrah & Visa`;

    $('#statsGrid').innerHTML = (s.stats || []).map((st) =>
      `<div class="stat reveal"><b data-count-to="${Number(st.value) || 0}" data-suffix="${esc(st.suffix || '')}">0</b><span>${esc(st.label)}</span></div>`).join('');
    observeReveal();
  }

  function animateCount(el) {
    const target = Number(el.dataset.countTo);
    const suffix = el.dataset.suffix || '';
    const start = performance.now();
    const dur = 1600;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* --------------------------------------------------------------- reveal */
  const revealObs = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      en.target.querySelectorAll('[data-count-to]').forEach(animateCount);
      revealObs.unobserve(en.target);
    });
  }, { threshold: 0.12 }) : null;

  function observeReveal() {
    $$('.reveal:not(.in)').forEach((el) => revealObs ? revealObs.observe(el) : el.classList.add('in'));
  }

  /* ------------------------------------------------------------ nav & ui */
  function initNav() {
    const nav = $('#nav');
    const toTop = $('#toTop');
    const onScroll = () => {
      nav.classList.toggle('scrolled', scrollY > 10);
      toTop.classList.toggle('show', scrollY > 700);
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

    $('#menuToggle').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
    $$('#navLinks a').forEach((a) => a.addEventListener('click', () => $('#navLinks').classList.remove('open')));

    if ('IntersectionObserver' in window) {
      const links = $$('#navLinks a');
      const spy = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      ['home', 'flights', 'packages', 'destinations', 'services', 'reviews', 'contact'].forEach((id) => { const el = document.getElementById(id); if (el) spy.observe(el); });
    }

    $$('.search-tab').forEach((tab) => tab.addEventListener('click', () => {
      $$('.search-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.search-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
    }));
    $('#year').textContent = new Date().getFullYear();
  }

  /* -------------------------------------------------------- flight form */
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function initFlightForm() {
    const today = new Date();
    const depart = $('#departDate');
    const ret = $('#returnDate');
    depart.min = ret.min = ymd(today);
    depart.value = ymd(new Date(today.getTime() + 14 * 864e5));
    ret.value = ymd(new Date(today.getTime() + 21 * 864e5));
    depart.addEventListener('change', () => {
      ret.min = depart.value;
      if (ret.value && ret.value < depart.value) ret.value = ymd(new Date(new Date(depart.value).getTime() + 7 * 864e5));
    });

    $$('input[name=trip]').forEach((r) => r.addEventListener('change', () => {
      const oneway = $('input[name=trip]:checked').value === 'oneway';
      $('#returnField').classList.toggle('disabled', oneway);
    }));

    setupAutocomplete('from');
    setupAutocomplete('to');

    $('#swapBtn').addEventListener('click', () => {
      [state.from, state.to] = [state.to, state.from];
      setAirport('from', state.from);
      setAirport('to', state.to);
    });

    // Travellers popover
    const pop = $('#travPop');
    $('#travBtn').addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('open'); });
    $('#travDone').addEventListener('click', () => pop.classList.remove('open'));
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => pop.classList.remove('open'));
    $$('[data-count]', pop).forEach((b) => b.addEventListener('click', () => {
      state.adults = Math.max(1, Math.min(9, state.adults + Number(b.dataset.count)));
      updateTravellers();
    }));
    $$('input[name=cabin]').forEach((r) => r.addEventListener('change', updateTravellers));

    $$('[data-quick]').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      const [f, t] = a.dataset.quick.split('-');
      await Promise.all([lookupAirport(f).then((ap) => setAirport('from', ap)), lookupAirport(t).then((ap) => setAirport('to', ap))]);
      searchFlights();
    }));

    $('#flightForm').addEventListener('submit', (e) => { e.preventDefault(); searchFlights(); });

    api('/api/status').then((s) => {
      const live = s.flightProvider !== 'demo';
      const pill = $('#providerPill');
      pill.classList.toggle('live', live);
      pill.lastElementChild.textContent = live ? `Live fares powered by ${s.flightProvider === 'duffel' ? 'Duffel' : 'Aviasales'}` : 'Sample fares — add a free API key to go live';
    }).catch(() => { $('#providerPill').lastElementChild.textContent = 'Start server.py to enable fare search'; });

    // Default origin
    lookupAirport('DXB').then((ap) => setAirport('from', ap));
  }

  function cabinLabel(c) { return { economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First' }[c] || 'Economy'; }

  function updateTravellers() {
    $('#adultCount').textContent = state.adults;
    $('#travBtn').textContent = `${state.adults} Adult${state.adults > 1 ? 's' : ''}`;
    $('#travSub').textContent = cabinLabel($('input[name=cabin]:checked').value);
  }

  async function lookupAirport(code) {
    const list = await api('/api/airports?q=' + encodeURIComponent(code)).catch(() => []);
    return list.find((a) => a.code === code) || { code, city: code, name: '', country: '' };
  }

  function setAirport(which, ap) {
    state[which] = ap || null;
    $(`#${which}Input`).value = ap ? `${ap.city} (${ap.code})` : '';
    $(`#${which}Sub`).textContent = ap ? `${ap.name}${ap.country ? ', ' + ap.country : ''}` : (which === 'from' ? 'Where are you leaving from?' : 'Where are you going?');
  }

  function setupAutocomplete(which) {
    const input = $(`#${which}Input`);
    const list = $(`#${which}List`);
    let items = [];
    let hl = -1;

    const render = () => {
      list.innerHTML = items.length ? items.map((a, i) => `
        <div class="ac-item${i === hl ? ' hl' : ''}" data-i="${i}">
          <span class="ac-code">${esc(a.code)}</span>
          <div><strong>${esc(a.city)}, ${esc(a.country)}</strong><small>${esc(a.name)}</small></div>
        </div>`).join('') : '<div class="ac-item"><small>No airports found — try a city name or 3-letter code.</small></div>';
      list.classList.add('open');
    };
    const search = debounce(async (q) => {
      items = await api('/api/airports?q=' + encodeURIComponent(q)).catch(() => []);
      hl = items.length ? 0 : -1;
      render();
    }, 160);

    input.addEventListener('focus', () => { input.select(); search(''); });
    input.addEventListener('input', () => { state[which] = null; search(input.value.replace(/\(.*\)/, '').trim()); });
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(items.length - 1, hl + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); render(); }
      else if (e.key === 'Enter' && hl >= 0) { e.preventDefault(); choose(hl); }
      else if (e.key === 'Escape') list.classList.remove('open');
    });
    list.addEventListener('mousedown', (e) => {
      const it = e.target.closest('[data-i]');
      if (it) { e.preventDefault(); choose(Number(it.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      list.classList.remove('open');
      if (!state[which] && items[0] && input.value.trim()) setAirport(which, items[0]);
      else if (state[which]) setAirport(which, state[which]);
    }, 120));

    function choose(i) {
      setAirport(which, items[i]);
      list.classList.remove('open');
      if (which === 'from' && !state.to) $('#toInput').focus();
      else if (which === 'to') $('#departDate').focus();
    }
  }

  /* ------------------------------------------------------ flight search */
  async function searchFlights() {
    if (!state.from || !state.to) {
      toast('Please choose both departure and destination airports.', 'error');
      (!state.from ? $('#fromInput') : $('#toInput')).focus();
      return;
    }
    if (state.from.code === state.to.code) { toast('Departure and destination must be different.', 'error'); return; }
    const oneway = $('input[name=trip]:checked').value === 'oneway';
    const params = new URLSearchParams({
      from: state.from.code,
      to: state.to.code,
      date: $('#departDate').value,
      adults: state.adults,
      cabin: $('input[name=cabin]:checked').value,
      currency: state.settings.currency || 'USD',
    });
    if (!oneway && $('#returnDate').value) params.set('return', $('#returnDate').value);

    const section = $('#flights-results');
    section.classList.add('show');
    $('#resultsTitle').textContent = `${state.from.city} → ${state.to.city}`;
    $('#resultsSub').textContent = 'Searching airlines for the best fares…';
    $('#resultsNotice').innerHTML = '';
    $('#resultsList').innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('');
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const data = await api('/api/flights?' + params);
      state.flights = data;
      buildFilters(data.results);
      renderFlights();
    } catch (err) {
      $('#resultsSub').textContent = '';
      $('#resultsList').innerHTML = `<div class="empty"><div class="ic">${icon('info')}</div><h3>We couldn't search right now</h3><p>${esc(err.message)}</p>
        <button class="btn btn-wa" data-wa="${esc(`Hi, please find me flights from ${state.from.code} to ${state.to.code} on ${params.get('date')}.`)}">${icon('whatsapp')}Ask an agent instead</button></div>`;
    }
  }

  const durText = (m) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');
  const timeText = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--');
  const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const stopText = (n) => (n === 0 ? 'Direct' : `${n} stop${n > 1 ? 's' : ''}`);

  function buildFilters(results) {
    const stops = {};
    const airlines = {};
    results.forEach((r) => {
      const k = Math.min(r.stops, 2);
      stops[k] = Math.min(stops[k] ?? Infinity, r.price);
      airlines[r.airline] = Math.min(airlines[r.airline] ?? Infinity, r.price);
    });
    const cur = results[0]?.currency;
    $('#stopFilters').innerHTML = Object.keys(stops).sort().map((k) =>
      `<label class="check"><span><input type="checkbox" value="${k}" checked>${k == 2 ? '2+ stops' : stopText(Number(k))}</span><small>${money(stops[k], cur)}</small></label>`).join('');
    $('#airlineFilters').innerHTML = Object.keys(airlines).sort().map((a) =>
      `<label class="check"><span><input type="checkbox" value="${esc(a)}" checked>${esc(a)}</span><small>${money(airlines[a], cur)}</small></label>`).join('');

    const prices = results.map((r) => r.price);
    const range = $('#priceRange');
    const min = prices.length ? Math.floor(Math.min(...prices)) : 0;
    const max = prices.length ? Math.ceil(Math.max(...prices)) : 1;
    range.min = min; range.max = max; range.value = max; range.step = Math.max(1, Math.round((max - min) / 100));
    $('#priceMin').textContent = money(min, cur);
    $('#priceVal').textContent = money(max, cur);
  }

  function filteredFlights() {
    if (!state.flights) return [];
    const stops = $$('#stopFilters input:checked').map((i) => Number(i.value));
    const airlines = $$('#airlineFilters input:checked').map((i) => i.value);
    const times = $$('#timeFilters input:checked').map((i) => Number(i.value));
    const maxPrice = Number($('#priceRange').value);
    return state.flights.results.filter((r) => {
      const slot = Math.floor(new Date(r.departAt).getHours() / 6);
      return stops.includes(Math.min(r.stops, 2)) && airlines.includes(r.airline) && r.price <= maxPrice + 0.01 && (isNaN(slot) || times.includes(slot));
    });
  }

  function renderFlights() {
    const data = state.flights;
    const all = data.results;
    const list = filteredFlights();
    const sorters = {
      price: (a, b) => a.price - b.price,
      duration: (a, b) => (a.durationMin || 1e9) - (b.durationMin || 1e9),
      depart: (a, b) => new Date(a.departAt) - new Date(b.departAt),
    };
    list.sort(sorters[state.sort]);

    const best = (key) => [...list].sort(sorters[key])[0];
    $('#sortPrice').textContent = best('price') ? money(best('price').price, best('price').currency) : '—';
    $('#sortDuration').textContent = best('duration') ? durText(best('duration').durationMin) : '—';
    $('#sortDepart').textContent = best('depart') ? timeText(best('depart').departAt) : '—';

    const q = data.query;
    $('#resultsSub').textContent = `${list.length} of ${all.length} flights · ${dateText(q.date)}${q.return ? ' – ' + dateText(q.return) : ''} · ${q.adults} adult${q.adults > 1 ? 's' : ''} · ${cabinLabel(q.cabin)}`;
    $('#resultsNotice').innerHTML = data.note
      ? `<div class="notice">${icon('info')}${esc(data.note)}</div>`
      : !data.live ? `<div class="notice">${icon('info')}Showing sample fares. Message us on WhatsApp for confirmed live prices.</div>` : '';

    if (!list.length) {
      $('#resultsList').innerHTML = `<div class="empty"><div class="ic">${icon('plane')}</div><h3>No flights match your filters</h3><p>Try widening the filters, or let our agents search every airline for you.</p>
        <button class="btn btn-wa" data-wa-dynamic="flight-help">${icon('whatsapp')}Ask an agent</button></div>`;
      return;
    }
    const cheapest = Math.min(...list.map((r) => r.price));
    const fastest = Math.min(...list.map((r) => r.durationMin || 1e9));
    $('#resultsList').innerHTML = list.map((r, i) => `
      <article class="flight-card" style="animation-delay:${Math.min(i, 10) * 40}ms">
        <div class="fc-main">
          <div class="airline">
            <div class="airline-logo"><img src="https://pics.avs.io/96/96/${esc(r.airlineCode)}.png" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(r.airlineCode)}'))"></div>
            <div><strong>${esc(r.airline)}</strong><small>${esc(r.flightNumber)} · ${esc(cabinLabel(r.cabin))}</small></div>
          </div>
          <div class="route">
            <div class="t"><b>${timeText(r.departAt)}</b><small>${esc(r.from)}</small></div>
            <div class="route-line"><span>${durText(r.durationMin)}</span><div class="bar">${r.stops ? '<i></i>' : ''}</div><span class="${r.stops ? '' : 'direct'}">${stopText(r.stops)}</span></div>
            <div class="t"><b>${timeText(r.arriveAt)}</b><small>${esc(r.to)}</small></div>
          </div>
        </div>
        <div class="fc-side">
          <div>
            ${r.price === cheapest ? '<span class="tag">Cheapest</span> ' : ''}${r.durationMin === fastest && r.price !== cheapest ? '<span class="tag green">Fastest</span>' : ''}
            <div class="price">${money(r.price, r.currency)}</div>
            <small>${r.returnTrip ? 'Return' : 'One way'} · total for ${q.adults} adult${q.adults > 1 ? 's' : ''}</small>
          </div>
          <div class="btns">
            <button class="btn btn-wa btn-sm" data-flight="${i}">${icon('whatsapp')}Book on WhatsApp</button>
            ${r.bookingUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(r.bookingUrl)}" target="_blank" rel="noopener sponsored">${icon('ext')}Book online</a>` : ''}
          </div>
        </div>
      </article>`).join('');
    $$('#resultsList [data-flight]').forEach((b) => b.addEventListener('click', () => {
      const r = list[Number(b.dataset.flight)];
      const msg = [
        `Hello ${state.settings.shortName || ''}! I'd like to book this flight:`,
        `✈️ ${r.airline} ${r.flightNumber}`,
        `📍 ${r.from} → ${r.to}${r.returnTrip ? ' (return ' + q.return + ')' : ''}`,
        `🗓️ ${dateText(r.departAt)} at ${timeText(r.departAt)} · ${stopText(r.stops)} · ${durText(r.durationMin)}`,
        `👤 ${q.adults} adult(s), ${cabinLabel(q.cabin)}`,
        `💰 Quoted: ${money(r.price, r.currency)}`,
        'Please confirm availability. Thank you!',
      ].join('\n');
      openWhatsApp(msg, { type: 'Flight', route: `${r.from}-${r.to}`, date: q.date, price: r.price });
    }));
  }

  function initResultsUi() {
    $('#filters').addEventListener('input', (e) => {
      if (e.target.id === 'priceRange') $('#priceVal').textContent = money(Number(e.target.value), state.flights?.results[0]?.currency);
      renderFlights();
    });
    $('#filterToggle').addEventListener('click', () => $('#filters').classList.toggle('open'));
    $$('.sort-tab').forEach((t) => t.addEventListener('click', () => {
      state.sort = t.dataset.sort;
      $$('.sort-tab').forEach((x) => x.classList.toggle('active', x === t));
      renderFlights();
    }));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-wa-dynamic="flight-help"]')) return;
      const q = state.flights?.query;
      const msg = q
        ? `Hi! Please help me find the best flight ${q.from} → ${q.to} on ${q.date}${q.return ? ', returning ' + q.return : ''}, ${q.adults} adult(s), ${cabinLabel(q.cabin)}.`
        : 'Hi! Please help me find a flight.';
      openWhatsApp(msg, { type: 'Flight help' });
    });
  }

  /* ------------------------------------------------------------ packages */
  function initPackages() {
    $('#pkgSearch').addEventListener('input', debounce(renderPackages, 120));
    $('#pkgSort').addEventListener('change', renderPackages);
    $('#pkgChips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      state.pkgFilter = c.dataset.cat;
      $$('#pkgChips .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderPackages();
    });
    $('#pkgGrid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-pkg]');
      if (!card) return;
      const p = state.packages.find((x) => x.id === card.dataset.pkg);
      if (!p) return;
      if (e.target.closest('[data-pkg-wa]')) quickPackageWa(p);
      else if (e.target.closest('[data-pkg-open]')) openPackage(p);
    });
  }

  function renderChips() {
    const cats = ['All', ...new Set(state.packages.map((p) => p.category).filter(Boolean))];
    $('#pkgChips').innerHTML = cats.map((c) => `<button class="chip${c === state.pkgFilter ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  }

  function renderPackages() {
    const q = $('#pkgSearch').value.trim().toLowerCase();
    const sort = $('#pkgSort').value;
    let list = state.packages.filter((p) => (state.pkgFilter === 'All' || p.category === state.pkgFilter) &&
      (!q || [p.title, p.destination, p.category, p.description].join(' ').toLowerCase().includes(q)));
    const sorters = {
      featured: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      days: (a, b) => a.days - b.days,
      rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    };
    list = list.sort(sorters[sort]);
    if (!list.length) {
      $('#pkgGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="ic">${icon('search')}</div><h3>No packages found</h3><p>Tell us where you'd like to go and we'll build a custom package.</p><button class="btn btn-wa" data-wa="Hi! I'd like a custom holiday package.">${icon('whatsapp')}Request a custom trip</button></div>`;
      return;
    }
    $('#pkgGrid').innerHTML = list.map((p, i) => {
      const save = p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
      return `
      <article class="pkg-card" data-pkg="${esc(p.id)}" style="animation-delay:${Math.min(i, 8) * 60}ms">
        <div class="pkg-img" data-pkg-open>
          <img src="${esc(p.image || FALLBACK_IMG)}" alt="${esc(p.title)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
          ${p.badge ? `<span class="pkg-badge">${esc(p.badge)}</span>` : ''}
          ${save ? `<span class="pkg-save">Save ${save}%</span>` : ''}
          <span class="pkg-loc">${icon('pin')}${esc(p.destination)}</span>
        </div>
        <div class="pkg-body">
          <div class="pkg-meta"><span>${icon('clock')}${esc(p.days)} days / ${esc(p.nights)} nights</span><span class="rating">${icon('star')}${esc(Number(p.rating || 0).toFixed(1))}</span></div>
          <h3 data-pkg-open>${esc(p.title)}</h3>
          <p>${esc(p.description)}</p>
          <div class="pkg-foot">
            <div class="price-block"><small>From / person</small><b>${money(p.price)}</b>${p.oldPrice > p.price ? `<s>${money(p.oldPrice)}</s>` : ''}</div>
            <div class="pkg-actions">
              <button class="icon-btn" data-pkg-open aria-label="View details">${icon('eye')}</button>
              <button class="icon-btn wa" data-pkg-wa aria-label="Enquire on WhatsApp">${icon('whatsapp')}</button>
            </div>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function quickPackageWa(p) {
    openWhatsApp(`Hello! I'm interested in the "${p.title}" package (${p.days}D/${p.nights}N, ${p.destination}) from ${money(p.price)} per person. Please share availability and details.`,
      { type: 'Package', package: p.title });
  }

  function openPackage(p) {
    const modal = $('#pkgModal');
    const today = ymd(new Date(Date.now() + 7 * 864e5));
    $('#pkgModalBox').innerHTML = `
      <button class="modal-close" data-close aria-label="Close">${icon('x')}</button>
      <div class="pm-hero">
        <img src="${esc(p.image || FALLBACK_IMG)}" alt="${esc(p.title)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
        <div class="pm-hero-info">
          ${p.badge ? `<span class="pkg-badge" style="position:static">${esc(p.badge)}</span>` : ''}
          <h2>${esc(p.title)}</h2>
          <div class="meta"><span>${icon('pin')}${esc(p.destination)}</span><span>${icon('clock')}${esc(p.days)} days / ${esc(p.nights)} nights</span><span>${icon('star')}${esc(Number(p.rating || 0).toFixed(1))} rating</span><span>${icon('tag')}${esc(p.category)}</span></div>
        </div>
      </div>
      <div class="pm-body">
        <div>
          <h4>Overview</h4><p>${esc(p.description)}</p>
          ${(p.inclusions || []).length ? `<h4>What's included</h4><ul class="incl">${p.inclusions.map((x) => `<li>${icon('check')}${esc(x)}</li>`).join('')}</ul>` : ''}
          ${(p.itinerary || []).length ? `<h4>Day-by-day itinerary</h4><ol class="timeline">${p.itinerary.map((d, i) => `<li><b>${i + 1}</b>${esc(d)}</li>`).join('')}</ol>` : ''}
        </div>
        <div>
          <form class="book-card" id="pkgBookForm">
            <div class="price-block"><small>Price per person</small><b>${money(p.price)}</b>${p.oldPrice > p.price ? `<s>${money(p.oldPrice)}</s>` : ''}</div>
            <div class="form-grid">
              <input class="inp full" name="name" placeholder="Your full name" required>
              <input class="inp" name="date" type="date" min="${ymd(new Date())}" value="${today}" required aria-label="Travel date">
              <input class="inp" name="pax" type="number" min="1" max="50" value="2" required aria-label="Travellers">
              <textarea class="inp full" name="notes" placeholder="Special requests (optional)" style="min-height:70px"></textarea>
            </div>
            <div class="total-line"><span>Estimated total</span><span id="pkgTotal">${money(p.price * 2)}</span></div>
            <button class="btn btn-wa btn-block" type="submit">${icon('whatsapp')}Book via WhatsApp</button>
            <small style="display:block;text-align:center;color:var(--muted);margin-top:10px">No payment now — a consultant confirms everything first.</small>
          </form>
        </div>
      </div>`;
    const form = $('#pkgBookForm');
    form.pax.addEventListener('input', () => { $('#pkgTotal').textContent = money(p.price * Math.max(1, Number(form.pax.value) || 1)); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pax = Math.max(1, Number(form.pax.value) || 1);
      const msg = [
        `Hello! I'd like to book the *${p.title}* package.`,
        `📍 ${p.destination} · ${p.days}D/${p.nights}N`,
        `👤 Name: ${form.name.value.trim()}`,
        `🗓️ Travel date: ${form.date.value}`,
        `👥 Travellers: ${pax}`,
        `💰 Estimate: ${money(p.price * pax)} (${money(p.price)} pp)`,
        form.notes.value.trim() ? `📝 Notes: ${form.notes.value.trim()}` : '',
      ].filter(Boolean).join('\n');
      openWhatsApp(msg, { type: 'Package booking', package: p.title, name: form.name.value.trim(), pax });
      closeModal();
    });
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('.modal-close', modal).focus(), 50);
  }

  function closeModal() {
    const modal = $('#pkgModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); $('#waChat').classList.remove('open'); } });

  /* ------------------------------------------------- static content blocks */
  const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=75`;
  const DESTINATIONS = [
    { city: 'Dubai', code: 'DXB', country: 'United Arab Emirates', from: 'Skyline, desert & shopping', img: U('photo-1512453979798-5ea266f8880c') },
    { city: 'London', code: 'LHR', country: 'United Kingdom', from: 'Royal heritage', img: U('photo-1513635269975-59663e0ac1ad') },
    { city: 'Paris', code: 'CDG', country: 'France', from: 'City of lights', img: U('photo-1502602898657-3e91760cbb34') },
    { city: 'Istanbul', code: 'IST', country: 'Türkiye', from: 'Where continents meet', img: U('photo-1524231757912-21f4fe3a7200') },
    { city: 'Maldives', code: 'MLE', country: 'Maldives', from: 'Overwater villas', img: U('photo-1514282401047-d79a71a590e8') },
    { city: 'Bali', code: 'DPS', country: 'Indonesia', from: 'Island of gods', img: U('photo-1537996194471-e657df975ab4') },
    { city: 'Zurich', code: 'ZRH', country: 'Switzerland', from: 'Alpine wonder', img: U('photo-1530122037265-a5f1f91d3b99') },
    { city: 'Bangkok', code: 'BKK', country: 'Thailand', from: 'Temples & street food', img: U('photo-1552465011-b4e21bf6e79a') },
  ];

  const SERVICES = [
    { icon: 'plane', color: '#ff7a2f', title: 'Flight tickets', text: 'Domestic and international tickets on 450+ airlines with the lowest fares and instant e-tickets.', wa: 'Hi! I need a flight ticket.' },
    { icon: 'palm', color: '#12b5a5', title: 'Holiday packages', text: 'Tailor-made holidays for families, couples and groups with hotels, transfers and guided tours.', wa: 'Hi! I want a holiday package.' },
    { icon: 'moon', color: '#1b437a', title: 'Umrah & Hajj', text: 'Guided Umrah and Hajj packages with visas, hotels near the Haram and comfortable transport.', wa: 'Assalam o Alaikum! I want Umrah package details.' },
    { icon: 'passport', color: '#f5b83d', title: 'Visa services', text: 'Tourist, visit and business visas for UAE, Saudi Arabia, Schengen, UK, USA and more.', wa: 'Hi! I need help with a visa.' },
    { icon: 'hotel', color: '#e0457b', title: 'Hotel bookings', text: 'Over 1 million hotels worldwide — from budget stays to luxury resorts at contracted rates.', wa: 'Hi! I need a hotel booking.' },
    { icon: 'shield', color: '#7c5cff', title: 'Travel insurance', text: 'Comprehensive medical and trip cover, including Schengen-compliant policies issued instantly.', wa: 'Hi! I need travel insurance.' },
  ];

  const TESTIMONIALS = [
    { name: 'Ahmed Khan', trip: 'Premium Umrah · March 2026', text: 'Everything was perfectly arranged — the hotel was steps from the Haram and the team checked in with us on WhatsApp every day. Truly stress-free.', color: '#1b437a' },
    { name: 'Sara & Omar', trip: 'Maldives Honeymoon', text: 'The water villa was a dream. They upgraded our transfer and surprised us with a beach dinner. We will book every trip with OK For Travel.', color: '#ff7a2f' },
    { name: 'Rajesh Menon', trip: 'Swiss Alps Grand Tour', text: 'Visa, flights, Swiss Pass, hotels — all handled. Prices were better than booking it myself, and the itinerary was spot on.', color: '#12b5a5' },
    { name: 'Fatima Zahra', trip: 'Istanbul & Cappadocia', text: 'The balloon ride at sunrise was magical. Quick replies on WhatsApp whenever we had a question during the trip.', color: '#f5b83d' },
    { name: 'Michael Brown', trip: 'Dubai Luxury Escape', text: 'Professional from start to finish. Found me a last-minute fare that was $200 cheaper than any website.', color: '#e0457b' },
  ];

  const FAQ = [
    ['How do I book a package or flight?', 'Choose a package or flight and tap "Book on WhatsApp". Your trip details are sent to our consultant, who confirms availability, final price and payment options within minutes.'],
    ['Are the flight prices shown live?', 'When a live fare API is connected, prices come straight from airline systems. Fares can change quickly, so our consultant always re-confirms the price before you pay.'],
    ['What payment methods do you accept?', 'Bank transfer, debit/credit card and cash at our office. Instalment plans are available on selected holiday and Umrah packages.'],
    ['Can you help with visas?', 'Yes — we process tourist, visit and business visas for UAE, Saudi Arabia (including Umrah visas), Schengen, UK, Türkiye and many more countries.'],
    ['Can I customise a package?', 'Absolutely. Every package can be adjusted: hotel category, dates, number of nights, activities and flights. Just tell us on WhatsApp.'],
    ['What is your cancellation policy?', 'It depends on the airline and hotel rules for your booking. We explain the exact terms before you pay and help you with any changes.'],
  ];

  function renderStatic() {
    $('#destGrid').innerHTML = DESTINATIONS.map((d, i) => `
      <div class="dest" data-dest="${i}" tabindex="0" role="button" aria-label="Search flights to ${esc(d.city)}">
        <img src="${d.img}" alt="${esc(d.city)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
        <div class="dest-info"><div><small>${esc(d.from)}</small><h3>${esc(d.city)}</h3></div><span class="dest-go">${icon('arrow')}</span></div>
      </div>`).join('');
    const goDest = (el) => {
      const d = DESTINATIONS[Number(el.dataset.dest)];
      lookupAirport(d.code).then((ap) => {
        setAirport('to', ap);
        $$('.search-tab')[0].click();
        if (state.from && state.from.code !== d.code) searchFlights();
        else { $('#flights').scrollIntoView({ behavior: 'smooth' }); $('#fromInput').focus(); }
      });
    };
    $('#destGrid').addEventListener('click', (e) => { const el = e.target.closest('[data-dest]'); if (el) goDest(el); });
    $('#destGrid').addEventListener('keydown', (e) => { const el = e.target.closest('[data-dest]'); if (el && e.key === 'Enter') goDest(el); });

    $('#svcGrid').innerHTML = SERVICES.map((s) => `
      <div class="svc reveal">
        <div class="svc-ic" style="background:${s.color}">${icon(s.icon)}</div>
        <h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
        <a href="#" data-wa="${esc(s.wa)}">Enquire now ${icon('arrow')}</a>
      </div>`).join('');

    $('#testiTrack').innerHTML = TESTIMONIALS.map((t) => `
      <div class="testi">
        <div class="quote">“</div><span class="stars">★★★★★</span><p>${esc(t.text)}</p>
        <div class="testi-person"><div class="av" style="background:${t.color}">${esc(t.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</div><div><strong>${esc(t.name)}</strong><small>${esc(t.trip)}</small></div></div>
      </div>`).join('');
    let idx = 0;
    const perView = () => (innerWidth < 760 ? 1 : innerWidth < 1024 ? 2 : 3);
    const go = (d) => {
      const max = TESTIMONIALS.length - perView();
      idx = (idx + d + max + 1) % (max + 1);
      const card = $('.testi');
      $('#testiTrack').style.transform = `translateX(-${idx * (card.offsetWidth + 22)}px)`;
    };
    $('#testiNext').addEventListener('click', () => go(1));
    $('#testiPrev').addEventListener('click', () => go(-1));
    let auto = setInterval(() => go(1), 5500);
    $('#testiTrack').addEventListener('mouseenter', () => clearInterval(auto));
    $('#testiTrack').addEventListener('mouseleave', () => { auto = setInterval(() => go(1), 5500); });
    addEventListener('resize', debounce(() => { idx = 0; go(0); }, 200));

    $('#faqList').innerHTML = FAQ.map(([q, a], i) => `
      <div class="faq-item${i === 0 ? ' open' : ''}">
        <button class="faq-q" aria-expanded="${i === 0}">${esc(q)}<span class="pm">${icon('plus')}</span></button>
        <div class="faq-a"><div><p>${esc(a)}</p></div></div>
      </div>`).join('');
    $('#faqList').addEventListener('click', (e) => {
      const btn = e.target.closest('.faq-q');
      if (!btn) return;
      const item = btn.parentElement;
      const open = !item.classList.contains('open');
      $$('.faq-item').forEach((x) => { x.classList.remove('open'); $('.faq-q', x).setAttribute('aria-expanded', 'false'); });
      if (open) { item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    });
  }

  /* -------------------------------------------------------- enquiry forms */
  function initForms() {
    $$('form[data-enquiry]').forEach((form) => form.addEventListener('submit', (e) => {
      e.preventDefault();
      const lines = [`Hello! I'd like a quote for: *${form.dataset.enquiry}*`];
      new FormData(form).forEach((v, k) => { if (String(v).trim()) lines.push(`• ${k}: ${v}`); });
      openWhatsApp(lines.join('\n'), { type: form.dataset.enquiry });
    }));
    $('#contactForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const msg = `Hello! New enquiry from the website.\n👤 ${f.get('Name')}\n📞 ${f.get('Phone')}\n🧳 ${f.get('Service')}\n📝 ${f.get('Message')}`;
      openWhatsApp(msg, { type: 'Contact', name: f.get('Name'), phone: f.get('Phone') });
      e.target.reset();
    });
    $('#newsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.querySelector('input').value.trim();
      openWhatsApp(`Hi! I'm ${name}. Please add me to your WhatsApp deals broadcast.`, { type: 'Newsletter', name });
      e.target.reset();
    });
  }

  /* ------------------------------------------------------ WhatsApp widget */
  function initWaWidget() {
    const chat = $('#waChat');
    const body = $('#waBody');
    let greeted = false;
    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const bubble = (html, me) => {
      const el = document.createElement('div');
      el.className = 'bubble' + (me ? ' me' : '');
      el.innerHTML = `${html}<time>${now()}</time>`;
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      return el;
    };
    const typing = (ms) => new Promise((res) => {
      const t = document.createElement('div');
      t.className = 'typing';
      t.innerHTML = '<i></i><i></i><i></i>';
      body.appendChild(t);
      body.scrollTop = body.scrollHeight;
      setTimeout(() => { t.remove(); res(); }, ms);
    });

    async function greet() {
      greeted = true;
      await typing(900);
      bubble(`👋 Assalam o Alaikum & welcome to <b>${esc(state.settings.companyName || 'OK FOR TRAVEL AND TOURISM CO')}</b>!`);
      await typing(800);
      const b = bubble('How can we help you today? Pick a topic or type your message:');
      const qr = document.createElement('div');
      qr.className = 'quick-replies';
      qr.innerHTML = ['✈️ Flight tickets', '🌴 Holiday packages', '🕋 Umrah', '🛂 Visa', '🏨 Hotels'].map((t) => `<button type="button">${t}</button>`).join('');
      b.appendChild(qr);
      qr.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) send(`Hi! I'm interested in ${btn.textContent.replace(/^\S+\s/, '')}.`);
      });
      body.scrollTop = body.scrollHeight;
    }

    async function send(text) {
      if (!text.trim()) return;
      bubble(esc(text), true);
      $('#waInput').value = '';
      await typing(700);
      bubble('Great! Opening WhatsApp so a consultant can reply to you directly… 💬');
      setTimeout(() => openWhatsApp(text, { type: 'Chat widget' }), 900);
    }

    $('#waFab').addEventListener('click', () => {
      chat.classList.toggle('open');
      $('#waFab .badge')?.remove();
      if (chat.classList.contains('open')) {
        if (!greeted) greet();
        setTimeout(() => $('#waInput').focus(), 300);
      }
    });
    $('#waClose').addEventListener('click', () => chat.classList.remove('open'));
    $('#waForm').addEventListener('submit', (e) => { e.preventDefault(); send($('#waInput').value); });
  }

  /* ----------------------------------------------------------------- boot */
  async function boot() {
    hydrateIcons();
    initNav();
    renderStatic();
    initFlightForm();
    initResultsUi();
    initPackages();
    initForms();
    initWaWidget();
    hydrateIcons();
    observeReveal();

    const [settings, packages] = await Promise.all([
      api('/api/settings').catch(() => ({})),
      api('/api/packages').catch(() => []),
    ]);
    state.settings = settings;
    state.packages = packages.filter((p) => p.active !== false);
    applySettings();
    renderChips();
    renderPackages();
    if (!packages.length) toast('Could not load packages — is server.py running?', 'error');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
