// Configurația agentului: port, token, reguli pentru coadă.
// Stă în ~/Library/Application Support/ControlLaptop/config.json și se creează
// singură la prima pornire, cu un token aleator.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.CONTROL_LAPTOP_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'ControlLaptop');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');

const DEFAULTS = {
  port: 8787,
  // Coada pornește un task doar dacă nicio sesiune Claude n-a scris nimic
  // în ultimele `idleMinutes` minute.
  idleMinutes: 3,
  // Ține Mac-ul treaz cât rulează agentul (caffeinate -i). Capacul închis
  // tot îl adoarme.
  keepAwake: true,
  // Adrese în plus pe care să asculte (ex. IP-ul din rețeaua de acasă).
  // Implicit: doar 127.0.0.1 și adresele Tailscale (100.64.0.0/10).
  extraBind: [],
  // Calea spre `claude`. Gol = o caută singur (aplicația Claude, apoi PATH).
  claudePath: '',
  // „auto”: Claude rulează singur ce e sigur și se oprește (te întreabă pe
  // telefon) doar la acțiunile care cer o decizie — ca pe laptop.
  defaultPermissionMode: 'auto',
  // Task-urile cu motorul „ollama” rulează tot `claude -p`, dar îndreptat spre
  // API-ul compatibil Anthropic al lui Ollama (Ollama 0.14+), cu un model local.
  ollamaUrl: 'http://127.0.0.1:11434',
  // Modelul folosit când task-ul nu alege unul (gol = primul instalat).
  ollamaModel: '',
  maxScreenWidth: 1800,
  // Integrarea cu CamFlow (camerele din aplicația CamFlow, prin camflow-bridge.js).
  // Oprită implicit; camera laptopului merge oricum.
  camflow: false,
  // Notificări pe telefon prin ntfy: te abonezi la topic în aplicația ntfy.
  // Topicul se generează aleator la prima pornire; gol = fără notificări.
  ntfyServer: 'https://ntfy.sh',
};

export function loadConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`config.json nu se poate citi: ${err.message}`);
  }
  const config = { ...DEFAULTS, ...stored };
  if (!config.token || config.token.length < 32) {
    config.token = crypto.randomBytes(24).toString('base64url');
  }
  // Oricine știe topicul poate citi notificările, deci trebuie să fie greu de ghicit.
  if (config.ntfyTopic === undefined) {
    config.ntfyTopic = `control-laptop-${crypto.randomBytes(12).toString('hex')}`;
  }
  // Rescriem mereu fișierul, ca să apară și cheile noi cu valorile implicite.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}
