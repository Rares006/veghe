// Notificări pe telefon prin ntfy (aplicația gratuită „ntfy” din App Store).
//
// Agentul publică pe un topic aleator din config.json (`ntfyTopic`); telefonul
// se abonează la el în aplicație. Trimitem doar cât e nevoie ca să știi ce s-a
// întâmplat (numele proiectului și al uneltei), nu comenzi, fișiere sau tokenul.
// Notificăm doar când ești plecat de la Mac, ca să nu sune telefonul degeaba.

import path from 'node:path';

const AWAY_SECONDS = 60;

export class Notifier {
  constructor({ config, userIdleSeconds, clickUrl = () => '', log = () => {} }) {
    this.config = config;
    this.userIdleSeconds = userIdleSeconds;
    this.clickUrl = clickUrl;
    this.log = log;
  }

  get enabled() {
    return Boolean(this.config.ntfyTopic);
  }

  // { title, message, priority?, tags?, force? } — force trimite și dacă ești la Mac.
  async send({ title, message, priority = 3, tags = [], force = false }) {
    if (!this.enabled) return false;
    if (!force) {
      const idle = await this.userIdleSeconds().catch(() => null);
      if (idle == null || idle < AWAY_SECONDS) return false;
    }
    const server = (this.config.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '');
    const click = this.clickUrl();
    try {
      const r = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: this.config.ntfyTopic,
          title, message, priority, tags,
          ...(click ? { click } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    } catch (err) {
      this.log(`[notificare] n-am putut trimite „${title}”: ${err.message}`);
      return false;
    }
  }
}

export function projectName(cwd) {
  return cwd ? path.basename(cwd) : 'Claude';
}
