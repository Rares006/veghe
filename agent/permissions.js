// Cererile de aprobare (Allow/Deny) ale sesiunilor Claude, trimise pe telefon.
//
// Hook-ul PermissionRequest (permission-hook.js) întreabă agentul înainte să
// apară dialogul pe Mac. Dacă ești la Mac, agentul răspunde imediat „nu știu”
// și apare dialogul obișnuit. Dacă ești plecat, cererea așteaptă un răspuns de
// pe telefon; când te întorci la Mac, e eliberată ca să vezi dialogul.

import crypto from 'node:crypto';
import { describeTool } from './sessions.js';

const AWAY_SECONDS = 60;      // de la cât timp fără tastatură/mouse ești „plecat”
const BACK_SECONDS = 5;       // sub atât, ești din nou la Mac
const MAX_WAIT_MS = 10 * 60 * 1000;

export class Permissions {
  constructor({ userIdleSeconds, log = () => {}, onPending = () => {} }) {
    this.userIdleSeconds = userIdleSeconds;
    this.onPending = onPending;   // async () => secunde sau null
    this.log = log;
    this.pending = new Map();
    this.watch = setInterval(() => this.releaseIfBack(), 2000);
    this.watch.unref();
  }

  list() {
    return [...this.pending.values()].map(({ resolve, timer, ...p }) => p);
  }

  // Apelat de hook; se rezolvă cu { behavior, message? } sau null (= dialogul de pe Mac).
  async request(payload) {
    const idle = await this.userIdleSeconds().catch(() => null);
    if (idle == null || idle < AWAY_SECONDS) return null;
    const id = crypto.randomUUID();
    const tool = { name: payload.tool_name || '', input: payload.tool_input || {} };
    return new Promise(resolve => {
      const entry = {
        id,
        sessionId: payload.session_id || '',
        cwd: payload.cwd || '',
        tool: tool.name.replace(/^mcp__.+?__/, ''),
        detail: describeTool(tool),
        at: new Date().toISOString(),
        resolve,
      };
      entry.timer = setTimeout(() => this.finish(id, null, 'expirat'), MAX_WAIT_MS);
      this.pending.set(id, entry);
      this.log(`[aprobare] ${entry.detail} așteaptă răspuns de pe telefon`);
      this.onPending(entry);
    });
  }

  decide(id, behavior, message) {
    if (!['allow', 'deny'].includes(behavior)) {
      const err = new Error('Răspuns necunoscut.');
      err.status = 400;
      throw err;
    }
    const decision = behavior === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: message || 'Refuzat de pe telefon.' };
    if (!this.finish(id, decision, behavior)) {
      const err = new Error('Cererea nu mai așteaptă (ai răspuns pe Mac sau a expirat).');
      err.status = 410;
      throw err;
    }
  }

  finish(id, decision, why) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(decision);
    this.log(`[aprobare] ${entry.detail}: ${why}`);
    return true;
  }

  async releaseIfBack() {
    if (!this.pending.size) return;
    const idle = await this.userIdleSeconds().catch(() => null);
    if (idle != null && idle < BACK_SECONDS) {
      for (const id of [...this.pending.keys()]) this.finish(id, null, 'ești la Mac, apare dialogul');
    }
  }

  // Sesiunea a mers mai departe (ai răspuns în dialog după expirare etc.).
  dropForSession(sessionId) {
    for (const [id, p] of this.pending) if (p.sessionId === sessionId) this.finish(id, null, 'sesiunea a continuat');
  }
}
