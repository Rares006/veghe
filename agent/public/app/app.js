/* Veghe — aplicația web pentru iPhone, servită de agent.
 *
 * Aceleași file ca aplicația nativă: Stare, Task-uri, Ecran, Camere, Setări.
 * Tokenul vine din link-ul din codul QR (#token=…) și rămâne în adresă, ca
 * scurtătura de pe ecranul principal să-l aibă și ea; în plus îl ținem și în
 * localStorage.
 */
(function () {
  'use strict';

  // ── Stare ────────────────────────────────────────────────────────────────
  const state = {
    token: readToken(),
    tab: 'status',
    status: null,
    tasks: [],
    error: '',
    lastUpdate: 0,
    screen: { url: '', blob: null, at: null, loading: false, error: '', live: false, display: 1, control: false, tool: 'left', trusted: null, lastTap: null },
    cams: { source: 'laptop', webcams: null, camId: '', url: '', frames: [], at: null, loading: false, error: '', live: false },
    sheets: [],
  };

  const STATE_LABEL = { working: 'Lucrează', waiting: 'Așteaptă aprobare', question: 'Așteaptă răspuns', idle: 'Liber' };
  const STATE_COLOR = { working: 'c-green', waiting: 'c-amber', question: 'c-amber', idle: 'c-gray' };
  const TASK_LABEL = { queued: 'În coadă', running: 'Rulează', done: 'Gata', failed: 'Eșuat', cancelled: 'Oprit' };
  const TASK_COLOR = { queued: 'c-amber', running: 'c-green', done: 'c-green', failed: 'c-red', cancelled: 'c-gray' };
  const MODES = [
    ['auto', 'Normal', 'Ca pe laptop: rulează singur ce e sigur și te întreabă (pe telefon) doar la acțiunile care cer o decizie.'],
    ['plan', 'Plan', 'Doar citește și propune un plan. Nu modifică nimic.'],
    ['acceptEdits', 'Editări', 'Modifică fișiere singur. Comenzile din terminal care ar cere aprobare sunt refuzate.'],
    ['bypassPermissions', 'Complet', 'Face orice, fără nicio întrebare. Folosește doar în proiecte pe care le poți reface.'],
  ];
  const MODELS = [['', 'Implicit'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
  const PROVIDERS = [['claude', 'Claude'], ['ollama', 'Ollama']];

  const ICON = {
    tray: '<svg viewBox="0 0 24 24"><path d="M4 4h16l2 9v7H2v-7zm1.6 2-1.5 7H8a4 4 0 0 0 8 0h3.9l-1.5-7z"/></svg>',
    display: '<svg viewBox="0 0 24 24"><path d="M3 4h18v12H3zm2 2v8h14V6zm3 12h8v2H8z"/></svg>',
    video: '<svg viewBox="0 0 24 24"><path d="M3 6h12v12H3zm13 4 5-3v10l-5-3z"/></svg>',
    videoOff: '<svg viewBox="0 0 24 24"><path d="m3.3 2 18.7 18.7-1.4 1.4L17 18.5V18H3V6h1.6L1.9 3.4zM16 10l5-3v10l-3.1-1.9L7.8 6H15v4z"/></svg>',
    laptop: '<svg viewBox="0 0 24 24"><path d="M4 5h16v10H4zm-2 12h20v2H2z"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 4h4v2H6v2H4zm12 0h4v4h-2V6h-2zM4 16h2v2h2v2H4zm14 2v-2h2v4h-4v-2zM9 9h6v6H9z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4zM5 10v11h14V10h-3v2h1v7H7v-7h1v-2z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="m2 21 21-9L2 3v7l15 2-15 2z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
  };

  // ── Utilitare ────────────────────────────────────────────────────────────
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const basename = p => String(p || '').split('/').filter(Boolean).pop() || p;

  function readToken() {
    const m = location.hash.match(/token=([^&]+)/);
    if (m) {
      const t = decodeURIComponent(m[1]);
      try { localStorage.setItem('cl-token', t); } catch (e) { /* mod privat */ }
      return t;
    }
    try { return localStorage.getItem('cl-token') || ''; } catch (e) { return ''; }
  }

  function saveToken(t) {
    state.token = t;
    try { t ? localStorage.setItem('cl-token', t) : localStorage.removeItem('cl-token'); } catch (e) { /* mod privat */ }
    // Tokenul rămâne și în adresă, pentru scurtătura de pe ecranul principal.
    history.replaceState(null, '', t ? '/#token=' + encodeURIComponent(t) : '/');
  }

  function relTime(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'chiar acum';
    if (s < 3600) return 'acum ' + Math.max(1, Math.round(s / 60)) + ' min';
    if (s < 86400) return 'acum ' + Math.round(s / 3600) + ' h';
    if (s < 2 * 86400) return 'ieri';
    return 'acum ' + Math.round(s / 86400) + ' zile';
  }

  function clock(d) {
    const x = d instanceof Date ? d : new Date(d);
    return [x.getHours(), x.getMinutes(), x.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  }

  function duration(sec) {
    if (sec < 60) return sec + ' s';
    if (sec < 3600) return Math.floor(sec / 60) + ' min';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  const badge = (text, color, pulse) =>
    `<span class="badge ${color}">${pulse ? `<span class="dot small pulse ${color}"></span>` : ''}${esc(text)}</span>`;
  const dot = (color, pulse) => `<span class="dot ${color}${pulse ? ' pulse' : ''}"></span>`;
  const panel = (title, body, trailing = '') =>
    `<section class="panel">${title ? `<div class="panel-header"><span class="panel-title">${esc(title)}</span>${trailing}</div>` : ''}${body}</section>`;
  const empty = (icon, title, msg) =>
    `<div class="empty"><div class="icon">${ICON[icon]}</div><h3>${esc(title)}</h3><p class="muted">${esc(msg)}</p></div>`;
  const row = (label, value) => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;

  // ── Rețea ────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    let r;
    try {
      r = await fetch(path, {
        ...opts,
        cache: 'no-store',
        headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + state.token },
      });
    } catch (e) {
      throw new Error('Nu ajung la Mac. E pornit și conectat la Tailscale? Pe iPhone, Tailscale trebuie să fie activ.');
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error; } catch (e) { /* răspuns fără JSON */ }
      if (r.status === 401) msg = 'Tokenul nu se potrivește. Scanează din nou codul QR din aplicația de Mac.';
      throw new Error(msg || 'Eroare ' + r.status + ' de la Mac.');
    }
    return r;
  }
  const getJSON = async path => (await api(path)).json();
  const postJSON = async (path, body) => (await api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })).json();

  const online = () => !state.error && Date.now() - state.lastUpdate < 20000;

  async function refresh() {
    if (!state.token) return;
    try {
      const [status, tasks] = await Promise.all([getJSON('/api/status'), getJSON('/api/tasks')]);
      state.status = status;
      state.tasks = tasks.tasks;
      state.error = '';
      state.lastUpdate = Date.now();
    } catch (e) {
      state.error = e.message;
    }
    // Filele cu formulare nu se redesenează singure (s-ar pierde ce scrii), iar
    // Camere doar când se schimbă legătura cu CamFlow (altfel imaginile clipesc).
    const connected = Boolean(state.status?.cameras.connected);
    const camsChanged = connected !== refresh.lastConnected;
    refresh.lastConnected = connected;
    if (!state.sheets.length && (['status', 'tasks'].includes(state.tab) || (state.tab === 'cameras' && camsChanged))) render();
    renderTabs();
  }

  function startPolling() {
    clearInterval(startPolling.timer);
    refresh();
    startPolling.timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 3000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // ── File ─────────────────────────────────────────────────────────────────
  const view = $('#view');
  const tabs = $('#tabs');

  function renderTabs() {
    tabs.hidden = !state.token;
    const waiting = pendingCount();
    tabs.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === state.tab);
      let c = b.querySelector('.count');
      if (b.dataset.tab === 'status' && waiting) {
        if (!c) { c = document.createElement('span'); c.className = 'count'; b.appendChild(c); }
        c.textContent = waiting;
      } else if (c) {
        c.remove();
      }
    });
  }

  function render() {
    if (!state.token) { view.innerHTML = renderOnboarding(); renderTabs(); return; }
    const fn = { status: renderStatus, tasks: renderTasks, screen: renderScreen, cameras: renderCameras, settings: renderSettings }[state.tab];
    view.innerHTML = fn();
    renderTabs();
  }

  function header(title, sub, trailing = '') {
    return `<div class="header"><div style="min-width:0"><h1>${esc(title)}</h1>${sub ? `<span class="pill">${esc(sub)}</span>` : ''}</div>${trailing}</div>`;
  }

  // Stare
  function renderStatus() {
    const s = state.status;
    const on = online();
    let html = header('Laptop', s?.system.host,
      `<div class="online">${dot(on ? 'c-green' : 'c-gray', on)}<span style="color:${on ? 'var(--text)' : 'var(--muted)'}">${on ? 'Online' : 'Offline'}</span></div>`);
    if (!isStandalone() && !dismissed('home-hint')) {
      html += `<div class="hint">Pune aplicația pe ecranul principal: apasă <b>Partajează</b> (pătratul cu săgeată, jos în Safari), apoi <b>Adaugă pe ecranul principal</b>.<div style="margin-top:10px"><button class="btn btn-secondary compact" data-action="dismiss" data-key="home-hint">Am înțeles</button></div></div>`;
    }
    if (state.error) html += `<div class="error">${esc(state.error)}</div>`;
    if (!s) {
      if (!state.error) html += panel('', '<div class="center"><span class="spinner"></span>Mă conectez la Mac…</div>');
      return html;
    }
    html += renderConfirmations();
    // Mac
    let mac = '';
    const b = s.system.battery;
    if (b && b.percent != null) {
      const low = b.percent < 20 && !b.onAC;
      mac += `<div class="row"><span class="label">Baterie</span><span class="battery">${b.onAC ? '<span style="color:var(--green)">⚡</span>' : ''}<span class="bar"><i class="${low ? 'low' : ''}" style="width:${Math.max(4, b.percent)}%"></i></span><b>${b.percent}%</b></span></div>`;
    }
    if (s.system.frontApp) mac += row('În față', s.system.frontApp);
    if (s.system.userIdleSeconds != null) mac += row('Ultima atingere', s.system.userIdleSeconds < 60 ? 'chiar acum' : 'acum ' + duration(s.system.userIdleSeconds));
    if (!s.agent.claudeFound) mac += `<p class="muted" style="color:var(--amber)">Agentul nu găsește programul claude: task-urile nu pot porni.</p>`;
    html += panel('Mac', mac);
    // Coada
    const q = s.queue;
    const since = q.minutesSinceActivity == null ? 'recent' : q.minutesSinceActivity < 1 ? 'chiar acum' : 'acum ' + Math.floor(q.minutesSinceActivity) + ' min';
    const expl = q.isIdle
      ? `Nicio sesiune n-a lucrat în ultimele ${q.idleMinutes} min: un task nou pornește imediat.`
      : `Ultima activitate: ${since}. Task-urile pornesc după ${q.idleMinutes} min fără activitate.`;
    html += panel('Coada de task-uri',
      `<div class="counters">
         <div class="counter"><b style="color:${q.running ? 'var(--green)' : 'var(--gray)'}">${q.running}</b><span>rulează</span></div>
         <div class="counter"><b style="color:${q.queued ? 'var(--amber)' : 'var(--gray)'}">${q.queued}</b><span>așteaptă</span></div>
       </div><p class="muted">${esc(expl)}</p>`,
      badge(q.isIdle ? 'liber' : 'ocupat', q.isIdle ? 'c-green' : 'c-amber'));
    // Sesiuni
    const active = s.sessions.filter(x => x.state !== 'idle').length;
    const list = s.sessions.map((x, i) => `
      ${i ? '<div class="divider"></div>' : ''}
      <div class="session" data-action="open-session" data-id="${esc(x.id)}">
        ${dot(STATE_COLOR[x.state], x.state === 'working')}
        <div class="body">
          <div class="top"><span class="title clamp2">${esc(x.title)}</span>${badge(x.stateLabel || STATE_LABEL[x.state], STATE_COLOR[x.state])}</div>
          <span class="faint">${x.isTask ? '📱 ' : ''}${esc(x.project)} · ${esc(relTime(x.lastActivity))}</span>
          ${x.lastTool && x.state !== 'idle' ? `<span class="mono ellipsis" style="color:var(--${x.state === 'waiting' ? 'amber' : 'green'})">${esc(x.lastTool)}</span>` : ''}
          ${x.lastText ? `<span class="muted clamp2">${esc(x.lastText)}</span>` : ''}
        </div>
        <span class="chev">›</span>
      </div>`).join('');
    html += panel('Sesiuni Claude', list || '<p class="muted">Nicio sesiune în ultimele 3 zile.</p>',
      badge(active ? active + ' active' : 'toate libere', active ? 'c-green' : 'c-gray'));
    return html;
  }

  // Task-uri
  function renderTasks() {
    const running = state.tasks.filter(t => t.status === 'running').length;
    const queued = state.tasks.filter(t => t.status === 'queued').length;
    let html = header('Task-uri', running || queued ? `${running} rulează · ${queued} în coadă` : '',
      '<button class="btn btn-primary btn-round" data-action="new-task" aria-label="Task nou">+</button>');
    if (state.error) html += `<div class="error">${esc(state.error)}</div>`;
    if (!state.tasks.length) {
      html += panel('', empty('tray', 'Niciun task încă', 'Apasă + și scrie ce să facă Claude pe laptop. Task-ul pornește când nu mai lucrează nimic altceva.') +
        `<button class="btn btn-primary block" data-action="new-task">+ Task nou</button>`);
    }
    for (const t of state.tasks) {
      html += `<section class="panel task-card" data-action="open-task" data-id="${esc(t.id)}">
        <div class="row">${badge(TASK_LABEL[t.status], TASK_COLOR[t.status], t.status === 'running')}<span class="faint">${esc(relTime(t.createdAt))}</span></div>
        <div class="prompt clamp3">${esc(t.prompt)}</div>
        <div class="row faint"><span>📁 ${esc(basename(t.cwd))}</span><span class="chev">›</span></div>
      </section>`;
    }
    return html;
  }

  // Ecran
  function renderScreen() {
    const sc = state.screen;
    const at = sc.at ? 'Captură la ' + clock(sc.at) : '';
    let html = `<div class="header"><div style="min-width:0"><h1>Ecran</h1><span class="pill" id="screen-at" ${at ? '' : 'hidden'}>${esc(at)}</span></div>
      ${sc.blob && navigator.canShare ? `<button class="btn btn-secondary btn-round" data-action="share-screen" aria-label="Partajează">${ICON.share}</button>` : ''}</div>`;
    if (sc.url) {
      html += `<div class="shot-wrap"><img id="screen-img" class="shot ${sc.control ? 'control' : ''}" src="${sc.url}" alt="Ecranul Mac-ului"
        data-action="${sc.control ? 'screen-tap' : 'view-image'}" data-src="${sc.url}"></div>`;
    } else {
      html += `<div class="shot shot-empty">${sc.loading ? '<span class="spinner"></span>' : empty('display', 'Nicio captură', 'Apasă butonul ca să vezi ecranul laptopului.')}</div>`;
    }
    html += `<div class="error" id="screen-error" ${sc.error ? '' : 'hidden'}>${esc(sc.error)}</div>`;
    if (sc.control) html += renderControlPanel();
    html += panel('', `
      <div class="btn-row">
        <button class="btn btn-primary" id="screen-capture" data-action="capture-screen" ${sc.loading ? 'disabled' : ''}>${ICON.camera}<span>${sc.loading ? 'Se încarcă…' : 'Captură ecran'}</span></button>
        <button class="btn btn-secondary btn-live ${sc.live ? 'on' : ''}" data-action="live-screen">${dot(sc.live ? 'c-green' : 'c-gray', sc.live)}Live</button>
      </div>
      <button class="btn btn-secondary block btn-live ${sc.control ? 'on' : ''}" data-action="control-toggle">${dot(sc.control ? 'c-green' : 'c-gray', sc.control)}${sc.control ? 'Control activ: atingerile ajung pe Mac' : 'Controlează ecranul'}</button>
      <div class="row"><span class="field-label">Ecranul</span>
        <div class="segmented" style="width:150px">${[1, 2, 3].map(n => `<button class="${sc.display === n ? 'on' : ''}" data-action="display" data-n="${n}">${n}</button>`).join('')}</div>
      </div>`);
    return html;
  }

  function renderControlPanel() {
    const sc = state.screen;
    const tools = [['left', 'Click'], ['double', 'Dublu-click'], ['right', 'Click dreapta']];
    const keys = [['return', '⏎ Enter'], ['escape', 'Esc'], ['tab', '⇥ Tab'], ['delete', '⌫'], ['space', 'Spațiu']];
    const arrows = [['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→']];
    let html = '';
    if (sc.trusted === false) {
      html += `<div class="hint">Mac-ul n-a dat încă voie la click-uri. Pe Mac: <b>System Settings → Privacy & Security → Accessibility</b> → activează <b>node</b>. Apoi apasă din nou pe ecran.</div>`;
    }
    html += panel('Control', `
      <p class="muted">Atinge imaginea și click-ul se face în același loc pe Mac. Pentru precizie, mărește cu două degete.</p>
      <div class="segmented">${tools.map(([v, l]) => `<button class="${sc.tool === v ? 'on' : ''}" data-action="tool" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="btn-row">
        <button class="btn btn-secondary compact" style="flex:1" data-action="scroll" data-dy="500">Derulează ↑</button>
        <button class="btn btn-secondary compact" style="flex:1" data-action="scroll" data-dy="-500">Derulează ↓</button>
      </div>
      <span class="field-label">Tastatură</span>
      <div class="btn-row">
        <input class="input" id="type-text" placeholder="Scrie text pe Mac…" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
        <button class="btn btn-primary compact" style="flex:none" data-action="type-send">Scrie</button>
      </div>
      <div class="keys">${keys.map(([k, l]) => `<button class="btn btn-secondary compact" data-action="key" data-key="${k}">${l}</button>`).join('')}
        ${arrows.map(([k, l]) => `<button class="btn btn-secondary compact" data-action="key" data-key="${k}">${l}</button>`).join('')}</div>`);
    return html;
  }

  // Actualizează doar imaginea, ca tastatura telefonului să nu se închidă.
  function paintScreen() {
    if (state.tab !== 'screen' || state.sheets.length) return;
    const sc = state.screen;
    const img = $('#screen-img');
    if (!img || !sc.url) { render(); return; }
    img.src = sc.url;
    img.dataset.src = sc.url;
    const pill = $('#screen-at');
    if (pill && sc.at) { pill.textContent = 'Captură la ' + clock(sc.at); pill.hidden = false; }
    const btn = $('#screen-capture');
    if (btn) { btn.disabled = sc.loading; btn.querySelector('span').textContent = sc.loading ? 'Se încarcă…' : 'Captură ecran'; }
    const err = $('#screen-error');
    if (err) { err.textContent = sc.error; err.hidden = !sc.error; }
  }

  async function sendInput(body) {
    const sc = state.screen;
    try {
      await postJSON('/api/input', { display: sc.display, ...body });
      sc.trusted = true;
      sc.error = '';
    } catch (e) {
      if (/Accessibility/.test(e.message)) sc.trusted = false;
      sc.error = e.message;
      render();
      return;
    }
    // Arătăm rezultatul cât mai repede.
    clearTimeout(sendInput.timer);
    sendInput.timer = setTimeout(captureScreen, 450);
  }

  function tapMarker(img, fx, fy) {
    const m = document.createElement('span');
    m.className = 'tap-marker';
    m.style.left = (fx * 100) + '%';
    m.style.top = (fy * 100) + '%';
    img.parentElement.appendChild(m);
    setTimeout(() => m.remove(), 700);
  }

  // Camere
  function renderCameras() {
    const c = state.cams;
    const camflow = Boolean(state.status?.cameras.enabled);
    if (!camflow) c.source = 'laptop';
    if (c.source === 'laptop' && c.webcams === null) loadWebcams();
    const connected = c.source === 'laptop' ? Boolean(c.url) : state.status?.cameras.connected;
    const label = c.source === 'laptop' ? (c.url ? 'Laptop' : 'Camera laptopului') : (connected ? 'CamFlow' : 'Deconectat');
    let html = header('Camere', '',
      `<div class="online">${dot(connected ? 'c-green' : 'c-gray', c.live)}<span style="color:${connected ? 'var(--text)' : 'var(--muted)'}">${label}</span></div>`);
    if (camflow) {
      html += `<div class="segmented">${[['laptop', 'Camera laptopului'], ['camflow', 'CamFlow']].map(([v, l]) =>
        `<button class="${c.source === v ? 'on' : ''}" data-action="cam-source" data-v="${v}">${l}</button>`).join('')}</div>`;
    }
    html += c.source === 'laptop' ? renderLaptopCamera() : renderCamflow();
    if (c.error) html += `<div class="error">${esc(c.error)}</div>`;
    const what = c.source === 'laptop' ? 'Vezi camera' : 'Vezi camerele';
    html += panel('', `
      <div class="btn-row">
        <button class="btn btn-primary" data-action="capture-cams" ${c.loading ? 'disabled' : ''}>${ICON.video}${c.loading ? 'Se încarcă…' : what}</button>
        <button class="btn btn-secondary btn-live ${c.live ? 'on' : ''}" data-action="live-cams">${dot(c.live ? 'c-green' : 'c-gray', c.live)}Live</button>
      </div>
      ${c.at ? `<p class="faint" style="text-align:center">Ultimul cadru: ${clock(c.at)}</p>` : ''}`);
    return html;
  }

  function renderLaptopCamera() {
    const c = state.cams;
    let html = '';
    if (c.webcams && c.webcams.length > 1) {
      html += `<select class="input" id="cam-select">${c.webcams.map(w =>
        `<option value="${esc(w.id)}" ${w.id === c.camId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`;
    }
    if (c.url) {
      html += `<div class="cam"><img class="shot" src="${c.url}" alt="Camera laptopului" data-action="view-image" data-src="${c.url}">
        <span class="label">${c.live ? dot('c-red', true).replace('dot', 'dot small') : ''}${esc(cameraName())}</span></div>`;
    } else if (c.loading) {
      html += `<div class="shot shot-empty"><span class="spinner"></span></div>`;
    } else if (c.webcams && !c.webcams.length) {
      html += panel('', empty('videoOff', 'Nicio cameră', 'Mac-ul nu are nicio cameră conectată.'));
    } else {
      html += panel('', empty('video', 'Camera laptopului', 'Apasă butonul ca să vezi ce arată camera Mac-ului. Prima dată, pe Mac apare cererea de acces la cameră.'));
    }
    return html;
  }

  function renderCamflow() {
    const c = state.cams;
    let html = '';
    if (state.status && !state.status.cameras.connected) {
      html += panel('', empty('videoOff', 'CamFlow nu e conectat', 'Deschide CamFlow pe Mac. Puntea se conectează singură când agentul rulează.'));
    } else if (!c.frames.length && !c.loading) {
      html += panel('', empty('video', 'Camere', 'Apasă butonul ca să vezi ce arată camerele din CamFlow.'));
    }
    if (c.frames.length) {
      html += '<div class="cam-grid">' + c.frames.map(f => {
        const src = 'data:image/jpeg;base64,' + f.jpeg;
        return `<div class="cam"><img class="shot" src="${src}" alt="${esc(f.label)}" data-action="view-image" data-src="${src}"><span class="label">${c.live ? dot('c-red', true).replace('dot', 'dot small') : ''}${esc(f.label)}</span></div>`;
      }).join('') + '</div>';
    }
    return html;
  }

  function cameraName() {
    const c = state.cams;
    return c.webcams?.find(w => w.id === c.camId)?.name || 'Camera laptopului';
  }

  async function loadWebcams() {
    const c = state.cams;
    c.webcams = [];
    try {
      c.webcams = (await getJSON('/api/webcams')).cameras;
      // Camera încorporată prima, dacă există.
      const builtIn = c.webcams.find(w => /FaceTime|Built-in|încorporat/i.test(w.name));
      if (!c.camId) c.camId = (builtIn || c.webcams[0] || {}).id || '';
    } catch (e) {
      c.error = e.message;
    }
    if (state.tab === 'cameras' && !state.sheets.length) render();
  }

  // Setări
  function renderSettings() {
    const s = state.status;
    let html = header('Setări', location.host);
    html += panel('Conexiune', `
      <span class="field-label">Token</span>
      <input class="input" id="token" type="password" autocomplete="off" value="${esc(state.token)}" placeholder="din config.json">
      <p class="faint">Tokenul vine din codul QR din aplicația de Mac. Îl poți lipi și aici, din ~/Library/Application Support/ControlLaptop/config.json.</p>
      <button class="btn btn-primary block" data-action="save-token">Salvează</button>`);
    if (s) {
      html += panel('Agent', row('Mac', s.system.host) + row('Pornit de', duration(s.agent.uptimeSeconds)) + row('Adresă', location.host),
        badge('v' + s.agent.version, 'c-green'));
    }
    if (!isStandalone()) {
      html += panel('Pe ecranul principal', '<p class="muted">În Safari apasă <b>Partajează</b>, apoi <b>Adaugă pe ecranul principal</b>. Se deschide ca o aplicație, fără bara browserului.</p>');
    }
    html += `<button class="btn btn-danger block" data-action="forget-token">Deconectează</button>`;
    return html;
  }

  function renderOnboarding() {
    return `
      <div style="padding-top:24px;display:flex;flex-direction:column;gap:14px">
        <img src="/app/logo.svg" alt="" width="76" height="76" style="border-radius:20px;box-shadow:0 6px 18px rgba(16,185,129,.25)">
        <div class="header"><h1 style="font-size:34px">Veghe</h1></div>
        <p class="muted" style="font-size:15px">Pe Mac deschide Veghe → Setări și scanează codul QR cu camera iPhone-ului. Se deschide pagina asta, deja conectată.</p>
      </div>` +
      panel('Sau lipește tokenul', `
        <input class="input" id="token" type="password" autocomplete="off" placeholder="din config.json">
        <button class="btn btn-primary block" data-action="save-token">Conectează</button>`);
  }


  // ── Confirmări: aprobări (Allow/Deny) și întrebări cu butoane ────────────
  function pendingCount() {
    const st = state.status;
    if (!st) return 0;
    const questions = st.sessions.filter(x => x.question && !x.question.answeredTaskId).length;
    const permIds = new Set((st.permissions || []).map(p => p.sessionId));
    const waitingOnMac = st.sessions.filter(x => x.state === 'waiting' && !permIds.has(x.id)).length;
    return (st.permissions || []).length + questions + waitingOnMac;
  }

  function sessionTitle(id) {
    return state.status?.sessions.find(x => x.id === id)?.title || 'Sesiune Claude';
  }

  function questionCard(s) {
    const q = s.question;
    if (q.answeredTaskId) {
      return panel('', `
        <div class="row"><b style="color:var(--title)">${esc(q.text)}</b>${badge('răspuns trimis', 'c-green')}</div>
        <button class="btn btn-secondary block compact" data-action="open-task" data-id="${esc(q.answeredTaskId)}">Vezi task-ul</button>`);
    }
    const buttons = q.options.map((o, i) =>
      `<button class="btn ${i ? 'btn-secondary' : 'btn-primary'} block" data-action="answer" data-id="${esc(s.id)}" data-i="${i}">${esc(o.label)}</button>` +
      (o.description ? `<p class="faint" style="margin-top:-6px">${esc(o.description)}</p>` : '')).join('');
    return panel('', `
      <div class="row"><span class="faint ellipsis">${esc(s.title)}</span>${badge('întrebare', 'c-amber', true)}</div>
      <div style="font-size:16px;font-weight:600;color:var(--title)">${esc(q.text)}</div>
      ${q.recap ? `<p class="muted clamp3">${esc(q.recap)}</p>` : ''}
      ${buttons}
      <button class="btn btn-secondary block compact" data-action="answer-custom" data-id="${esc(s.id)}">Alt răspuns…</button>`);
  }

  function renderConfirmations() {
    const st = state.status;
    let html = '';
    for (const p of st.permissions || []) {
      html += panel('', `
        <div class="row"><span class="faint ellipsis">${esc(sessionTitle(p.sessionId))}</span>${badge('cere aprobare', 'c-amber', true)}</div>
        <div style="font-size:15px;font-weight:600;color:var(--title)">Claude vrea să folosească ${esc(p.tool)}</div>
        <div class="mono" style="color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(p.detail)}</div>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="perm" data-v="allow" data-id="${esc(p.id)}">Permite</button>
          <button class="btn btn-danger" data-action="perm" data-v="deny" data-id="${esc(p.id)}">Refuză</button>
        </div>`);
    }
    for (const s of st.sessions) if (s.question) html += questionCard(s);
    const permIds = new Set((st.permissions || []).map(p => p.sessionId));
    for (const s of st.sessions.filter(x => x.state === 'waiting' && !permIds.has(x.id))) {
      html += panel('', `
        <div class="row"><span class="faint ellipsis">${esc(s.title)}</span>${badge('așteaptă aprobare', 'c-amber')}</div>
        ${s.lastTool ? `<div class="mono" style="color:var(--text)">${esc(s.lastTool)}</div>` : ''}
        <p class="muted">Cererea a apărut pe Mac. De pe telefon o poți aproba doar dacă sesiunea a pornit după instalarea hook-ului și erai plecat de la Mac de peste un minut.</p>`);
    }
    return html;
  }

  // ── Foi de detalii ───────────────────────────────────────────────────────
  const sheetEl = $('#sheet');

  function openSheet(sheet) {
    state.sheets.push(sheet);
    showSheet();
  }

  function closeSheet() {
    const s = state.sheets.pop();
    if (s && s.timer) clearTimeout(s.timer);
    showSheet();
    if (!state.sheets.length) render();
  }

  function showSheet() {
    const s = state.sheets[state.sheets.length - 1];
    if (!s) { sheetEl.hidden = true; sheetEl.className = ''; document.body.style.overflow = ''; return; }
    sheetEl.hidden = false;
    sheetEl.className = s.viewer ? 'viewer' : '';
    document.body.style.overflow = 'hidden';
    sheetEl.innerHTML = `<div class="bar"><button class="back" data-action="back">‹ Înapoi</button><h2 class="ellipsis">${esc(s.title)}</h2></div><div class="content"></div>`;
    sheetEl.scrollTop = 0;
    s.draw();
  }

  function drawSheet(sheet, html) {
    if (state.sheets[state.sheets.length - 1] !== sheet) return;
    const c = $('.content', sheetEl);
    if (c) c.innerHTML = html;
  }

  function openSession(id) {
    const summary = state.status?.sessions.find(s => s.id === id);
    const sheet = { title: summary ? summary.title : 'Sesiune', detail: null, error: '' };
    sheet.draw = () => {
      const d = sheet.detail;
      const st = d ? d.state : summary?.state || 'idle';
      let html = panel('', `
        <div class="row"><span style="display:flex;align-items:center;gap:10px">${dot(STATE_COLOR[st], st === 'working')}<b>${esc(d ? d.stateLabel : summary?.stateLabel || '')}</b></span>${badge(summary?.project || '', 'c-gray')}</div>
        <div style="font-size:18px;font-weight:600;color:var(--title)">${esc(sheet.title)}</div>
        <button class="btn btn-secondary block" data-action="continue-session" data-id="${esc(id)}">${ICON.reply}Continuă ca task</button>`);
      if (sheet.error) html += `<div class="error">${esc(sheet.error)}</div>`;
      const live = state.status?.sessions.find(x => x.id === id);
      if (live?.question) html += questionCard(live);
      loadDocs(sheet, summary?.cwd || d?.cwd);
      html += docsPanel(sheet);
      const items = d ? d.timeline.map(item => {
        const kind = item.kind;
        const color = kind === 'prompt' ? '' : kind === 'tool' ? 'c-gray' : 'c-green';
        const sym = kind === 'prompt' ? '👤' : kind === 'tool' ? '🔧' : '✦';
        return `<div class="event"><span class="icon ${color}">${sym}</span><div><div class="txt ${kind === 'tool' ? 'tool' : ''}">${esc(item.text)}</div>${item.at ? `<span class="faint">${clock(item.at)}</span>` : ''}</div></div>`;
      }).join('') : '<div class="center"><span class="spinner"></span></div>';
      html += panel('Ultimele mesaje', `<div style="display:flex;flex-direction:column;gap:14px">${items}</div>`);
      drawSheet(sheet, html);
    };
    const load = async () => {
      const first = !sheet.detail;
      try { sheet.detail = await getJSON('/api/sessions/' + encodeURIComponent(id)); sheet.error = ''; }
      catch (e) { sheet.error = e.message; }
      sheet.draw();
      // La deschidere arătăm cele mai noi mesaje, care sunt la final.
      if (first && sheet.detail) sheetEl.scrollTop = sheetEl.scrollHeight;
      if (state.sheets.includes(sheet)) sheet.timer = setTimeout(load, 3000);
    };
    openSheet(sheet);
    load();
  }

  function openTask(id) {
    const sheet = { title: 'Task', task: state.tasks.find(t => t.id === id) || null, error: '' };
    sheet.draw = () => {
      const t = sheet.task;
      if (!t) { drawSheet(sheet, sheet.error ? `<div class="error">${esc(sheet.error)}</div>` : '<div class="center"><span class="spinner"></span></div>'); return; }
      const active = t.status === 'queued' || t.status === 'running';
      const mode = MODES.find(m => m[0] === t.permissionMode);
      let actions = '';
      if (t.status === 'queued') actions += `<button class="btn btn-primary block" data-action="task-start" data-id="${esc(t.id)}">${ICON.play}Pornește acum</button>`;
      if (active) actions += `<button class="btn btn-danger block" data-action="task-cancel" data-id="${esc(t.id)}">${ICON.stop}${t.status === 'running' ? 'Oprește' : 'Scoate din coadă'}</button>`;
      if (!active && t.sessionId) actions += `<button class="btn btn-secondary block" data-action="task-continue" data-id="${esc(t.id)}">${ICON.reply}Continuă conversația</button>`;
      if (!active) actions += `<button class="btn btn-secondary block" data-action="task-delete" data-id="${esc(t.id)}">Șterge din istoric</button>`;
      let html = panel('', `
        <div class="row">${badge(TASK_LABEL[t.status], TASK_COLOR[t.status], t.status === 'running')}${t.costUsd != null ? `<span class="faint">$${t.costUsd.toFixed(3)}</span>` : ''}</div>
        <div style="font-size:16px;font-weight:500;color:var(--title);white-space:pre-wrap">${esc(t.prompt)}</div>
        ${row('Folder', basename(t.cwd))}${row('Permisiuni', mode ? mode[1] : t.permissionMode)}
        ${row('Motor', (t.provider === 'ollama' ? 'Ollama' : 'Claude') + (t.model ? ` · ${t.model}` : ''))}
        ${t.status === 'queued' ? '<p class="muted">Așteaptă ca nicio sesiune Claude să nu mai lucreze. Poți să-l pornești și acum.</p>' : ''}
        ${actions}`);
      loadDocs(sheet, t.cwd);
      html += docsPanel(sheet);
      if (t.result && t.status === 'done') html += panel('Rezultat', `<div class="event"><div class="txt">${esc(t.result)}</div></div>`);
      if (t.error) {
        html += panel('Eroare', `<div class="txt" style="color:var(--red);white-space:pre-wrap">${esc(t.error)}</div>` +
          (t.error.includes('/login') ? '<p class="muted">Pe Mac, dă dublu-click pe scripts/login-claude.command și autentifică-te o dată.</p>' : ''));
      }
      const events = (t.events || []).map(ev => {
        const color = ev.kind === 'text' ? 'c-green' : 'c-gray';
        const sym = ev.kind === 'tool' ? '🔧' : ev.kind === 'info' ? 'i' : '✦';
        return `<div class="event"><span class="icon ${color}">${sym}</span><div class="txt ${ev.kind === 'tool' ? 'tool' : ''}">${esc(ev.text)}</div></div>`;
      }).join('');
      html += panel('Desfășurare', `<div style="display:flex;flex-direction:column;gap:12px">${events || '<p class="muted">Încă nimic.</p>'}</div>`);
      if (sheet.error) html += `<div class="error">${esc(sheet.error)}</div>`;
      const nearBottom = sheetEl.scrollHeight - sheetEl.scrollTop - sheetEl.clientHeight < 80;
      drawSheet(sheet, html);
      if (t.status === 'running' && nearBottom) sheetEl.scrollTop = sheetEl.scrollHeight;
    };
    const load = async () => {
      try { sheet.task = await getJSON('/api/tasks/' + encodeURIComponent(id)); sheet.error = ''; }
      catch (e) { sheet.error = e.message; }
      sheet.draw();
      const active = !sheet.task || ['queued', 'running'].includes(sheet.task.status);
      if (state.sheets.includes(sheet)) sheet.timer = setTimeout(load, active ? 2000 : 10000);
    };
    openSheet(sheet);
    load();
  }

  function openNewTask({ cwd = '', resumeSessionId = '', context = '', provider = '' } = {}) {
    const form = {
      prompt: '', cwd, mode: 'auto', model: '', startNow: false, sending: false, error: '', projects: [],
      // Ultimul motor ales rămâne implicit pentru task-urile următoare.
      provider: provider || (() => { try { return localStorage.getItem('cl-provider'); } catch (x) { return ''; } })() || 'claude',
      ollama: null, ollamaModel: '',
    };
    const loadOllama = () => {
      if (form.ollama) return;
      form.ollama = { loading: true, models: [] };
      getJSON('/api/ollama')
        .then(r => { form.ollama = r; form.ollamaModel = r.defaultModel || r.models[0]?.name || ''; })
        .catch(e => { form.ollama = { models: [], error: e.message }; })
        .then(() => sheet.draw());
    };
    const sheet = { title: resumeSessionId ? 'Continuă' : 'Task nou' };
    sheet.draw = () => {
      const mode = MODES.find(m => m[0] === form.mode);
      const options = form.projects.map(p => `<option value="${esc(p.path)}" ${p.path === form.cwd ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
      let html = '';
      if (resumeSessionId) {
        html += panel('', `<b style="color:var(--green)">↪ Continuă: ${esc(context)}</b><p class="muted">Claude pornește cu tot contextul conversației, într-o sesiune separată de aplicația Claude.</p>`);
      }
      html += panel('Ce să facă', `<textarea class="input" id="f-prompt" placeholder="Ex.: rulează testele din proiect și repară ce pică">${esc(form.prompt)}</textarea>`);
      html += panel('Unde', `
        <select class="input" id="f-project"><option value="">Alege proiectul…</option>${options}</select>
        <span class="field-label">sau calea completă</span>
        <input class="input mono" id="f-cwd" value="${esc(form.cwd)}" placeholder="/Users/…" autocapitalize="off" autocorrect="off" spellcheck="false">`);
      html += panel('Cum', `
        <span class="field-label">Permisiuni</span>
        <div class="segmented">${MODES.map(m => `<button class="${m[0] === form.mode ? 'on' : ''}" data-action="f-mode" data-v="${m[0]}">${m[1]}</button>`).join('')}</div>
        <p class="muted" style="color:${form.mode === 'bypassPermissions' ? 'var(--red)' : ''}">${esc(mode[2])}</p>
        <span class="field-label">Motor</span>
        <div class="segmented">${PROVIDERS.map(p => `<button class="${p[0] === form.provider ? 'on' : ''}" data-action="f-provider" data-v="${p[0]}">${p[1]}</button>`).join('')}</div>
        <span class="field-label">Model</span>
        ${form.provider === 'ollama' ? ollamaPicker() : `<div class="segmented">${MODELS.map(m => `<button class="${m[0] === form.model ? 'on' : ''}" data-action="f-model" data-v="${m[0]}">${m[1]}</button>`).join('')}</div>`}
        <label class="switch"><span><b style="font-weight:500">Pornește acum</b><br><span class="faint">${form.startNow ? 'Nu așteaptă celelalte sesiuni.' : 'Așteaptă până nu mai lucrează nicio sesiune Claude.'}</span></span><input type="checkbox" id="f-now" ${form.startNow ? 'checked' : ''}></label>`);
      if (form.error) html += `<div class="error">${esc(form.error)}</div>`;
      html += `<button class="btn btn-primary block" data-action="f-send" ${form.sending ? 'disabled' : ''}>${ICON.send}${form.sending ? 'Trimit…' : 'Trimite task-ul'}</button>`;
      drawSheet(sheet, html);
      if (!$('#f-prompt')) return;
      // Câmpurile își păstrează valoarea în `form` când se redesenează foaia.
      $('#f-prompt').addEventListener('input', e => { form.prompt = e.target.value; });
      $('#f-cwd').addEventListener('input', e => { form.cwd = e.target.value; });
      $('#f-project').addEventListener('change', e => { if (e.target.value) { form.cwd = e.target.value; sheet.draw(); } });
      $('#f-now').addEventListener('change', e => { form.startNow = e.target.checked; sheet.draw(); });
      $('#f-ollama-model')?.addEventListener('change', e => { form.ollamaModel = e.target.value; });
    };
    const ollamaPicker = () => {
      const o = form.ollama;
      if (!o || o.loading) return '<div class="center"><span class="spinner"></span></div>';
      if (!o.models.length) {
        return `<p class="muted" style="color:var(--amber)">${esc(o.error || 'Ollama nu are niciun model instalat. Pe Mac: ollama pull qwen2.5-coder:7b')}</p>`;
      }
      const opts = o.models.map(m => `<option value="${esc(m.name)}" ${m.name === form.ollamaModel ? 'selected' : ''}>${esc(m.name)}${m.parameterSize ? ` · ${esc(m.parameterSize)}` : ''}</option>`).join('');
      return `<select class="input mono" id="f-ollama-model">${opts}</select>
        <p class="muted">Rulează local pe Mac, gratuit, dar mai încet și mai puțin priceput decât Claude. Alege un model care știe unelte (ex. qwen2.5-coder, qwen3, llama3.1).</p>`;
    };
    sheet.setProvider = p => {
      form.provider = p;
      try { localStorage.setItem('cl-provider', p); } catch (x) { /* mod privat */ }
      if (p === 'ollama') loadOllama();
      sheet.draw();
    };
    if (form.provider === 'ollama') loadOllama();
    sheet.form = form;
    sheet.send = async () => {
      if (!form.prompt.trim()) { form.error = 'Scrie ce să facă Claude.'; sheet.draw(); return; }
      if (!form.cwd.trim()) { form.error = 'Alege proiectul sau scrie calea.'; sheet.draw(); return; }
      const ollama = form.provider === 'ollama';
      if (ollama && !form.ollamaModel) { form.error = 'Ollama nu e pornit sau n-are modele.'; sheet.draw(); return; }
      form.sending = true; form.error = ''; sheet.draw();
      try {
        const t = await postJSON('/api/tasks', {
          prompt: form.prompt, cwd: form.cwd, permissionMode: form.mode,
          provider: form.provider, model: ollama ? form.ollamaModel : form.model,
          resumeSessionId, startNow: form.startNow,
        });
        state.sheets.length = 0;
        state.tab = 'tasks';
        await refresh();
        showSheet();
        render();
        openTask(t.id);
      } catch (e) {
        form.error = e.message; form.sending = false; sheet.draw();
      }
    };
    openSheet(sheet);
    getJSON('/api/projects').then(r => {
      form.projects = r.projects;
      if (!form.cwd && r.projects[0]) form.cwd = r.projects[0].path;
      sheet.draw();
    }).catch(() => {});
  }

  // ── Fișierele .md ale proiectului ────────────────────────────────────────
  // Se încarcă o dată la deschiderea foii; foaia le desenează cu docsPanel().
  function loadDocs(sheet, cwd) {
    if (!cwd || sheet.docsCwd === cwd) return;
    sheet.docsCwd = cwd;
    getJSON('/api/docs?cwd=' + encodeURIComponent(cwd))
      .then(r => { sheet.docs = r.docs; })
      // Arătăm doar eroarea de permisiune macOS; restul (ex. agent vechi) ascund panoul.
      .catch(e => { sheet.docs = []; if (/permisiune/.test(e.message)) sheet.docsError = e.message; })
      .then(() => sheet.draw());
  }

  function docsPanel(sheet) {
    if (sheet.docsError) return panel('Fișiere .md', `<p class="muted">${esc(sheet.docsError)}</p>`);
    if (!sheet.docs || !sheet.docs.length) return '';
    const list = sheet.docs.map((d, i) => `
      ${i ? '<div class="divider"></div>' : ''}
      <div class="session" data-action="open-doc" data-cwd="${esc(sheet.docsCwd)}" data-name="${esc(d.name)}">
        <span class="doc-icon">MD</span>
        <div class="body"><span class="title ellipsis">${esc(d.name)}</span><span class="faint">${esc(relTime(d.mtime))} · ${Math.max(1, Math.round(d.size / 1024))} KB</span></div>
        <span class="chev">›</span>
      </div>`).join('');
    return panel('Fișiere .md', list, badge(String(sheet.docs.length), 'c-gray'));
  }

  function openDoc(cwd, name) {
    const sheet = { title: basename(name), doc: null, error: '' };
    sheet.draw = () => {
      if (sheet.error) return drawSheet(sheet, `<div class="error">${esc(sheet.error)}</div>`);
      if (!sheet.doc) return drawSheet(sheet, '<div class="center"><span class="spinner"></span></div>');
      drawSheet(sheet, `<div class="faint">${esc(basename(cwd))}/${esc(name)} · modificat ${esc(relTime(sheet.doc.mtime))}</div>` +
        panel('', `<div class="md">${markdown(sheet.doc.text)}</div>`));
    };
    openSheet(sheet);
    getJSON('/api/docs/file?cwd=' + encodeURIComponent(cwd) + '&name=' + encodeURIComponent(name))
      .then(d => { sheet.doc = d; })
      .catch(e => { sheet.error = e.message; })
      .then(() => sheet.draw());
  }

  // Markdown simplu (titluri, liste, citate, cod, tabele, bold/italic, linkuri).
  // Totul trece prin esc() înainte, deci textul din fișier nu poate injecta HTML.
  function markdown(src) {
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[\[([^\]]+)\]\]/g, '<code>$1</code>');
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let html = '', list = '', i = 0;
    const closeList = () => { if (list) { html += `</${list}>`; list = ''; } };
    // Antetul YAML (---) din fișierele de memorie îl arătăm ca bloc de cod.
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) { html += `<pre class="front">${esc(lines.slice(1, end).join('\n'))}</pre>`; i = end + 1; }
    }
    for (; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        closeList();
        const code = [];
        while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
        html += `<pre>${esc(code.join('\n'))}</pre>`;
      } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        closeList();
        const n = Math.min(m[1].length + 1, 6);
        html += `<h${n}>${inline(m[2])}</h${n}>`;
      } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
        const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (list !== tag) { closeList(); html += `<${tag}>`; list = tag; }
        html += `<li>${inline(m[2].replace(/^\[([ xX])\]\s*/, (x, c) => c === ' ' ? '☐ ' : '☑ '))}</li>`;
      } else if (/^\s*>/.test(line)) {
        closeList();
        html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
      } else if (/^\s*\|.*\|\s*$/.test(line)) {
        closeList();
        const rows = [];
        for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(lines[i]);
        i--;
        const cells = r => r.trim().slice(1, -1).split('|').map(c => c.trim());
        html += '<div class="md-table"><table>' + rows.filter(r => !/^\s*\|[\s|:-]+\|\s*$/.test(r)).map((r, k) =>
          '<tr>' + cells(r).map(c => k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('') + '</tr>').join('') + '</table></div>';
      } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
        closeList();
        html += '<hr>';
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        html += `<p>${inline(line)}</p>`;
      }
    }
    closeList();
    return html;
  }

  function openViewer(src, title) {
    openSheet({ title: title || 'Imagine', viewer: true, draw() { drawSheet(this, `<img src="${src}" alt="">`); } });
  }

  // ── Ecran și camere ──────────────────────────────────────────────────────
  async function captureScreen() {
    const sc = state.screen;
    if (sc.loading) return;
    sc.loading = true;
    paintScreen();
    try {
      const r = await api('/api/screen?display=' + sc.display);
      const blob = await r.blob();
      if (sc.url) URL.revokeObjectURL(sc.url);
      sc.url = URL.createObjectURL(blob);
      sc.blob = blob;
      sc.at = new Date();
      sc.error = '';
    } catch (e) {
      sc.error = e.message;
      sc.live = false;
    }
    sc.loading = false;
    paintScreen();
  }

  async function captureCams() {
    const c = state.cams;
    if (c.loading) return;
    c.loading = true;
    if (state.tab === 'cameras') render();
    try {
      if (c.source === 'laptop') {
        const r = await api('/api/webcam?maxWidth=1280' + (c.camId ? '&id=' + encodeURIComponent(c.camId) : ''));
        const blob = await r.blob();
        if (c.url) URL.revokeObjectURL(c.url);
        c.url = URL.createObjectURL(blob);
        c.error = '';
      } else {
        const r = await getJSON('/api/cameras');
        if (r.error) throw new Error(r.error);
        c.frames = r.cameras || [];
        c.error = c.frames.length ? '' : 'CamFlow e deschis, dar nicio cameră nu are imagine acum.';
      }
      c.at = new Date();
    } catch (e) {
      c.error = e.message;
      c.live = false;
    }
    c.loading = false;
    if (state.tab === 'cameras' && !state.sheets.length) render();
  }

  function liveLoop(kind) {
    const s = kind === 'screen' ? state.screen : state.cams;
    clearTimeout(s.timer);
    if (!s.live) return;
    const tick = async () => {
      if (!s.live) return;
      if (document.visibilityState === 'visible') await (kind === 'screen' ? captureScreen() : captureCams());
      s.timer = setTimeout(tick, kind === 'screen' ? (state.screen.control ? 2500 : 5000) : (state.cams.source === 'laptop' ? 3000 : 2000));
    };
    tick();
  }

  // ── Acțiuni ──────────────────────────────────────────────────────────────
  document.addEventListener('click', async e => {
    const tabBtn = e.target.closest('#tabs button');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      window.scrollTo(0, 0);
      render();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const top = state.sheets[state.sheets.length - 1];
    try {
      switch (a) {
        case 'back': closeSheet(); break;
        case 'dismiss': try { localStorage.setItem('cl-dismiss-' + el.dataset.key, '1'); } catch (x) { /* mod privat */ } render(); break;
        case 'open-session': openSession(el.dataset.id); break;
        case 'open-task': openTask(el.dataset.id); break;
        case 'open-doc': openDoc(el.dataset.cwd, el.dataset.name); break;
        case 'new-task': openNewTask(); break;
        case 'continue-session': {
          const s = state.status?.sessions.find(x => x.id === el.dataset.id);
          openNewTask({ cwd: s?.cwd || '', resumeSessionId: el.dataset.id, context: s?.title || '' });
          break;
        }
        case 'task-start': await postJSON('/api/tasks/' + el.dataset.id + '/start'); break;
        case 'task-cancel':
          if (confirm('Oprești task-ul?')) await postJSON('/api/tasks/' + el.dataset.id + '/cancel');
          break;
        case 'task-continue': {
          const t = top?.task;
          if (t) openNewTask({ cwd: t.cwd, resumeSessionId: t.sessionId, context: t.prompt, provider: t.provider });
          break;
        }
        case 'task-delete':
          if (confirm('Ștergi task-ul din istoric?')) {
            await api('/api/tasks/' + el.dataset.id, { method: 'DELETE' });
            closeSheet();
            await refresh();
          }
          break;
        case 'perm': {
          const allow = el.dataset.v === 'allow';
          await postJSON('/api/permissions/' + el.dataset.id, { behavior: allow ? 'allow' : 'deny' });
          await refresh();
          break;
        }
        case 'answer':
        case 'answer-custom': {
          const s = state.status?.sessions.find(x => x.id === el.dataset.id);
          const q = s?.question;
          if (!q) break;
          let message;
          if (a === 'answer') {
            const opt = q.options[Number(el.dataset.i)];
            if (!opt || !confirm(`Trimit „${opt.label}”?\n\nConversația continuă pe Mac ca task, într-o copie; fereastra din aplicația Claude rămâne la întrebare.`)) break;
            message = opt.message;
          } else {
            message = (prompt('Răspunsul tău pentru Claude:') || '').trim();
            if (!message) break;
          }
          const t = await postJSON('/api/sessions/' + encodeURIComponent(s.id) + '/answer', { message });
          await refresh();
          openTask(t.id);
          break;
        }
        case 'f-mode': top.form.mode = el.dataset.v; top.draw(); break;
        case 'f-model': top.form.model = el.dataset.v; top.draw(); break;
        case 'f-provider': top.setProvider(el.dataset.v); break;
        case 'f-send': top.send(); break;
        case 'capture-screen': captureScreen(); break;
        case 'live-screen': state.screen.live = !state.screen.live; render(); liveLoop('screen'); break;
        case 'display': state.screen.display = Number(el.dataset.n); render(); break;
        case 'share-screen': {
          const file = new File([state.screen.blob], 'ecran-mac.jpg', { type: 'image/jpeg' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
          break;
        }
        case 'capture-cams': captureCams(); break;
        case 'live-cams': state.cams.live = !state.cams.live; render(); liveLoop('cams'); break;
        case 'cam-source': {
          const c = state.cams;
          c.source = el.dataset.v;
          c.error = '';
          c.live = false;
          render();
          break;
        }
        case 'view-image': openViewer(el.dataset.src, el.alt); break;
        case 'screen-tap': {
          const r = el.getBoundingClientRect();
          const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
          state.screen.lastTap = { x: fx, y: fy };
          tapMarker(el, fx, fy);
          sendInput({ action: 'click', x: fx, y: fy, button: state.screen.tool });
          break;
        }
        case 'control-toggle': {
          const sc = state.screen;
          sc.control = !sc.control;
          if (sc.control) {
            if (!sc.url) captureScreen();
            getJSON('/api/input').then(r => { sc.trusted = r.trusted; render(); }).catch(err => { sc.error = err.message; render(); });
          }
          render();
          break;
        }
        case 'tool': state.screen.tool = el.dataset.v; render(); break;
        case 'scroll': {
          const t = state.screen.lastTap || { x: 0.5, y: 0.5 };
          sendInput({ action: 'scroll', x: t.x, y: t.y, dy: Number(el.dataset.dy) });
          break;
        }
        case 'key': sendInput({ action: 'key', key: el.dataset.key }); break;
        case 'type-send': {
          const input = $('#type-text');
          const text = input.value;
          if (!text) break;
          input.value = '';
          sendInput({ action: 'type', text });
          break;
        }
        case 'save-token': {
          const t = $('#token').value.trim();
          if (!t) break;
          saveToken(t);
          state.error = '';
          state.status = null;
          if (state.tab === 'settings') state.tab = 'status';
          render();
          startPolling();
          break;
        }
        case 'forget-token':
          if (confirm('Deconectezi telefonul de la Mac?')) {
            saveToken('');
            state.status = null;
            state.tasks = [];
            clearInterval(startPolling.timer);
            render();
          }
          break;
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert(err.message);
    }
  });

  // Alegerea altei camere a laptopului face imediat o poză cu ea.
  document.addEventListener('change', e => {
    if (e.target.id === 'cam-select') {
      state.cams.camId = e.target.value;
      captureCams();
    }
  });

  // Enter în câmpul de text trimite textul pe Mac.
  document.addEventListener('keydown', e => {
    if (e.target.id === 'type-text' && e.key === 'Enter') {
      e.preventDefault();
      const text = e.target.value;
      if (text) { e.target.value = ''; sendInput({ action: 'type', text }); }
    }
  });

  function isStandalone() {
    return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  }

  function dismissed(key) {
    try { return localStorage.getItem('cl-dismiss-' + key) === '1'; } catch (e) { return false; }
  }

  // ── Pornire ──────────────────────────────────────────────────────────────
  render();
  if (state.token) startPolling();
})();
