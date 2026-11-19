(function () {
  'use strict';

  // ───────── Configuración ─────────
  const CONT_NAMES = { AF: 'África', AM: 'América', AS: 'Asia', EU: 'Europa', OC: 'Oceanía' };
  const REGIONS = [
    { key: 'WORLD', name: 'Todo el mundo', box: null },
    { key: 'AF', name: 'África', box: [-26, -36, 60, 38] },
    { key: 'AM', name: 'América', box: [-168, -56, -30, 72] },
    { key: 'AS', name: 'Asia', box: [25, -12, 150, 56] },
    { key: 'EU', name: 'Europa', box: [-25, 34, 45, 71] },
    { key: 'OC', name: 'Oceanía', box: [110, -48, 190, 16] },
  ];
  const REGION_BY_KEY = Object.fromEntries(REGIONS.map(r => [r.key, r]));
  const MODE_NAMES = { locate: 'Ubicar en el mapa', memory: 'De memoria', explore: 'Explorar' };
  const MERGE_INTO = { 'Somaliland': '706', 'N. Cyprus': '196' }; // se dibujan como parte de Somalia / Chipre
  const POINTS = { '798': [179.2, -8.52] }; // Tuvalu no viene dibujado en el mapa
  const SMALL_AREA = 1.6e-4; // estereorradianes (~6.500 km²): debajo de esto lleva círculo
  const MARKER_R = 7; // radio del círculo en px de pantalla
  const MAX_TRIES = 3;

  const flagUrl = (iso, w) => `https://flagcdn.com/w${w || 160}/${iso}.png`;
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'y').replace(/[^a-z0-9]/g, '');
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin storage */ } },
  };

  // ───────── Datos ─────────
  const countries = window.COUNTRIES_RAW.map(([id, iso, name, capital, cont, alt]) => ({
    id, iso, name, capital, cont, keys: [name, ...alt].map(norm), status: null,
  }));
  const byId = new Map(countries.map(c => [c.id, c]));
  const keyIndex = new Map();
  countries.forEach(c => c.keys.forEach(k => keyIndex.set(k, c)));
  const collator = new Intl.Collator('es');
  const byName = (a, b) => collator.compare(a.name, b.name);

  const topo = window.WORLD_TOPO;
  const groups = new Map();
  const others = [];
  topo.objects.countries.geometries.forEach(g => {
    const name = g.properties && g.properties.name;
    if (name === 'Antarctica') return;
    const id = g.id || MERGE_INTO[name];
    if (id && byId.has(id)) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(g);
    } else {
      others.push(topojson.feature(topo, g));
    }
  });

  function fixArea(a) { return a > 2 * Math.PI ? 4 * Math.PI - a : a; }
  function mainPolygon(geom) {
    if (geom.type === 'Polygon') return geom;
    let best = null, bestA = -1;
    geom.coordinates.forEach(coords => {
      const p = { type: 'Polygon', coordinates: coords };
      const a = fixArea(d3.geoArea(p));
      if (a > bestA) { bestA = a; best = p; }
    });
    return best;
  }

  countries.forEach(c => {
    const gs = groups.get(c.id);
    if (gs) {
      const geometry = gs.length === 1 ? topojson.feature(topo, gs[0]).geometry : topojson.merge(topo, gs);
      c.feature = { type: 'Feature', geometry };
      c.isPoint = false;
      c.area = fixArea(d3.geoArea(c.feature));
      c.main = mainPolygon(geometry);
      c.anchor = d3.geoCentroid(c.main);
    } else {
      c.feature = { type: 'Feature', geometry: { type: 'Point', coordinates: POINTS[c.id] } };
      c.isPoint = true;
      c.area = 0;
      c.anchor = POINTS[c.id];
    }
    c.small = c.isPoint || c.area < SMALL_AREA;
  });

  // ───────── Mapa ─────────
  const stage = $('stage');
  const projection = d3.geoNaturalEarth1().rotate([-11, 0]);
  const path = d3.geoPath(projection);
  const svg = d3.select('#map');
  const vp = svg.append('g');
  const sphereP = vp.append('path').datum({ type: 'Sphere' }).attr('class', 'sphere');
  const gratP = vp.append('path').datum(d3.geoGraticule10()).attr('class', 'graticule');
  const otherPaths = vp.append('g').selectAll('path').data(others).join('path').attr('class', 'land terr');
  const landPaths = vp.append('g').selectAll('path').data(countries.filter(c => !c.isPoint)).join('path')
    .attr('class', 'land in').each(function (c) { c.el = this; });
  const markers = vp.append('g').selectAll('circle').data(countries.filter(c => c.small)).join('circle')
    .attr('class', 'marker in').each(function (c) { c.mk = this; });
  const fxG = vp.append('g');

  let W = 0, H = 0, curT = d3.zoomIdentity;
  const zoom = d3.zoom().scaleExtent([0.8, 90]).on('zoom', e => {
    curT = e.transform;
    vp.attr('transform', curT);
    updateMarkers();
    hideTooltip();
  });
  svg.call(zoom).on('dblclick.zoom', null);

  function layout() {
    const r = stage.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    svg.attr('width', W).attr('height', H);
    projection.fitExtent([[10, 10], [W - 10, H - 10]], { type: 'Sphere' });
    sphereP.attr('d', path);
    gratP.attr('d', path);
    otherPaths.attr('d', path);
    landPaths.attr('d', c => path(c.feature));
    countries.forEach(c => {
      c.px = projection(c.anchor);
      if (c.isPoint) { c.size = 0; return; }
      const b = path.bounds(c.main);
      c.size = Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1]);
    });
    markers.attr('cx', c => c.px[0]).attr('cy', c => c.px[1]);
    zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.3, -H * 0.3], [W * 1.3, H * 1.3]]);
  }

  function updateMarkers() {
    const k = curT.k;
    markers.attr('r', MARKER_R / k).classed('hidden', c => !c.isPoint && c.size * k > 18);
  }

  function regionTransform(key) {
    const r = REGION_BY_KEY[key];
    if (!r || !r.box) {
      // Pantalla vertical (celular): el mundo entero queda muy chico, así que arrancamos más cerca
      const b = path.bounds({ type: 'Sphere' });
      const mapH = b[1][1] - b[0][1];
      if (H / W < 1.1 || !mapH) return d3.zoomIdentity;
      const k = Math.min(2.6, (H * 0.6) / mapH);
      const [cx, cy] = projection([20, 12]);
      return d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k);
    }
    const [x0, y0, x1, y1] = r.box;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i <= 24; i++) {
      const lon = x0 + (x1 - x0) * i / 24, lat = y0 + (y1 - y0) * i / 24;
      [[lon, y0], [lon, y1], [x0, lat], [x1, lat]].forEach(pt => {
        const p = projection(pt);
        if (!p) return;
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      });
    }
    const k = 0.94 * Math.min(W / (maxX - minX), H / (maxY - minY));
    return d3.zoomIdentity.translate(W / 2 - k * (minX + maxX) / 2, H / 2 - k * (minY + maxY) / 2).scale(k);
  }
  function goRegion(animate) {
    const t = regionTransform(currentRegionKey());
    if (animate) svg.transition().duration(700).call(zoom.transform, t);
    else svg.call(zoom.transform, t);
  }
  function flyTo(c) {
    let k, cx, cy;
    // Si la lista está abierta en pantalla grande, centramos en la parte visible del mapa
    const drawerW = !drawer.hidden && W > 720 ? drawer.offsetWidth : 0;
    const vw = W - drawerW;
    if (c.isPoint) { k = 12; [cx, cy] = c.px; }
    else {
      const b = path.bounds(c.main);
      const dx = Math.max(b[1][0] - b[0][0], 1), dy = Math.max(b[1][1] - b[0][1], 1);
      // tope de zoom: los países muy chicos se ven con su entorno (y con su círculo)
      k = Math.max(1.5, Math.min(14, 0.4 / Math.max(dx / vw, dy / H)));
      cx = (b[0][0] + b[1][0]) / 2; cy = (b[0][1] + b[1][1]) / 2;
    }
    const t = d3.zoomIdentity.translate(vw / 2 - k * cx, H / 2 - k * cy).scale(k);
    svg.transition().duration(750).call(zoom.transform, t);
  }
  function isOnScreen(c) {
    const [x, y] = curT.apply(c.px);
    return x > 20 && x < W - 20 && y > 20 && y < H - 20;
  }
  function ping(c) {
    const k = curT.k;
    for (let i = 0; i < 3; i++) {
      fxG.append('circle').attr('class', 'ping')
        .attr('cx', c.px[0]).attr('cy', c.px[1]).attr('r', 3 / k)
        .transition().delay(i * 350).duration(1000).ease(d3.easeCubicOut)
        .attr('r', 40 / k).style('opacity', 0).remove();
    }
  }

  // ───────── Pintado ─────────
  let inRegion = new Set(countries);
  function paint(c) {
    const reg = inRegion.has(c) ? ' in' : ' out';
    const st = c.status ? ' ' + c.status : '';
    if (c.el) c.el.setAttribute('class', 'land' + reg + st);
    if (c.mk) c.mk.setAttribute('class', 'marker' + reg + st + (c.mk.classList.contains('hidden') ? ' hidden' : ''));
  }
  function paintAll() { countries.forEach(paint); updateMarkers(); }
  function addCls(c, cls) { if (c.el) c.el.classList.add(cls); if (c.mk) c.mk.classList.add(cls); }
  function rmCls(c, cls) { if (c.el) c.el.classList.remove(cls); if (c.mk) c.mk.classList.remove(cls); }

  // ───────── Estado ─────────
  const saved = store.get('pdm-settings') || {};
  const settings = {
    region: REGION_BY_KEY[saved.region] ? saved.region : 'WORLD',
    mode: MODE_NAMES[saved.mode] ? saved.mode : 'locate',
    timerOn: !!saved.timerOn,
    secs: Number.isFinite(saved.secs) && saved.secs > 0 ? saved.secs : 300,
  };
  let game = null;
  let selected = null;
  let ticker = null;
  function currentRegionKey() { return game ? game.region : settings.region; }

  // ───────── Opciones (setup) ─────────
  const setupEl = $('setup');
  const regionChips = $('region-chips');
  REGIONS.forEach(r => {
    const n = r.key === 'WORLD' ? countries.length : countries.filter(c => c.cont === r.key).length;
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.region = r.key;
    b.innerHTML = `${r.name} <small>${n}</small>`;
    regionChips.appendChild(b);
  });
  regionChips.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.region = b.dataset.region; renderSetup();
    if (!game || game.over) { inRegion = regionSet(settings.region); paintAll(); goRegion(true); }
  });
  $('mode-cards').addEventListener('click', e => {
    const b = e.target.closest('.mode'); if (!b) return;
    settings.mode = b.dataset.mode; renderSetup();
  });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    settings.timerOn = b.dataset.timer === 'on'; renderSetup();
  }));
  $('time-presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.secs = +b.dataset.secs; settings.timerOn = true; renderSetup();
  });
  ['t-min', 't-sec'].forEach(id => $(id).addEventListener('input', () => {
    const m = Math.max(0, Math.min(180, parseInt($('t-min').value, 10) || 0));
    const s = Math.max(0, Math.min(59, parseInt($('t-sec').value, 10) || 0));
    settings.secs = m * 60 + s;
    highlightPreset();
  }));
  function highlightPreset() {
    document.querySelectorAll('#time-presets button').forEach(b => b.classList.toggle('on', +b.dataset.secs === settings.secs));
  }
  function renderSetup() {
    regionChips.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.region === settings.region));
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', (b.dataset.timer === 'on') === settings.timerOn));
    $('timer-section').hidden = settings.mode === 'explore';
    $('timer-cfg').classList.toggle('disabled', !settings.timerOn);
    $('t-min').value = Math.floor(settings.secs / 60);
    $('t-sec').value = settings.secs % 60;
    highlightPreset();
    $('btn-start').textContent = settings.mode === 'explore' ? 'Explorar' : 'Empezar';
  }
  function openSetup() {
    if (game && !game.over) pauseClock();
    $('setup-cancel').hidden = !game;
    $('results').hidden = true;
    renderSetup();
    setupEl.hidden = false;
  }
  function closeSetup() {
    setupEl.hidden = true;
    if (game && !game.over && !game.userPaused) {
      resumeClock();
      if (game.mode === 'memory') $('type-input').focus();
    }
  }

  // Pausa manual (botón ⏸ al lado del tiempo)
  function setUserPause(on) {
    if (!game || game.over || game.mode === 'explore') return;
    game.userPaused = on;
    if (on) { clearTimeout(pendingAccept); pauseClock(); } else resumeClock();
    $('paused').hidden = !on;
    $('type-input').disabled = on;
    updatePauseBtn();
    tick();
    if (!on && game.mode === 'memory') $('type-input').focus();
  }
  function updatePauseBtn() {
    const b = $('btn-pause');
    const on = !!(game && game.userPaused);
    b.classList.toggle('is-paused', on);
    b.title = on ? 'Reanudar el tiempo' : 'Pausar el tiempo';
    b.setAttribute('aria-label', b.title);
    $('stat-time').classList.toggle('paused', on);
  }
  $('btn-pause').addEventListener('click', () => setUserPause(!(game && game.userPaused)));
  $('btn-resume').addEventListener('click', () => setUserPause(false));
  $('btn-options').addEventListener('click', openSetup);
  $('setup-cancel').addEventListener('click', closeSetup);
  $('btn-start').addEventListener('click', () => {
    if (settings.timerOn && settings.secs <= 0) settings.secs = 60;
    store.set('pdm-settings', settings);
    startGame();
  });

  // ───────── Juego ─────────
  function regionSet(key) {
    return new Set(key === 'WORLD' ? countries : countries.filter(c => c.cont === key));
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function startGame() {
    stopTicker();
    const mode = settings.mode;
    inRegion = regionSet(settings.region);
    const list = [...inRegion];
    game = {
      mode, region: settings.region, list, total: list.length,
      correct: 0, first: 0, misses: [], found: new Set(),
      queue: shuffle(list.slice()), current: null, attempts: 0, locked: false, over: false,
      timerOn: mode !== 'explore' && settings.timerOn, limitMs: settings.secs * 1000,
      elapsedMs: 0, resumedAt: performance.now(), paused: false,
    };
    countries.forEach(c => { c.status = null; });
    clearSelection();
    fxG.selectAll('*').remove();
    paintAll();

    setupEl.hidden = true;
    $('results').hidden = true;
    closeDrawer();
    $('hud').hidden = false;
    $('hud-label').textContent = `${REGION_BY_KEY[game.region].name} · ${MODE_NAMES[mode]}`;
    $('stat-score').hidden = mode === 'explore';
    $('stat-time').hidden = mode === 'explore';
    $('btn-restart').hidden = mode === 'explore';
    $('btn-pause').hidden = mode === 'explore';
    $('paused').hidden = true;
    updatePauseBtn();
    showNames = false;
    $('time-label').textContent = game.timerOn ? 'Queda' : 'Tiempo';
    $('btn-skip').hidden = mode !== 'locate';
    $('btn-list').hidden = mode === 'locate';
    setListBtn(false);
    $('btn-end').hidden = mode === 'explore';
    $('btn-end').textContent = mode === 'memory' ? 'Me rindo' : 'Terminar';
    $('prompt').hidden = mode !== 'locate';
    $('typebox').hidden = mode !== 'memory';
    $('type-input').disabled = false;
    $('type-input').value = '';
    setHint('');
    updateScore(false);
    requestAnimationFrame(() => { layout(); goRegion(true); });

    if (mode === 'locate') nextQuestion();
    if (mode === 'memory') setTimeout(() => $('type-input').focus(), 50);
    if (mode === 'explore') toast('Tocá un país para ver su nombre, bandera y capital');
    if (mode !== 'explore') { tick(); ticker = setInterval(tick, 200); }
  }

  // Reloj
  function elapsed() {
    if (!game) return 0;
    return game.elapsedMs + (game.paused || game.over ? 0 : performance.now() - game.resumedAt);
  }
  function pauseClock() { if (!game || game.paused) return; game.elapsedMs = elapsed(); game.paused = true; }
  function resumeClock() { if (!game || !game.paused) return; game.paused = false; game.resumedAt = performance.now(); }
  function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }
  function fmt(totalSec) {
    totalSec = Math.max(0, totalSec);
    const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function tick() {
    if (!game || game.over) return;
    const el = elapsed();
    if (game.timerOn) {
      const left = game.limitMs - el;
      $('time-value').textContent = fmt(Math.ceil(left / 1000));
      $('stat-time').classList.toggle('warn', left <= 10000);
      if (left <= 0) finish('time');
    } else {
      $('time-value').textContent = fmt(Math.floor(el / 1000));
      $('stat-time').classList.remove('warn');
    }
  }

  function updateScore(bump) {
    $('score-num').textContent = game ? game.correct : 0;
    $('score-total').textContent = game ? game.total : 0;
    if (bump) {
      const v = $('stat-score').querySelector('.stat-value');
      v.classList.remove('score-bump'); void v.offsetWidth; v.classList.add('score-bump');
    }
  }

  // Modo ubicar
  function nextQuestion() {
    if (!game || game.over) return;
    if (!game.queue.length) { game.current = null; finish('done'); return; }
    const c = game.current = game.queue.shift();
    game.attempts = 0; game.locked = false;
    const img = $('prompt-flag');
    img.src = flagUrl(c.iso, 160);
    img.srcset = `${flagUrl(c.iso, 320)} 2x`;
    img.alt = `Bandera de ${c.name}`;
    $('prompt-name').textContent = c.name;
    updateTries();
    const p = $('prompt');
    p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop');
    if (game.queue[0]) { const pre = new Image(); pre.src = flagUrl(game.queue[0].iso, 160); }
  }
  function updateTries() {
    $('tries').querySelectorAll('i').forEach((d, i) => d.classList.toggle('used', i < game.attempts));
  }
  function onLocate(c) {
    if (game.locked || !game.current) return;
    const t = game.current;
    if (c === t) {
      game.correct++;
      if (game.attempts === 0) game.first++;
      t.status = game.attempts === 0 ? 'ok1' : 'ok2';
      paint(t);
      updateScore(true);
      toast(`✓ ${t.name} <small>· Capital: ${t.capital}</small>`, 'ok');
      game.locked = true;
      setTimeout(nextQuestion, 700);
      return;
    }
    game.attempts++;
    updateTries();
    flashWrong(c);
    if (game.attempts >= MAX_TRIES) {
      t.status = 'miss';
      paint(t);
      game.misses.push(t);
      toast(`✗ Era ${t.name} <small>· te lo marqué en rojo</small>`, 'bad', 2000);
      game.locked = true;
      if (!isOnScreen(t)) { goRegion(true); setTimeout(() => ping(t), 750); } else ping(t);
      setTimeout(nextQuestion, 2000);
    } else {
      toast(`✗ Eso es ${c.name}`, 'bad');
    }
  }
  function flashWrong(c) {
    addCls(c, 'wrong');
    setTimeout(() => rmCls(c, 'wrong'), 900);
  }
  $('btn-skip').addEventListener('click', () => {
    if (!game || game.over || game.mode !== 'locate' || game.locked || game.userPaused || !game.current) return;
    game.queue.push(game.current);
    nextQuestion();
  });

  // Modo memoria
  const input = $('type-input');
  let pendingAccept = null;
  function setHint(html, cls) {
    const h = $('type-hint');
    h.innerHTML = html;
    $('typebox').classList.toggle('good', cls === 'good');
  }
  function matchInput(raw) {
    const variants = [raw, raw.replace(/^\s*(el|la|los|las|the)\s+/i, '')];
    for (const v of variants) {
      const k = norm(v);
      if (k && keyIndex.has(k)) return { c: keyIndex.get(k), k };
    }
    return null;
  }
  function hasLongerPrefix(k, c) {
    return game.list.some(o => o !== c && !game.found.has(o) && o.keys.some(x => x.length > k.length && x.startsWith(k)));
  }
  function tryMatch(enter) {
    clearTimeout(pendingAccept);
    if (!game || game.over || game.mode !== 'memory' || game.userPaused) return;
    const raw = input.value;
    if (!raw.trim()) { if (!enter) setHint(''); return; }
    const m = matchInput(raw);
    if (!m) {
      if (enter) {
        setHint(`“${escapeHtml(raw.trim())}” no está en la lista`);
        shakeBox();
      }
      return;
    }
    const { c, k } = m;
    if (!inRegion.has(c)) {
      setHint(`${c.name} no está en ${REGION_BY_KEY[game.region].name}`);
      if (enter) { input.value = ''; shakeBox(); }
      return;
    }
    if (game.found.has(c)) {
      setHint(`Ya pusiste ${c.name}`);
      if (enter) input.value = '';
      return;
    }
    if (!enter && hasLongerPrefix(k, c)) {
      setHint(`¿${c.name}? Apretá Enter o esperá un segundo…`);
      pendingAccept = setTimeout(() => accept(c), 1300);
      return;
    }
    accept(c);
  }
  function accept(c) {
    if (!game || game.over || game.found.has(c)) return;
    game.found.add(c);
    game.correct++;
    c.status = 'found';
    paint(c);
    updateScore(true);
    input.value = '';
    setHint(`✓ ${c.name} <span class="muted">· ${c.capital}</span>`, 'good');
    if (!$('drawer').hidden) renderList();
    if (game.correct === game.total) finish('done');
  }
  function shakeBox() {
    const b = $('typebox');
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
  }
  input.addEventListener('input', () => tryMatch(false));
  $('typebox').addEventListener('submit', e => { e.preventDefault(); tryMatch(true); });

  // Reiniciar: misma región, modo y tiempo que la partida actual
  $('btn-restart').addEventListener('click', () => {
    if (!game) return;
    const hasProgress = !game.over && (game.correct > 0 || game.misses.length > 0);
    if (hasProgress && !window.confirm('¿Reiniciar el juego? Vas a perder lo que llevás.')) return;
    settings.region = game.region;
    settings.mode = game.mode;
    settings.timerOn = game.timerOn;
    if (game.timerOn) settings.secs = Math.round(game.limitMs / 1000);
    startGame();
  });

  // Terminar
  $('btn-end').addEventListener('click', () => {
    if (!game || game.over) return;
    finish('quit');
  });
  function finish(reason) {
    if (!game || game.over) return;
    clearTimeout(pendingAccept);
    game.elapsedMs = elapsed();
    if (game.timerOn) game.elapsedMs = Math.min(game.elapsedMs, game.limitMs);
    game.over = true;
    stopTicker();
    tick();
    if (game.timerOn) $('time-value').textContent = fmt(Math.max(0, Math.ceil((game.limitMs - game.elapsedMs) / 1000)));
    $('stat-time').classList.remove('warn');

    if (game.mode === 'locate') {
      const rest = (game.current && !game.current.status ? [game.current] : []).concat(game.queue);
      rest.forEach(c => { if (!c.status) { c.status = 'miss'; game.misses.push(c); } });
      game.current = null;
    } else if (game.mode === 'memory') {
      game.list.forEach(c => { if (!game.found.has(c)) { c.status = 'miss'; game.misses.push(c); } });
      game.misses.sort(byName);
    }
    paintAll();

    $('prompt').hidden = true;
    $('typebox').hidden = true;
    input.disabled = true;
    $('btn-skip').hidden = true;
    $('btn-end').hidden = true;
    $('btn-pause').hidden = true;
    $('paused').hidden = true;
    game.userPaused = false;
    updatePauseBtn();
    $('btn-list').hidden = false;
    if (!$('drawer').hidden) renderList();
    showResults(reason);
  }

  function showResults(reason) {
    const g = game;
    const perfect = g.correct === g.total;
    $('res-title').textContent = reason === 'time' ? '¡Se terminó el tiempo!'
      : perfect ? '¡Perfecto, no te faltó ninguno!' : reason === 'quit' ? 'Prueba terminada' : '¡Terminaste!';
    $('res-num').textContent = g.correct;
    $('res-total').textContent = g.total;
    const pct = Math.round(100 * g.correct / g.total);
    const parts = [`${pct}%`, `tiempo: ${fmt(Math.round(g.elapsedMs / 1000))}`];
    if (g.mode === 'locate') parts.push(`${g.first} a la primera`);
    $('res-sub').textContent = parts.join(' · ');
    const ul = $('res-missed');
    ul.innerHTML = '';
    g.misses.forEach(c => {
      const li = document.createElement('li');
      li.innerHTML = `<img src="${flagUrl(c.iso, 40)}" alt="" loading="lazy">${c.name}`;
      ul.appendChild(li);
    });
    $('res-missed-wrap').hidden = !g.misses.length;
    $('res-missed-title').textContent = g.mode === 'locate' ? `Para repasar (${g.misses.length})` : `Te faltaron (${g.misses.length})`;
    $('results').hidden = false;
  }
  $('res-map').addEventListener('click', () => {
    $('results').hidden = true;
    toast('Tocá cualquier país para ver cuál es');
  });
  $('res-options').addEventListener('click', openSetup);
  $('res-again').addEventListener('click', startGame);

  // ───────── Info de país / tooltip ─────────
  function canInspect(c) {
    if (!game || game.over || game.mode === 'explore') return true;
    if (game.mode === 'memory') return !!c.status;
    if (game.mode === 'locate') return !!c.status;
    return false;
  }
  function showInfo(c) {
    clearSelection();
    selected = c;
    addCls(c, 'sel');
    $('info-flag').src = flagUrl(c.iso, 160);
    $('info-flag').srcset = `${flagUrl(c.iso, 320)} 2x`;
    $('info-flag').alt = `Bandera de ${c.name}`;
    $('info-name').textContent = c.name;
    $('info-capital').textContent = `Capital: ${c.capital}`;
    $('info-cont').textContent = CONT_NAMES[c.cont];
    $('infocard').hidden = false;
  }
  function clearSelection() {
    if (selected) rmCls(selected, 'sel');
    selected = null;
    $('infocard').hidden = true;
  }
  $('infocard-close').addEventListener('click', clearSelection);

  const tip = $('tooltip');
  function showTooltip(c, e) {
    if (!canInspect(c) || !e || e.pointerType === 'touch') return;
    tip.textContent = c.name;
    tip.hidden = false;
    moveTooltip(e);
  }
  function moveTooltip(e) {
    if (tip.hidden) return;
    const r = stage.getBoundingClientRect();
    tip.style.left = (e.clientX - r.left) + 'px';
    tip.style.top = (e.clientY - r.top) + 'px';
  }
  function hideTooltip() { tip.hidden = true; }

  // ───────── Eventos del mapa ─────────
  function onCountry(e, c) {
    if (!inRegion.has(c)) return;
    if (!setupEl.hidden || !$('results').hidden) return;
    if (game && !game.over && game.userPaused) return;
    if (game && !game.over && game.mode === 'locate') { onLocate(c); return; }
    if (game && !game.over && game.mode === 'memory') {
      if (c.status) showInfo(c);
      return;
    }
    if (selected === c) { clearSelection(); return; }
    showInfo(c);
  }
  function bindCountryEvents(sel) {
    sel.on('click', onCountry)
      .on('pointerenter', (e, c) => { addCls(c, 'hover'); showTooltip(c, e); })
      .on('pointermove', e => moveTooltip(e))
      .on('pointerleave', (e, c) => { rmCls(c, 'hover'); hideTooltip(); });
  }
  bindCountryEvents(landPaths);
  bindCountryEvents(markers);

  $('zoom-in').addEventListener('click', () => svg.transition().duration(250).call(zoom.scaleBy, 1.7));
  $('zoom-out').addEventListener('click', () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.7));
  $('zoom-reset').addEventListener('click', () => goRegion(true));

  // ───────── Lista (drawer) ─────────
  const drawer = $('drawer');
  const listEl = $('country-list');
  const search = $('drawer-search');
  function openDrawer() {
    drawer.hidden = false;
    setListBtn(true);
    const clickable = !game || game.over || game.mode === 'explore';
    search.hidden = !clickable;
    search.value = '';
    renderList();
  }
  function setListBtn(open) {
    // En pantallas chicas el botón dice solo "Lista" para que la barra entre en un renglón
    const b = $('btn-list');
    b.innerHTML = `<span class="hide-sm">${open ? 'Ocultar lista' : 'Ver lista'}</span><span class="show-sm">Lista</span>`;
    b.classList.toggle('on', open);
  }
  function closeDrawer() {
    drawer.hidden = true;
    setListBtn(false);
  }
  $('btn-list').addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
  $('drawer-close').addEventListener('click', closeDrawer);
  search.addEventListener('input', renderList);
  let showNames = false;
  $('btn-names').addEventListener('click', () => {
    showNames = !showNames;
    renderList();
  });

  function renderList() {
    const key = currentRegionKey();
    const list = [...inRegion].sort(byName);
    const clickable = !game || game.over || game.mode === 'explore';
    const playingMemory = game && !game.over && game.mode === 'memory';
    const q = norm(search.value || '');
    listEl.classList.toggle('clickable', clickable);
    const nb = $('btn-names');
    nb.hidden = !playingMemory;
    nb.setAttribute('aria-pressed', String(showNames));
    nb.querySelector('span').textContent = showNames ? 'Ocultar' : 'Ver nombres';
    nb.title = showNames ? 'Tapar los nombres de la lista' : 'Mostrar los nombres de la lista';
    nb.classList.toggle('on', showNames);
    $('drawer-title').textContent = key === 'WORLD' ? 'Todos los países' : `Países de ${REGION_BY_KEY[key].name}`;
    $('drawer-count').textContent = game && game.mode !== 'explore' ? `${game.correct}/${game.total}` : `${list.length}`;
    const frag = document.createDocumentFragment();
    const conts = key === 'WORLD' ? Object.keys(CONT_NAMES) : [key];
    conts.forEach(ck => {
      const items = list.filter(c => c.cont === ck && (!q || c.keys.some(k => k.includes(q))));
      if (!items.length) return;
      if (key === 'WORLD') {
        const g = document.createElement('li');
        g.className = 'group';
        g.textContent = `${CONT_NAMES[ck]} (${items.length})`;
        frag.appendChild(g);
      }
      items.forEach(c => {
        const li = document.createElement('li');
        const st = c.status === 'found' || c.status === 'ok1' || c.status === 'ok2' ? ' found' : c.status === 'miss' ? ' miss' : '';
        li.className = 'item' + st;
        // En modo memoria los nombres que todavía no pusiste quedan tapados (salvo que pidas verlos)
        const hide = playingMemory && !showNames && c.status !== 'found';
        const label = hide
          ? `<span class="censored" style="width:${Math.max(3, Math.round(c.name.length * 0.62))}em" aria-label="Nombre oculto"></span>`
          : `<span>${c.name}</span>`;
        li.innerHTML = `<img src="${flagUrl(c.iso, 40)}" srcset="${flagUrl(c.iso, 80)} 2x" alt="" loading="lazy">${label}`;
        if (clickable) li.addEventListener('click', () => { showInfo(c); flyTo(c); if (window.innerWidth < 720) closeDrawer(); });
        frag.appendChild(li);
      });
    });
    listEl.replaceChildren(frag);
  }

  // ───────── Toast ─────────
  let toastT = null;
  function toast(html, kind, ms) {
    const t = $('toast');
    t.innerHTML = html;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = 'toast' + (kind ? ' ' + kind : ''); }, ms || 1600);
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ───────── Tema ─────────
  $('btn-theme').addEventListener('click', () => {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('pdm-theme', next); } catch (e) { /* sin storage */ }
  });

  // ───────── Teclado / resize ─────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!drawer.hidden) closeDrawer();
      else if (selected) clearSelection();
    }
  });
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { layout(); goRegion(false); }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    // el reloj sigue corriendo aunque cambies de pestaña (es una prueba)
    tick();
  });

  // ───────── Inicio ─────────
  layout();
  inRegion = regionSet(settings.region);
  paintAll();
  goRegion(false);
  renderSetup();
  setupEl.hidden = false;
})();
