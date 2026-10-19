// Agentul Veghe: un server HTTP mic, fără dependențe.
//
// Ascultă doar pe 127.0.0.1 și pe adresele Tailscale, deci nu e vizibil din
// internet sau din rețeaua de acasă. Rutele /api cer tokenul din config.json.
// Rutele /bridge și /hook răspund doar cererilor venite de pe Mac.
// La / servește aplicația web pentru iPhone (public/app); pagina în sine nu
// conține date, iar tokenul îl aduce link-ul din codul QR.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, TASKS_PATH, CONFIG_PATH } from './config.js';
import { Sessions } from './sessions.js';
import { Tasks, findClaude, httpError, ollamaModels } from './tasks.js';
import { captureScreen, systemInfo, keepAwake, bindAddresses, userIdleSeconds } from './system.js';
import { Permissions } from './permissions.js';
import { ensureHelper, checkAccess, performInput } from './input.js';
import { listWebcams, snapWebcam, ensureCameraTool } from './webcam.js';
import { Notifier, projectName } from './notify.js';

const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_JS = path.join(HERE, 'public', 'camflow-bridge.js');
const WEB_APP = path.join(HERE, 'public', 'app');
const MAX_BODY = 30 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const config = loadConfig();
// Procesele pornite de agent (task-urile) știu astfel că rulează în interiorul
// lui; install-agent.sh nu-l mai oprește sub ele (vezi RESTART_FLAG).
process.env.CONTROL_LAPTOP_AGENT = '1';
const RESTART_FLAG = path.join(path.dirname(CONFIG_PATH), 'restart-requested');
const startedAt = Date.now();
const sessions = new Sessions();
// Atingerea notificării deschide aplicația web; tokenul e deja salvat pe telefon.
const notifier = new Notifier({
  config, userIdleSeconds, log,
  clickUrl: () => {
    const addr = bindAddresses(config.extraBind).find(a => a !== '127.0.0.1');
    return addr ? `http://${addr}:${config.port}/` : '';
  },
});
const tasks = new Tasks({
  storePath: TASKS_PATH, sessions, config, log,
  onFinish: t => {
    if (t.status === 'cancelled') return;
    const ok = t.status === 'done';
    notifier.send({
      title: ok ? `Task gata: ${projectName(t.cwd)}` : `Task eșuat: ${projectName(t.cwd)}`,
      message: ok ? 'Task-ul din coadă s-a terminat.' : 'Task-ul din coadă s-a oprit cu o eroare.',
      tags: [ok ? 'white_check_mark' : 'x'],
    });
  },
});
// CamFlow e o integrare doar pentru cine are CamFlow („camflow”: true în
// config.json). În ediția publică bridge.js lipsește cu totul.
const CAMFLOW = Boolean(config.camflow) && fs.existsSync(path.join(HERE, 'bridge.js'));
const bridge = CAMFLOW ? new (await import('./bridge.js')).Bridge() : null;
const permissions = new Permissions({
  userIdleSeconds, log,
  onPending: p => notifier.send({
    title: `Aprobare cerută: ${projectName(p.cwd)}`,
    message: `Claude vrea să folosească ${p.tool || 'o unealtă'}. Deschide aplicația ca să aprobi sau să refuzi.`,
    priority: 4,
    tags: ['warning'],
  }),
});

// Lista de sesiuni, cu întrebările la care ai răspuns deja de pe telefon marcate.
function sessionList() {
  const list = sessions.list(tasks.sessionIds());
  for (const s of list) {
    if (!s.question) continue;
    const answer = tasks.tasks.find(t => t.resumeSessionId === s.id && t.createdAt >= s.question.at);
    if (answer) s.question = { ...s.question, answeredTaskId: answer.id };
  }
  return list;
}

const MAX_DOC = 1024 * 1024;

function knownProject(cwd) {
  const known = new Set([...sessions.list().map(s => s.cwd), ...tasks.list().map(t => t.cwd)]);
  if (!cwd || !known.has(cwd)) throw httpError(404, 'Proiect necunoscut.');
  return cwd;
}

// .md din folderul proiectului și din .claude/. Dacă acolo nu e niciunul, urcăm
// spre folderele părinte (până la ~) și luăm primul care are, cu numele „../…”.
// Citim asincron, cu timeout: în Downloads/Documents macOS poate cere voie
// printr-o fereastră pe Mac, iar până răspunde cineva citirea stă pe loc.
async function projectDocs(cwd) {
  const home = os.homedir();
  const mdIn = async (dir, prefix) => {
    let names = [];
    try { names = (await fs.promises.readdir(dir)).filter(n => /\.md$/i.test(n)); } catch { return []; }
    const found = await Promise.all(names.map(async n => {
      const file = path.join(dir, n);
      try {
        const st = await fs.promises.stat(file);
        return st.isFile() ? [{ name: prefix + n, file, size: st.size, mtime: st.mtime.toISOString() }] : [];
      } catch { return []; }
    }));
    return found.flat();
  };
  const scan = async () => {
    let docs = [...await mdIn(cwd, ''), ...await mdIn(path.join(cwd, '.claude'), '.claude/')];
    let dir = cwd, up = '';
    while (!docs.length && dir.startsWith(home + path.sep)) {
      dir = path.dirname(dir);
      up += '../';
      if (dir === home) break;
      docs = await mdIn(dir, up);
    }
    return docs;
  };
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(httpError(504, 'macOS cere permisiune pe Mac pentru folderul ăsta. Apasă OK în fereastra de pe Mac.')), 8000);
  });
  const docs = await Promise.race([scan(), timeout]).finally(() => clearTimeout(timer));
  const rank = d => /(^|\/)CLAUDE\.md$/i.test(d.name) ? 0 : /(^|\/)README\.md$/i.test(d.name) ? 1 : 2;
  return docs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------------------
// Rute

const routes = [
  ['GET', /^\/$/, 'public', () => staticFile('index.html')],
  ['GET', /^\/app\/([\w.-]+)$/, 'public', (req, m) => staticFile(m[1])],

  ['GET', /^\/api\/status$/, 'api', async () => {
    let claudePath = '';
    try { claudePath = findClaude(config.claudePath); } catch { /* raportat mai jos */ }
    return json({
      agent: {
        version: VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        claudeFound: Boolean(claudePath),
        now: new Date().toISOString(),
      },
      system: await systemInfo(),
      sessions: sessionList(),
      permissions: permissions.list(),
      queue: { ...tasks.summary(), ...tasks.idleState() },
      cameras: bridge ? { enabled: true, ...bridge.status() } : { enabled: false, connected: false, pages: [] },
    });
  }],

  ['GET', /^\/api\/sessions\/([\w-]+)$/, 'api', (req, m) => {
    const d = sessions.detail(m[1]);
    if (!d) throw httpError(404, 'Sesiune inexistentă.');
    return json(d);
  }],

  ['GET', /^\/api\/projects$/, 'api', () => {
    // Folderele în care s-a lucrat recent cu Claude, pentru alegerea locului unui task.
    const seen = new Map();
    for (const s of sessions.list()) {
      if (s.cwd && !seen.has(s.cwd) && fs.existsSync(s.cwd)) {
        seen.set(s.cwd, { path: s.cwd, name: path.basename(s.cwd), lastActivity: s.lastActivity });
      }
    }
    return json({ projects: [...seen.values()] });
  }],

  // Fișierele .md ale unui proiect (CLAUDE.md, README.md…), doar pentru
  // folderele cunoscute din sesiuni și task-uri.
  ['GET', /^\/api\/docs$/, 'api', async (req, m, url) => {
    const cwd = knownProject(url.searchParams.get('cwd'));
    const docs = await projectDocs(cwd);
    return json({ cwd, docs: docs.map(({ name, size, mtime }) => ({ name, size, mtime })) });
  }],
  ['GET', /^\/api\/docs\/file$/, 'api', async (req, m, url) => {
    const cwd = knownProject(url.searchParams.get('cwd'));
    const doc = (await projectDocs(cwd)).find(d => d.name === url.searchParams.get('name'));
    if (!doc) throw httpError(404, 'Fișier inexistent.');
    if (doc.size > MAX_DOC) throw httpError(413, 'Fișierul e prea mare pentru telefon.');
    return json({ name: doc.name, mtime: doc.mtime, text: await fs.promises.readFile(doc.file, 'utf8') });
  }],

  // Modelele locale pentru motorul Ollama. Nu e eroare dacă Ollama e oprit:
  // aplicația arată mesajul și lasă Claude ca motor.
  ['GET', /^\/api\/ollama$/, 'api', async () => {
    try {
      return json({ url: config.ollamaUrl, running: true, defaultModel: config.ollamaModel, models: await ollamaModels(config.ollamaUrl) });
    } catch (err) {
      return json({ url: config.ollamaUrl, running: false, defaultModel: config.ollamaModel, models: [], error: err.message });
    }
  }],

  ['GET', /^\/api\/tasks$/, 'api', () => json({ tasks: tasks.list() })],
  ['POST', /^\/api\/tasks$/, 'api', async req => json(tasks.create(await readJson(req)), 201)],
  ['GET', /^\/api\/tasks\/([\w-]+)$/, 'api', (req, m) => {
    const t = tasks.get(m[1]);
    if (!t) throw httpError(404, 'Task inexistent.');
    return json(t);
  }],
  ['POST', /^\/api\/tasks\/([\w-]+)\/cancel$/, 'api', (req, m) => json(tasks.cancel(m[1]))],
  ['POST', /^\/api\/tasks\/([\w-]+)\/start$/, 'api', (req, m) => json(tasks.startNow(m[1]))],
  ['DELETE', /^\/api\/tasks\/([\w-]+)$/, 'api', (req, m) => { tasks.remove(m[1]); return json({ ok: true }); }],

  ['GET', /^\/api\/screen$/, 'api', async (req, m, url) => {
    const display = clampInt(url.searchParams.get('display'), 1, 8, 1);
    const maxWidth = clampInt(url.searchParams.get('maxWidth'), 400, 4000, config.maxScreenWidth);
    const t0 = Date.now();
    const jpg = await captureScreen({ display, maxWidth });
    log(`[ecran] captură ${display}: ${Math.round(jpg.length / 1024)} KB în ${Date.now() - t0} ms`);
    return { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }, body: jpg };
  }],

  // Control de la distanță: click, scroll, text și taste pe ecranul capturat.
  ['GET', /^\/api\/input$/, 'api', async (req, m, url) => json({ trusted: await checkAccess(url.searchParams.get('prompt') !== '0') })],
  ['POST', /^\/api\/input$/, 'api', async req => {
    const body = await readJson(req);
    await performInput(body);
    log(`[control] ${body.action}${body.action === 'type' ? '' : ' ' + (body.key || body.button || '')}`);
    return json({ ok: true });
  }],

  // Camera laptopului: lista și o poză.
  ['GET', /^\/api\/webcams$/, 'api', async () => json({ cameras: await listWebcams() })],
  ['GET', /^\/api\/webcam$/, 'api', async (req, m, url) => {
    const maxWidth = clampInt(url.searchParams.get('maxWidth'), 320, 1920, 1280);
    const jpg = await snapWebcam({ id: url.searchParams.get('id') || 'default', maxWidth });
    return { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }, body: jpg };
  }],

  ['GET', /^\/api\/cameras$/, 'api', async (req, m, url) => {
    if (!bridge) throw httpError(404, 'Integrarea cu CamFlow nu e activată.');
    const maxWidth = clampInt(url.searchParams.get('maxWidth'), 200, 1920, 960);
    const frames = await bridge.capture({ maxWidth });
    return json({ at: new Date().toISOString(), ...frames });
  }],

  // Datele pentru împerechere (codul QR din aplicația de Mac).
  ['GET', /^\/api\/pairing$/, 'api', () => json({
    urls: bindAddresses(config.extraBind).filter(a => a !== '127.0.0.1').map(a => `http://${a}:${config.port}`),
    port: config.port,
  })],

  // Răspuns la o întrebare cu butoane: conversația continuă ca task, într-o copie.
  ['POST', /^\/api\/sessions\/([\w-]+)\/answer$/, 'api', async (req, m) => {
    const { message } = await readJson(req);
    const s = sessions.list().find(x => x.id === m[1]);
    if (!s) throw httpError(404, 'Sesiune inexistentă.');
    return json(tasks.create({ prompt: message, cwd: s.cwd, resumeSessionId: s.id, startNow: true }), 201);
  }],

  ['GET', /^\/api\/permissions$/, 'api', () => json({ permissions: permissions.list() })],
  ['POST', /^\/api\/permissions\/([\w-]+)$/, 'api', async (req, m) => {
    const { behavior, message } = await readJson(req);
    permissions.decide(m[1], behavior, message);
    return json({ ok: true });
  }],

  // Hook-ul PermissionRequest așteaptă aici răspunsul de pe telefon (sau null).
  ['POST', /^\/hook\/permission$/, 'local', async req => {
    const decision = await permissions.request(await readJson(req));
    return json({ decision });
  }],

  ['POST', /^\/hook$/, 'local', async req => {
    const payload = await readJson(req);
    sessions.recordHook(payload);
    // Sesiunea a mers mai departe: o cerere veche de aprobare nu mai contează.
    if (['Stop', 'UserPromptSubmit', 'SessionEnd'].includes(payload.hook_event_name)) {
      permissions.dropForSession(payload.session_id);
    }
    // Task-urile din coadă au notificarea lor, la final.
    if (payload.hook_event_name === 'Stop' && !tasks.sessionIds().has(payload.session_id)) {
      notifier.send({
        title: `Gata: ${projectName(payload.cwd)}`,
        message: 'Claude a terminat și așteaptă următorul mesaj.',
        tags: ['white_check_mark'],
      });
    }
    return json({ ok: true });
  }],

  // Trimite o notificare de probă, chiar dacă ești la Mac.
  ['POST', /^\/api\/notify\/test$/, 'api', async () => {
    if (!notifier.enabled) throw httpError(409, 'Notificările sunt oprite (ntfyTopic e gol în config.json).');
    const sent = await notifier.send({ title: 'Veghe', message: 'Notificările merg.', tags: ['bell'], force: true });
    if (!sent) throw httpError(502, 'ntfy n-a primit notificarea; vezi agent.log.');
    return json({ ok: true, topic: config.ntfyTopic });
  }],

  ...(bridge ? [
    ['GET', /^\/camflow-bridge\.js$/, 'local', () => ({
      status: 200,
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
      body: fs.readFileSync(BRIDGE_JS),
    })],
    ['GET', /^\/bridge\/wait$/, 'local', (req, m, url, res) => { bridge.wait(req, res, url); return null; }],
    ['POST', /^\/bridge\/frame\/([\w-]+)$/, 'local', async (req, m) => {
      const ok = bridge.deliver(m[1], await readJson(req));
      return json({ ok }, ok ? 200 : 410);
    }],
  ] : []),
];

// ---------------------------------------------------------------------------
// Server

async function handle(req, res) {
  const url = new URL(req.url, 'http://agent');
  const local = isLoopback(req.socket.remoteAddress);
  const origin = req.headers.origin || '';

  // CamFlow rulează pe localhost:8000 (sau alt port); doar paginile locale
  // primesc acces CORS la punte.
  const corsOk = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (corsOk) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    // Chrome cere asta pentru cereri de la o pagină spre adrese locale.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') {
    if (corsOk) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    return res.writeHead(corsOk ? 204 : 403).end();
  }

  const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
  if (!route) return send(res, json({ error: 'Rută necunoscută.' }, 404));
  const [, re, access, fn] = route;

  if (access === 'local' && !local) return send(res, json({ error: 'Doar de pe Mac.' }, 403));
  if (access === 'api' && !authorized(req)) return send(res, json({ error: 'Token greșit.' }, 401));
  // Pe /api intră doar aplicațiile native (fără Origin), aplicația web servită
  // chiar de agent (aceeași origine) și paginile locale. Alt site deschis în
  // browser e refuzat.
  const sameOrigin = origin === `http://${req.headers.host}`;
  if (access === 'api' && origin && !corsOk && !sameOrigin) return send(res, json({ error: 'Origine refuzată.' }, 403));

  try {
    const out = await fn(req, url.pathname.match(re), url, res);
    if (out) send(res, out);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) log('[eroare]', req.method, url.pathname, err.message);
    send(res, json({ error: err.message }, status));
  }
}

function authorized(req) {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(config.token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function json(obj, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

function staticFile(name) {
  const file = path.join(WEB_APP, name);
  // Numele vine din URL; [\w.-]+ exclude deja „/”, dar verificăm și aici.
  if (path.dirname(file) !== WEB_APP || !fs.existsSync(file)) throw httpError(404, 'Fișier inexistent.');
  return {
    status: 200,
    headers: {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // Fără cache: după o actualizare a agentului, telefonul ia imediat versiunea nouă.
      'Cache-Control': 'no-cache',
    },
    body: fs.readFileSync(file),
  };
}

function send(res, { status, headers, body }) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Cerere prea mare.'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'JSON invalid.')); }
    });
    req.on('error', reject);
  });
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

// Câte un server pe fiecare adresă. Tailscale poate porni după agent, așa că
// verificăm adresele la fiecare 30 de secunde.
const servers = new Map();

function syncListeners() {
  const wanted = new Set(bindAddresses(config.extraBind));
  for (const addr of wanted) {
    if (servers.has(addr)) continue;
    const srv = http.createServer((req, res) => {
      handle(req, res).catch(err => {
        log('[eroare]', err);
        send(res, json({ error: 'Eroare internă.' }, 500));
      });
    });
    srv.requestTimeout = 60000;
    srv.on('error', err => {
      log(`[server] nu pot asculta pe ${addr}:${config.port}: ${err.message}`);
      servers.delete(addr);
    });
    srv.listen(config.port, addr, () => log(`[server] ascult pe http://${addr}:${config.port}`));
    servers.set(addr, srv);
  }
  for (const [addr, srv] of servers) {
    if (!wanted.has(addr)) {
      srv.close();
      servers.delete(addr);
      log(`[server] adresa ${addr} a dispărut`);
    }
  }
}

syncListeners();
setInterval(syncListeners, 30000).unref();
// Pregătim din timp programul pentru click-uri, ca prima atingere să nu aștepte compilarea.
ensureHelper().catch(err => log('[control]', err.message));
ensureCameraTool().catch(err => log('[camera]', err.message));
const keepAlive = setInterval(() => {}, 1 << 30);
if (config.keepAwake) keepAwake();

log(`[agent] Veghe ${VERSION} pornit. Config: ${CONFIG_PATH}`);

// Un task a cerut repornirea (install-agent.sh rulat din task): așteptăm să se
// termine task-ul, apoi ieșim; launchd (KeepAlive) pornește agentul din nou,
// cu codul nou.
setInterval(() => {
  if (!fs.existsSync(RESTART_FLAG) || tasks.child) return;
  fs.rmSync(RESTART_FLAG, { force: true });
  log('[agent] repornesc la cerere, cu codul nou');
  tasks.save();
  setTimeout(() => process.exit(0), 1000);
}, 5000).unref();

function shutdown() {
  log('[agent] opresc');
  tasks.shutdown();
  clearInterval(keepAlive);
  for (const srv of servers.values()) srv.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
