// Starea sesiunilor Claude Code, citită din transcrierile din ~/.claude/projects.
//
// Fiecare sesiune (din aplicația desktop sau din terminal) scrie un fișier
// <id>.jsonl. Din ultimele rânduri aflăm titlul, ultimul mesaj, ultima unealtă
// și dacă lucrează. Hook-urile (vezi hook.js), când sunt instalate, fac starea
// exactă: „așteaptă aprobare” nu se poate deduce sigur doar din transcriere.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const TAIL_BYTES = 512 * 1024;
const HEAD_BYTES = 64 * 1024;
const RECENT_DAYS = 3;
const MAX_SESSIONS = 25;
const MIN = 60 * 1000;

export class Sessions {
  constructor() {
    this.cache = new Map();   // cale -> { key, info }
    this.hooks = new Map();   // sessionId -> { event, at, message }
    this.lastScan = null;
  }

  // Apelat de /hook. Ținem doar ultimul eveniment per sesiune.
  recordHook(payload) {
    if (!payload || !payload.session_id) return;
    this.hooks.set(payload.session_id, {
      event: payload.hook_event_name || '',
      message: payload.message || '',
      tool: payload.tool_name || '',
      at: Date.now(),
    });
  }

  // Toate transcrierile modificate în ultimele zile, cele mai noi primele.
  listFiles() {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * MIN;
    const files = [];
    let dirs = [];
    try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }); } catch { return files; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(PROJECTS_DIR, d.name);
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (st.mtimeMs < cutoff) continue;
        // Subagenții scriu în <id>/subagents/*.jsonl; cât lucrează ei,
        // transcrierea principală poate sta neatinsă minute întregi.
        const subMtime = newestMtime(path.join(dir, name.slice(0, -6), 'subagents'));
        files.push({ file, st, activityMs: Math.max(st.mtimeMs, subMtime) });
      }
    }
    files.sort((a, b) => b.activityMs - a.activityMs);
    return files;
  }

  // Momentul ultimei scrieri în orice transcriere (pentru regula de inactivitate).
  lastActivityMs(excludeSessionIds = new Set()) {
    let newest = 0;
    for (const f of this.listFiles()) {
      const id = path.basename(f.file, '.jsonl');
      if (excludeSessionIds.has(id)) continue;
      newest = Math.max(newest, f.activityMs);
    }
    return newest;
  }

  list(taskSessionIds = new Set()) {
    const now = Date.now();
    const out = [];
    const seen = new Set();
    for (const f of this.listFiles().slice(0, MAX_SESSIONS)) {
      const key = `${f.st.size}:${f.st.mtimeMs}`;
      let cached = this.cache.get(f.file);
      if (!cached || cached.key !== key) {
        cached = { key, info: parseTranscript(f.file, f.st.size) };
        this.cache.set(f.file, cached);
      }
      seen.add(f.file);
      const info = cached.info;
      if (!info.sessionId) continue;
      const state = this.stateFor(info, f.activityMs, now);
      out.push({
        id: info.sessionId,
        title: info.title || '(fără titlu)',
        cwd: info.cwd || '',
        project: info.cwd ? path.basename(info.cwd) : '',
        state: state.state,
        stateLabel: state.label,
        lastActivity: new Date(f.activityMs).toISOString(),
        lastText: info.lastText,
        lastTool: info.lastTool,
        lastPrompt: info.lastPrompt,
        isTask: taskSessionIds.has(info.sessionId),
        question: info.question,
      });
    }
    for (const k of this.cache.keys()) if (!seen.has(k)) this.cache.delete(k);
    this.lastScan = now;
    return out;
  }

  detail(sessionId) {
    for (const f of this.listFiles()) {
      if (path.basename(f.file, '.jsonl') !== sessionId) continue;
      const info = parseTranscript(f.file, f.st.size, { timeline: true });
      const state = this.stateFor(info, f.activityMs, Date.now());
      return {
        id: sessionId,
        title: info.title || '(fără titlu)',
        cwd: info.cwd,
        state: state.state,
        stateLabel: state.label,
        lastActivity: new Date(f.activityMs).toISOString(),
        question: info.question,
        timeline: info.timeline,
      };
    }
    return null;
  }

  stateFor(info, activityMs, now) {
    const age = now - activityMs;
    let state = guessState(info.last, age);
    const hook = this.hooks.get(info.sessionId);
    // Un hook contează doar dacă e mai nou decât ultima scriere în transcriere.
    if (hook && hook.at >= activityMs - 2000 && now - hook.at < 6 * 60 * MIN) {
      if (hook.event === 'Notification') {
        state = /permission|permisiun/i.test(hook.message) ? 'waiting' : 'idle';
      } else if (hook.event === 'Stop' || hook.event === 'SessionEnd') {
        state = 'idle';
      } else if (['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStop'].includes(hook.event)) {
        state = 'working';
      }
    }
    if (info.question && state !== 'working' && state !== 'waiting') state = 'question';
    return { state, label: LABELS[state] };
  }
}

const LABELS = {
  working: 'Lucrează',
  waiting: 'Așteaptă aprobare',
  question: 'Așteaptă răspuns',
  idle: 'Liber',
};

// Butoanele de aplicație din caseta „next step” n-au etichetă proprie.
const APP_ACTIONS = {
  commit: 'Fă commit',
  create_pr: 'Deschide un PR',
  merge: 'Fă merge',
  verify: 'Verifică',
  fix_ci: 'Repară CI',
  address_comments: 'Rezolvă comentariile',
  resolve_conflicts: 'Rezolvă conflictele',
};

// O întrebare cu butoane pusă de Claude: caseta „next step” din aplicația
// Claude (wrap_up cu `ask`) sau AskUserQuestion.
export function questionFrom(t, at) {
  const i = t.input || {};
  if (/(^|__)wrap_up$/.test(t.name || '') && i.ask) {
    let actions = i.actions;
    if (typeof actions === 'string') {
      try { actions = JSON.parse(actions); } catch { actions = []; }
    }
    const options = (Array.isArray(actions) ? actions : []).map(a => {
      if (a && a.label) return { label: a.label, message: a.message || a.label };
      const label = a && APP_ACTIONS[a.action];
      return label ? { label, message: label } : null;
    }).filter(Boolean);
    return { kind: 'next-step', text: clip(i.ask, 300), recap: clip(i.recap || '', 500), options, at };
  }
  if (t.name === 'AskUserQuestion' && Array.isArray(i.questions) && i.questions.length) {
    const first = i.questions[0];
    return {
      kind: 'ask',
      toolId: t.id,
      text: clip(i.questions.map(q => q.question).join(' / '), 400),
      recap: '',
      options: (first.options || []).map(o => ({ label: o.label, message: o.label, description: o.description || '' })),
      at,
    };
  }
  return null;
}

// Starea din ultimul mesaj al transcrierii și din cât timp a trecut de la el.
export function guessState(last, age) {
  if (!last) return 'idle';
  if (age < 15 * 1000 && !last.endTurnText) return 'working';
  if (last.role === 'assistant') {
    if (last.hasToolUse) {
      // O unealtă pornită și fără rezultat: rulează sau așteaptă aprobare.
      if (age < 3 * MIN) return 'working';
      return age < 60 * MIN ? 'waiting' : 'idle';
    }
    if (last.endTurnText) return 'idle';
    return age < 3 * MIN ? 'working' : 'idle';
  }
  if (last.role === 'user') {
    if (last.interrupted) return 'idle';
    return age < 10 * MIN ? 'working' : 'idle';
  }
  return 'idle';
}

function newestMtime(dir) {
  let newest = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const n of names) {
    try { newest = Math.max(newest, fs.statSync(path.join(dir, n)).mtimeMs); } catch { /* fișier șters între timp */ }
  }
  return newest;
}

function readSlice(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  const out = [];
  for (const l of lines) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* rând tăiat la capăt */ }
  }
  return out;
}

export function parseTranscript(file, size, { timeline = false } = {}) {
  const start = Math.max(0, size - TAIL_BYTES);
  const entries = parseLines(readSlice(file, start, size - start), start > 0);
  const info = {
    sessionId: path.basename(file, '.jsonl'),
    title: '',
    cwd: '',
    lastPrompt: '',
    lastText: '',
    lastTool: '',
    last: null,
    question: null,
    timeline: timeline ? [] : undefined,
  };

  for (const e of entries) {
    if (e.cwd) info.cwd = e.cwd;
    if (e.type === 'custom-title' && e.customTitle) info.title = e.customTitle;
    else if (e.type === 'agent-name' && e.agentName && !info.title) info.title = e.agentName;
    else if (e.type === 'summary' && e.summary && !info.title) info.title = e.summary;
    else if (e.type === 'last-prompt' && e.lastPrompt) info.lastPrompt = clip(e.lastPrompt, 300);
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || !e.message) continue;

    const blocks = normalizeContent(e.message.content);
    const role = e.message.role || e.type;
    const texts = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text);
    const tools = blocks.filter(b => b.type === 'tool_use');
    const isToolResult = blocks.some(b => b.type === 'tool_result');

    if (role === 'assistant') {
      if (texts.length) info.lastText = clip(texts.join('\n'), 600);
      if (tools.length) info.lastTool = describeTool(tools[tools.length - 1]);
      for (const t of tools) {
        const q = questionFrom(t, e.timestamp);
        if (q) info.question = q;
        // Altă unealtă după întrebare: Claude a mers mai departe.
        else if (info.question && !/(^|__)wrap_up$/.test(t.name)) info.question = null;
      }
    } else if (info.question) {
      // Răspunsul vine ca mesaj scris de utilizator (nu notificările automate,
      // care încep cu „<”) sau, la AskUserQuestion, ca rezultat al uneltei.
      const typed = !isToolResult && texts.some(t => !t.trimStart().startsWith('<'));
      const answeredAsk = info.question.toolId && blocks.some(b => b.type === 'tool_result' && b.tool_use_id === info.question.toolId);
      if (typed || answeredAsk) info.question = null;
    }
    const interrupted = role === 'user' && texts.some(t => t.startsWith('[Request interrupted'));
    info.last = {
      role,
      hasToolUse: tools.length > 0,
      endTurnText: role === 'assistant' && texts.length > 0 && tools.length === 0,
      interrupted,
      at: e.timestamp,
    };

    if (timeline) {
      const at = e.timestamp;
      if (role === 'user' && !isToolResult && texts.length && !interrupted) {
        info.timeline.push({ at, kind: 'prompt', text: clip(texts.join('\n'), 1500) });
      } else if (role === 'assistant') {
        for (const t of texts) info.timeline.push({ at, kind: 'text', text: clip(t, 1500) });
        for (const t of tools) info.timeline.push({ at, kind: 'tool', text: describeTool(t) });
      }
    }
  }

  if (!info.title) info.title = firstPrompt(file);
  if (timeline) info.timeline = info.timeline.slice(-60);
  return info;
}

// Sesiunile din terminal nu au titlu: luăm prima cerere a utilizatorului.
function firstPrompt(file) {
  try {
    const st = fs.statSync(file);
    for (const e of parseLines(readSlice(file, 0, Math.min(HEAD_BYTES, st.size)), false)) {
      if (e.type !== 'user' || e.isSidechain || !e.message) continue;
      const text = normalizeContent(e.message.content).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (text && !text.startsWith('<') && !text.startsWith('Background')) return clip(text, 80);
    }
  } catch { /* fișierul a dispărut */ }
  return '';
}

function normalizeContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

export function describeTool(t) {
  const i = t.input || {};
  const detail =
    i.command ? clip(i.command, 140) :
    i.file_path ? path.basename(i.file_path) :
    i.notebook_path ? path.basename(i.notebook_path) :
    i.pattern ? clip(i.pattern, 80) :
    i.description ? clip(i.description, 100) :
    i.url ? clip(i.url, 100) :
    i.query ? clip(i.query, 100) :
    i.prompt ? clip(i.prompt, 100) : '';
  // mcp__server__unealta → unealta
  const name = String(t.name || '').replace(/^mcp__.+?__/, '');
  return detail ? `${name}: ${detail}` : name;
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
