(() => {
  'use strict';

  // ===== 設定 =====
  const CFG = window.MAP_CONFIG || {};
  const RADIUS_KM = CFG.RADIUS_KM || 10;            // まず探す範囲
  const WIDE_RADIUS_KM = CFG.WIDE_RADIUS_KM || 30;  // 見つからない時に広げる範囲
  const MAX_RESULTS = 60;        // リストに出す上限
  const JAPAN_CENTER = [36.5, 137.5];

  const $ = (id) => document.getElementById(id);
  const els = {
    panel: $('panel'), layout: document.querySelector('.layout'), scroll: $('panelScroll'),
    handle: $('sheetHandle'), summary: $('sheetSummary'),
    intro: $('intro'), form: $('searchForm'), q: $('q'), examples: $('examples'),
    candidates: $('candidates'), message: $('message'),
    step2: $('step2'), chips: $('brandChips'), step3: $('step3'),
    list: $('storeList'), meta: $('resultMeta'),
    locateBtn: $('locateBtn'), locateFab: $('locateFab'),
  };
  const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

  // ===== 地図 =====
  const map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 4, maxZoom: 19 }).setView(JAPAN_CENTER, 5);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // 背景地図：OpenFreeMap（Google風・無料）→ 使えない環境では国土地理院の淡色地図
  function addGsiLayer() {
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    }).addTo(map);
  }
  async function addBaseMap() {
    try {
      if (!window.maplibregl || !L.maplibreGL || !document.createElement('canvas').getContext('webgl')) throw new Error('no webgl');
      const style = await (await fetch('https://tiles.openfreemap.org/styles/liberty')).json();
      style.layers.forEach((l) => {
        // 地名・駅名などを日本語で表示
        if (l.layout && l.layout['text-field']) l.layout['text-field'] = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
      });
      L.maplibreGL({
        style,
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    } catch (e) {
      addGsiLayer();
    }
  }
  addBaseMap();

  map.createPane('originPane').style.zIndex = 650; // お店のピン(600)より上、吹き出し(700)より下
  const allLayer = L.layerGroup().addTo(map);   // 全国の店舗（小さい点）
  const resultLayer = L.layerGroup().addTo(map);
  let hereMarker = null;

  // ===== 状態 =====
  let stores = [];
  let state = { origin: null, originLabel: '', nearby: [], brand: 'すべて', activeId: null };
  const markers = new Map(); // storeId -> marker

  // ===== ユーティリティ =====
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toRad = (d) => (d * Math.PI) / 180;
  function distanceKm(a, b) {
    const R = 6371, dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`);
  function label(i) { // 近い順に 1, 2, 3 …
    return String(i + 1);
  }
  const detailUrl = (s) => s.url || `https://www.meimonshu.jp/xp_shop/?sid=${s.u}`;

  // ===== アクセス解析（GA4） =====
  function track(name, params) {
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) { /* 無視 */ }
  }
  if (CFG.GA_ID) {
    const sc = document.createElement('script');
    sc.async = true;
    sc.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(CFG.GA_ID)}`;
    document.head.appendChild(sc);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', CFG.GA_ID);
  }

  // ===== 店舗データの読み込み =====
  // 1) 管理用スプレッドシート → 2) 失敗したら stores.json
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  async function loadFromSheet() {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.SHEET_ID)}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(CFG.SHEET_NAME || '店舗')}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('sheet ' + res.status);
    const rows = parseCSV(await res.text());
    const head = rows.shift().map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const iId = col('店舗ID'), iShow = col('表示'), iName = col('店名'), iBrand = col('銘柄'),
          iLat = col('緯度'), iLon = col('経度'), iUrl = col('詳細URL'), iAddr = col('住所');
    if (iName < 0 || iLat < 0 || iLon < 0 || iBrand < 0) throw new Error('sheet columns');
    const out = [];
    rows.forEach((r, i) => {
      const show = iShow < 0 ? '○' : (r[iShow] || '').trim();
      const la = parseFloat(r[iLat]), lo = parseFloat(r[iLon]);
      const name = (r[iName] || '').trim();
      if (!name || !isFinite(la) || !isFinite(lo)) return;
      if (show && !/^(○|〇|◯|o|O|1|TRUE|true|表示)$/.test(show)) return;
      if (!show) return;
      const brands = (r[iBrand] || '').split(/[、,，\/／・\s]+/).map((b) => b.trim()).filter(Boolean);
      if (!brands.length) return;
      const id = (iId >= 0 && (r[iId] || '').trim()) || `row${i + 2}`;
      const s = { n: name, la, lo, u: id, b: brands, a: iAddr >= 0 ? (r[iAddr] || '').trim() : '' };
      const u = iUrl >= 0 ? (r[iUrl] || '').trim() : '';
      if (/^https?:\/\//.test(u)) s.url = u;
      else if (!/^\d+$/.test(id)) s.url = '';
      out.push(s);
    });
    if (out.length < 1) throw new Error('sheet empty');
    return out;
  }
  async function loadStores() {
    if (CFG.SHEET_ID) {
      try { return await loadFromSheet(); }
      catch (e) { console.warn('スプレッドシートを読めなかったため stores.json を使います', e); }
    }
    const res = await fetch('stores.json');
    return res.json();
  }
  const routeUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.la},${s.lo}`;

  function pinIcon(text, active) {
    const small = text.length > 2 ? ' small' : '';
    return L.divIcon({
      className: '',
      html: `<div class="pin${small}${active ? ' active' : ''}"><svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 0C6.7 0 0 6.5 0 14.6 0 25.5 15 40 15 40s15-14.5 15-25.4C30 6.5 23.3 0 15 0z" fill="#c8161d"/></svg><span>${text}</span></div>`,
      iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36],
    });
  }

  function showMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = 'message' + (kind === 'info' ? ' info' : '');
    els.message.hidden = !text;
  }

  function setSheet(stateName) {
    els.panel.dataset.state = stateName;
    els.layout.dataset.sheet = stateName;
  }

  // ===== 位置の検索（ジオコーディング） =====
  // Google のジオコーダー（config.js に GOOGLE_MAPS_KEY があるときだけ）
  let gmapsReady = null;
  function loadGoogle() {
    if (!CFG.GOOGLE_MAPS_KEY) return Promise.resolve(false);
    if (!gmapsReady) {
      gmapsReady = new Promise((resolve) => {
        window.__gmapsLoaded = () => resolve(true);
        const sc = document.createElement('script');
        sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.GOOGLE_MAPS_KEY)}&language=ja&region=JP&loading=async&callback=__gmapsLoaded`;
        sc.async = true;
        sc.onerror = () => resolve(false);
        document.head.appendChild(sc);
        setTimeout(() => resolve(false), 8000);
      });
    }
    return gmapsReady;
  }
  async function geocodeGoogle(query) {
    if (!(await loadGoogle()) || !window.google || !google.maps || !google.maps.Geocoder) return [];
    const gc = new google.maps.Geocoder();
    try {
      const { results } = await gc.geocode({ address: query, region: 'jp', componentRestrictions: { country: 'JP' } });
      const uniq = [];
      (results || []).slice(0, 5).forEach((r) => {
        const p = [r.geometry.location.lat(), r.geometry.location.lng()];
        if (!uniq.some((u) => distanceKm(u.pos, p) < 3)) {
          uniq.push({ pos: p, label: r.formatted_address.replace(/^日本、(〒\d{3}-\d{4} )?/, '') });
        }
      });
      return uniq;
    } catch (e) { return []; }
  }

  // 駅名検索（HeartRails Express：県名・路線名つき）
  async function geocodeStation(query) {
    const name = query.replace(/\s+/g, '').replace(/駅$/, '');
    if (!name) return [];
    try {
      const res = await fetch(`https://express.heartrails.com/api/json?method=getStations&name=${encodeURIComponent(name)}`);
      if (!res.ok) return [];
      const data = await res.json();
      const list = (data.response && data.response.station) || [];
      const groups = [];
      list.forEach((st) => {
        const pos = [Number(st.y), Number(st.x)];
        const g = groups.find((x) => x.name === st.name && x.pref === st.prefecture && distanceKm(x.pos, pos) < 1.5);
        if (g) { if (!g.lines.includes(st.line)) g.lines.push(st.line); }
        else groups.push({ name: st.name, pref: st.prefecture, pos, lines: [st.line] });
      });
      return groups.map((g) => ({
        pos: g.pos,
        label: `${g.name}駅`,
        title: `${g.name}駅（${g.pref}）`,
        sub: g.lines.join('・'),
      }));
    } catch (e) { return []; }
  }

  async function geocode(query) {
    const isStation = /駅$/.test(query.trim());
    // 駅名（「〇〇駅」）は駅データで探す
    if (isStation) {
      const st = await geocodeStation(query);
      if (st.length) return st;
    }
    // 0) Google（キーがあるとき）
    const g = await geocodeGoogle(query);
    if (g.length) return g;
    // 1) OpenStreetMap（駅名・施設名に強い）
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=jp&accept-language=ja&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.length) {
          // 近すぎる候補（同じ駅の出口など）はまとめる
          const uniq = [];
          for (const d of data) {
            const p = [parseFloat(d.lat), parseFloat(d.lon)];
            if (!uniq.some((u) => distanceKm(u.pos, p) < 3)) {
              uniq.push({ pos: p, label: shortName(d) });
            }
          }
          return uniq;
        }
      }
    } catch (e) { /* 次へ */ }
    // 2) 国土地理院（住所に強い）
    try {
      const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.length) return data.slice(0, 5).map((d) => ({ pos: [d.geometry.coordinates[1], d.geometry.coordinates[0]], label: d.properties.title }));
      }
    } catch (e) { /* 失敗 */ }
    // 3) 「駅」を付けずに駅名だけ入れた場合
    if (!isStation) return geocodeStation(query);
    return [];
  }
  function shortName(d) {
    const a = d.address || {};
    const area = [a.province || a.state, a.city || a.town || a.village || a.county, a.suburb || a.quarter].filter(Boolean);
    const name = d.name || (d.display_name || '').split(',')[0];
    return [name, area.length ? `（${area.join(' ')}）` : ''].join('');
  }

  async function runSearch(query) {
    query = query.trim();
    if (!query) return;
    els.q.value = query;
    els.q.blur();
    els.candidates.hidden = true;
    showMessage('検索中…', 'info');
    const results = await geocode(query);
    if (!results.length) {
      showMessage('場所が見つかりませんでした。「〇〇駅」や「〇〇県〇〇市」のように入力してみてください。');
      track('search_not_found', { search_term: query });
      return;
    }
    if (results.length > 1) {
      showMessage('');
      els.candidates.innerHTML = '<p>どちらの場所ですか？</p>' +
        results.map((r, i) => `<button type="button" data-i="${i}"><span class="cand-title">${esc(r.title || r.label)}</span>${r.sub ? `<span class="cand-sub">${esc(r.sub)}</span>` : ''}</button>`).join('');
      els.candidates.hidden = false;
      els.candidates.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      els.candidates.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        els.candidates.hidden = true;
        const r = results[+b.dataset.i];
        setOrigin(r.pos, r.label);
      };
      if (isMobile()) setSheet('open');
      return;
    }
    setOrigin(results[0].pos, results[0].sub ? results[0].label : query);
  }

  function locate() {
    if (!navigator.geolocation) { showMessage('お使いのブラウザでは現在地を取得できません。'); return; }
    showMessage('現在地を取得中…', 'info');
    navigator.geolocation.getCurrentPosition(
      (p) => { els.q.value = ''; setOrigin([p.coords.latitude, p.coords.longitude], '現在地'); },
      () => showMessage('現在地を取得できませんでした。端末・ブラウザの位置情報の設定を確認するか、場所を入力してください。'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ===== 検索結果 =====
  function setOrigin(pos, labelText) {
    state.origin = pos;
    state.originLabel = labelText;
    state.brand = 'すべて';

    const withDist = stores.map((s) => ({ ...s, d: distanceKm(pos, [s.la, s.lo]) })).sort((a, b) => a.d - b.d);
    let nearby = withDist.filter((s) => s.d <= RADIUS_KM);
    let note = '';
    if (!nearby.length) {
      nearby = withDist.filter((s) => s.d <= WIDE_RADIUS_KM);
      if (nearby.length) note = `${RADIUS_KM}km圏内にお店がなかったため、${WIDE_RADIUS_KM}km圏内を表示しています。`;
    }
    if (!nearby.length) {
      nearby = withDist.slice(0, 5);
      note = `${WIDE_RADIUS_KM}km圏内にお店がありませんでした。いちばん近いお店を表示しています。`;
    }
    state.nearby = nearby;
    showMessage(note, 'info');
    track(labelText === '現在地' ? 'search_location' : 'search', {
      search_term: labelText === '現在地' ? '(現在地)' : (els.q.value || labelText),
      result_count: nearby.length,
      nearest_km: nearby.length ? Math.round(nearby[0].d * 10) / 10 : null,
    });

    // URL に反映（共有・再読み込み用）
    const params = new URLSearchParams(location.search);
    if (labelText === '現在地') params.delete('q'); else params.set('q', els.q.value || labelText);
    history.replaceState(null, '', `${location.pathname}${params.toString() ? '?' + params : ''}`);

    if (hereMarker) hereMarker.remove();
    // 検索地点：お店のピンより必ず手前に表示
    hereMarker = L.marker(pos, {
      pane: 'originPane',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: '',
        html: `<div class="origin-mark"><span class="origin-pulse"></span><span class="origin-dot"></span><span class="origin-label">${esc(labelText)}</span></div>`,
        iconSize: [0, 0], iconAnchor: [0, 0],
      }),
    }).addTo(map);

    els.intro.hidden = true;
    els.examples.hidden = true;
    renderBrands();
    renderResults(true);
    if (isMobile()) setSheet('half');
    els.scroll.scrollTop = 0;
  }

  function filtered() {
    return state.brand === 'すべて' ? state.nearby : state.nearby.filter((s) => s.b.includes(state.brand));
  }

  function renderBrands() {
    const counts = new Map();
    state.nearby.forEach((s) => s.b.forEach((b) => counts.set(b, (counts.get(b) || 0) + 1)));
    const items = [['すべて', state.nearby.length], ...[...counts].sort((a, b) => b[1] - a[1])];
    els.chips.innerHTML = items.map(([b, n]) =>
      `<button type="button" data-b="${esc(b)}" aria-pressed="${b === state.brand}">${esc(b)}<span class="n">${n}</span></button>`).join('');
    els.step2.hidden = counts.size <= 1;
  }

  function renderResults(fit) {
    const list = filtered().slice(0, MAX_RESULTS);
    resultLayer.clearLayers();
    markers.clear();
    state.activeId = null;

    list.forEach((s, i) => {
      const lb = label(i);
      s._label = lb;
      const m = L.marker([s.la, s.lo], { icon: pinIcon(lb, false), zIndexOffset: 1000 - i, riseOnHover: true })
        .bindPopup(`<div class="popup-name">${esc(s.n)}</div>${s.a ? `<div class="popup-addr">${esc(s.a)}</div>` : ''}<div class="popup-dist">${esc(state.originLabel)}から ${fmtDist(s.d)}</div>${detailUrl(s) ? `<a class="popup-link" href="${detailUrl(s)}" target="_blank" rel="noopener">お店の詳細を見る →</a>` : ''}`)
        .on('click', () => activate(s.u, { from: 'map' }))
        .addTo(resultLayer);
      markers.set(s.u, m);
    });

    els.list.innerHTML = list.map((s) => `
      <li class="store" data-id="${esc(s.u)}">
        <span class="pin-badge">${s._label}</span>
        <div class="store-body">
          <p class="store-name">${esc(s.n)}</p>
          ${s.a ? `<div class="store-addr">${esc(s.a)}</div>` : ''}
          <div class="store-dist">${esc(state.originLabel)}から ${fmtDist(s.d)}</div>
          <div class="tags">${s.b.map((b) => `<span class="tag">${esc(b)}</span>`).join('')}</div>
          <div class="store-actions">
            ${detailUrl(s) ? `<a class="btn-detail" href="${detailUrl(s)}" target="_blank" rel="noopener" data-track="click_detail">お店の詳細</a>` : ''}
            <a class="btn-route" href="${routeUrl(s)}" target="_blank" rel="noopener" data-track="click_route">道順を見る</a>
          </div>
        </div>
      </li>`).join('');

    const total = filtered().length;
    const brandText = state.brand === 'すべて' ? '' : `「${state.brand}」`;
    els.meta.textContent = `${total}件${total > MAX_RESULTS ? `（近い順に${MAX_RESULTS}件表示）` : ''}`;
    els.summary.textContent = `${brandText}${total}件のお店が見つかりました`;
    els.step3.hidden = false;

    if (fit) {
      const pts = list.slice(0, 15).map((s) => [s.la, s.lo]).concat([state.origin]);
      const pad = isMobile() ? { paddingTopLeft: [30, 30], paddingBottomRight: [30, window.innerHeight * 0.48] }
                             : { paddingTopLeft: [460, 40], paddingBottomRight: [40, 40] };
      map.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 15 });
    }
  }

  function activate(id, { from }) {
    if (state.activeId && markers.has(state.activeId)) {
      const prev = markers.get(state.activeId);
      prev.setIcon(pinIcon(prev._lb, false));
    }
    els.list.querySelectorAll('.store.active').forEach((el) => el.classList.remove('active'));
    state.activeId = id;
    const m = markers.get(id);
    const li = els.list.querySelector(`.store[data-id="${CSS.escape(String(id))}"]`);
    if (m) { m._lb = li.querySelector('.pin-badge').textContent; m.setIcon(pinIcon(m._lb, true)); }
    if (li) li.classList.add('active');

    if (from === 'map') {
      if (isMobile() && els.panel.dataset.state === 'peek') setSheet('half');
      li && li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (m) {
      const target = m.getLatLng();
      if (isMobile()) {
        setSheet('half');
        const z = Math.max(map.getZoom(), 15);
        const pt = map.project(target, z).add([0, window.innerHeight * 0.2]);
        map.flyTo(map.unproject(pt, z), z, { duration: 0.5 });
      } else {
        const z = Math.max(map.getZoom(), 15);
        const pt = map.project(target, z).subtract([210, 0]);
        map.flyTo(map.unproject(pt, z), z, { duration: 0.5 });
      }
      setTimeout(() => m.openPopup(), 550);
    }
  }

  // ===== イベント =====
  els.form.addEventListener('submit', (e) => { e.preventDefault(); runSearch(els.q.value); });
  els.examples.addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (b) runSearch(b.dataset.q); });
  els.locateBtn.addEventListener('click', locate);
  els.locateFab.addEventListener('click', locate);
  els.chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-b]');
    if (!b) return;
    state.brand = b.dataset.b;
    track('filter_brand', { brand: state.brand });
    els.chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderResults(true);
  });
  els.list.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-track]');
    if (a) {
      const li0 = a.closest('.store');
      const st = state.nearby.find((x) => x.u === li0.dataset.id);
      track(a.dataset.track, { store_name: st ? st.n : '', store_id: li0.dataset.id });
      return;
    }
    if (e.target.closest('a')) return;
    const li = e.target.closest('.store');
    if (li) {
      activate(li.dataset.id, { from: 'list' });
      const st = state.nearby.find((x) => x.u === li.dataset.id);
      track('select_store', { store_name: st ? st.n : '', store_id: li.dataset.id });
    }
  });
  els.handle.addEventListener('click', () => {
    const order = { peek: 'half', half: 'open', open: 'peek' };
    setSheet(order[els.panel.dataset.state] || 'half');
  });
  els.q.addEventListener('focus', () => { if (isMobile()) setSheet('open'); });

  // ===== 起動 =====
  // 最初の表示：スマホはパネル半分、地図は日本全体が見える位置
  setSheet(isMobile() ? 'half' : 'open');
  map.fitBounds([[24.0, 123.0], [45.6, 146.0]], isMobile()
    ? { paddingTopLeft: [10, 10], paddingBottomRight: [10, Math.round(window.innerHeight * 0.46)] }
    : { paddingTopLeft: [450, 20], paddingBottomRight: [20, 20] });
  loadStores().then((data) => {
    stores = data;
    // 全国の店舗を薄い点で表示
    data.forEach((s) => L.circleMarker([s.la, s.lo], { radius: 3.5, weight: 1, color: '#fff', fillColor: '#c8161d', fillOpacity: 0.75 }).addTo(allLayer));
    if (!els.summary.dataset.set) els.summary.textContent = `全国${data.length}店から探す`;
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0) runSearch(q0);
  });
})();
