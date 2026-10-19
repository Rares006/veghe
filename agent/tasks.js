// Coada de task-uri trimise de pe telefon.
//
// Un task așteaptă până când nicio sesiune Claude n-a mai lucrat de
// `idleMinutes` minute, apoi pornește `claude -p` în folderul ales. Rulează
// câte unul. Progresul vine din --output-format stream-json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { describeTool } from './sessions.js';

const MAX_TASKS = 100;
const MAX_EVENTS = 300;
const TICK_MS = 5000;

export const PERMISSION_MODES = ['plan', 'acceptEdits', 'auto', 'bypassPermissions'];
export const PROVIDERS = ['claude', 'ollama'];

export class Tasks {
  constructor({ storePath, sessions, config, log = console.log, onFinish = () => {} }) {
    this.storePath = storePath;
    this.onFinish = onFinish;
    this.sessions = sessions;
    this.config = config;
    this.log = log;
    this.tasks = [];
    this.child = null;
    this.saveTimer = null;
    this.load();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  load() {
    try {
      this.tasks = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
    } catch {
      this.tasks = [];
    }
    // Agentul a fost oprit în timp ce rula ceva: procesul nu mai există.
    for (const t of this.tasks) {
      if (t.status === 'running') {
        t.status = 'failed';
        t.error = 'Agentul a fost repornit în timpul rulării.';
        t.endedAt = new Date().toISOString();
      }
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.writeFileSync(this.storePath, JSON.stringify(this.tasks, null, 1), { mode: 0o600 });
    }, 300);
  }

  sessionIds() {
    return new Set(this.tasks.map(t => t.sessionId).filter(Boolean));
  }

  summary() {
    return {
      running: this.tasks.filter(t => t.status === 'running').length,
      queued: this.tasks.filter(t => t.status === 'queued').length,
    };
  }

  list() {
    return this.tasks.map(({ events, ...rest }) => ({ ...rest, eventCount: events.length }));
  }

  get(id) {
    return this.tasks.find(t => t.id === id) || null;
  }

  create({ prompt, cwd, permissionMode, provider, model, resumeSessionId, startNow }) {
    prompt = String(prompt || '').trim();
    if (!prompt) throw httpError(400, 'Lipsește textul task-ului.');
    cwd = String(cwd || '').trim() || os.homedir();
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw httpError(400, `Folderul nu există: ${cwd}`);
    }
    permissionMode = permissionMode || this.config.defaultPermissionMode;
    if (!PERMISSION_MODES.includes(permissionMode)) {
      throw httpError(400, `Mod de permisiuni necunoscut: ${permissionMode}`);
    }
    provider = provider || 'claude';
    if (!PROVIDERS.includes(provider)) throw httpError(400, `Motor necunoscut: ${provider}`);
    const task = {
      id: crypto.randomUUID(),
      prompt,
      cwd,
      permissionMode,
      provider,
      model: model || '',
      resumeSessionId: resumeSessionId || '',
      force: Boolean(startNow),
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      sessionId: '',
      result: '',
      error: '',
      costUsd: null,
      events: [],
    };
    this.tasks.unshift(task);
    if (this.tasks.length > MAX_TASKS) {
      this.tasks = this.tasks.filter((t, i) => i < MAX_TASKS || t.status === 'running' || t.status === 'queued');
    }
    this.save();
    setImmediate(() => this.tick());
    return task;
  }

  startNow(id) {
    const t = this.get(id);
    if (!t) throw httpError(404, 'Task inexistent.');
    if (t.status !== 'queued') throw httpError(409, 'Task-ul nu mai e în coadă.');
    t.force = true;
    this.save();
    setImmediate(() => this.tick());
    return t;
  }

  cancel(id) {
    const t = this.get(id);
    if (!t) throw httpError(404, 'Task inexistent.');
    if (t.status === 'queued') {
      t.status = 'cancelled';
      t.endedAt = new Date().toISOString();
    } else if (t.status === 'running' && this.child) {
      t.cancelRequested = true;
      killGroup(this.child, 'SIGTERM');
      setTimeout(() => this.child && killGroup(this.child, 'SIGKILL'), 5000).unref();
    } else {
      throw httpError(409, 'Task-ul s-a terminat deja.');
    }
    this.save();
    return t;
  }

  remove(id) {
    const t = this.get(id);
    if (!t) throw httpError(404, 'Task inexistent.');
    if (t.status === 'running') throw httpError(409, 'Oprește întâi task-ul.');
    this.tasks = this.tasks.filter(x => x.id !== id);
    this.save();
  }

  // De ce așteaptă coada (sau null dacă un task poate porni acum).
  idleState() {
    const lastMs = this.sessions.lastActivityMs();
    const minutesSince = lastMs ? (Date.now() - lastMs) / 60000 : Infinity;
    const isIdle = minutesSince >= this.config.idleMinutes;
    return {
      isIdle,
      minutesSinceActivity: Number.isFinite(minutesSince) ? Math.round(minutesSince * 10) / 10 : null,
      idleMinutes: this.config.idleMinutes,
    };
  }

  tick() {
    if (this.child || this.starting) return;
    // Cel mai vechi task din coadă pornește primul.
    const next = [...this.tasks].reverse().find(t => t.status === 'queued');
    if (!next) return;
    if (!next.force && !this.idleState().isIdle) return;
    this.starting = true;
    this.run(next).finally(() => { this.starting = false; });
  }

  async run(task) {
    let bin;
    let env = { ...process.env, PATH: fullPath() };
    try {
      bin = findClaude(this.config.claudePath);
      if (task.provider === 'ollama') {
        if (!task.model) task.model = this.config.ollamaModel || (await ollamaModels(this.config.ollamaUrl))[0]?.name || '';
        if (!task.model) throw new Error('Ollama nu are niciun model instalat. Rulează pe Mac: ollama pull qwen2.5-coder:7b');
        env = { ...env, ...ollamaEnv(this.config.ollamaUrl, task.model) };
      }
    } catch (err) {
      if (task.status !== 'queued') return;   // scos din coadă între timp
      task.status = 'failed';
      task.error = err.message;
      task.endedAt = new Date().toISOString();
      this.save();
      return;
    }
    if (task.status !== 'queued') return;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', task.permissionMode];
    if (task.resumeSessionId) {
      args.push('--resume', task.resumeSessionId);
      // O conversație din aplicația Claude o continuăm într-o copie: dacă am
      // scrie în același fișier, aplicația n-ar vedea mesajele noi.
      const ownSession = this.tasks.some(t => t !== task && t.sessionId === task.resumeSessionId);
      if (!ownSession) args.push('--fork-session');
    }
    if (task.model) args.push('--model', task.model);

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.pushEvent(task, 'info', `Pornit în ${task.cwd}${task.provider === 'ollama' ? ` cu Ollama (${task.model})` : ''}`);
    this.save();
    this.log(`[task] pornesc ${task.id} în ${task.cwd} (${task.provider || 'claude'})`);

    const child = spawn(bin, args, {
      cwd: task.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,   // grup propriu, ca „Oprește” să oprească și comenzile pornite de Claude
    });
    this.child = child;
    // Textul merge pe stdin: un prompt care începe cu „-” n-ar fi luat drept opțiune.
    child.stdin.end(task.prompt);

    let buf = '';
    child.stdout.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) this.onStreamLine(task, line);
      }
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });

    child.on('error', err => {
      task.error = `Nu pot porni claude: ${err.message}`;
    });
    child.on('close', code => {
      this.child = null;
      if (task.cancelRequested) {
        task.status = 'cancelled';
      } else if (task.status === 'running') {
        task.status = code === 0 && !task.isError ? 'done' : 'failed';
        if (task.status === 'failed' && !task.error) {
          task.error = stderr.trim().split('\n').slice(-5).join('\n') || `claude a ieșit cu codul ${code}`;
        }
      }
      delete task.cancelRequested;
      delete task.isError;
      task.endedAt = new Date().toISOString();
      this.pushEvent(task, 'info', `Terminat: ${task.status}`);
      this.save();
      this.log(`[task] ${task.id} → ${task.status}`);
      this.onFinish(task);
      setImmediate(() => this.tick());
    });
  }

  onStreamLine(task, line) {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.session_id && !task.sessionId) task.sessionId = ev.session_id;
    if (ev.type === 'assistant' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type === 'text' && b.text.trim()) this.pushEvent(task, 'text', b.text.trim());
        else if (b.type === 'tool_use') this.pushEvent(task, 'tool', describeTool(b));
      }
    } else if (ev.type === 'result') {
      task.result = ev.result || '';
      // Pe Ollama rulează local: costul calculat de claude n-are sens.
      task.costUsd = typeof ev.total_cost_usd === 'number' && task.provider !== 'ollama' ? ev.total_cost_usd : null;
      task.isError = Boolean(ev.is_error);
      if (ev.is_error) task.error = ev.result || ev.subtype || 'Eroare';
      if (ev.session_id) task.sessionId = ev.session_id;
    }
    this.save();
  }

  pushEvent(task, kind, text) {
    task.events.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 4000) });
    if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
  }

  shutdown() {
    if (this.child) killGroup(this.child, 'SIGTERM');
  }
}

function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* deja oprit */ } }
}

// Sub launchd PATH-ul e minim; uneltele pornite de Claude au nevoie de cel obișnuit.
export function fullPath() {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  return [...new Set([...extra, ...current])].join(':');
}

// `claude` vine cu aplicația Claude, într-un folder cu versiunea în nume care
// se schimbă la fiecare actualizare; luăm cea mai nouă versiune.
export function findClaude(configured) {
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    throw new Error(`claudePath din config nu există: ${configured}`);
  }
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');
  let versions = [];
  try { versions = fs.readdirSync(base).filter(v => /^\d+\.\d+\.\d+$/.test(v)); } catch { /* fără aplicația Claude */ }
  versions.sort(compareVersions).reverse();
  for (const v of versions) {
    let builds = [];
    try { builds = fs.readdirSync(path.join(base, v)); } catch { continue; }
    for (const b of builds) {
      const bin = path.join(base, v, b, 'claude.app', 'Contents', 'MacOS', 'claude');
      if (fs.existsSync(bin)) return bin;
    }
  }
  for (const dir of fullPath().split(':')) {
    const bin = path.join(dir, 'claude');
    if (fs.existsSync(bin)) return bin;
  }
  try {
    return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Nu găsesc programul claude. Instalează Claude Code sau pune calea în config.json (claudePath).');
  }
}

// Modelele instalate în Ollama (GET /api/tags), cel mai recent folosit primul.
export async function ollamaModels(url) {
  let res;
  try {
    res = await fetch(new URL('/api/tags', url), { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error(`Ollama nu răspunde la ${url}. Pornește aplicația Ollama pe Mac.`);
  }
  if (!res.ok) throw new Error(`Ollama a răspuns cu ${res.status}.`);
  const data = await res.json();
  return (data.models || [])
    .sort((a, b) => String(b.modified_at).localeCompare(String(a.modified_at)))
    .map(m => ({ name: m.name, size: m.size, parameterSize: m.details?.parameter_size || '' }));
}

// Variabilele care trimit `claude` spre Ollama. Toate rolurile (inclusiv
// modelul mic pentru titluri și sub-agenți) folosesc modelul ales, altfel
// claude ar cere „haiku” de la Ollama.
export function ollamaEnv(url, model) {
  return {
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
