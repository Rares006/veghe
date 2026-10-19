// Ce vede și cum stă Mac-ul: captura de ecran, bateria, aplicația din față,
// de cât timp n-a atins nimeni tastatura.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function captureScreen({ display = 1, maxWidth = 1800 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-laptop-'));
  const raw = path.join(dir, 'screen.jpg');
  const out = path.join(dir, 'small.jpg');
  try {
    // -x: fără sunet; -D: ecranul (1 = principal).
    await run('/usr/sbin/screencapture', ['-x', '-t', 'jpg', '-D', String(display), raw], { timeout: 15000 });
    if (!fs.existsSync(raw)) {
      throw new Error('screencapture n-a produs nicio imagine. Dă-i agentului permisiunea Screen Recording (System Settings → Privacy & Security).');
    }
    await run('/usr/bin/sips', ['-Z', String(maxWidth), '-s', 'formatOptions', '70', raw, '--out', out], { timeout: 15000 });
    return fs.readFileSync(out);
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    if (/could not create image|invalid display/i.test(msg)) {
      throw new Error(`Nu pot captura ecranul ${display}: ${msg.trim()}`);
    }
    throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Informațiile se schimbă rar; telefonul întreabă la câteva secunde.
let cached = null;
let cachedAt = 0;

export async function systemInfo() {
  if (cached && Date.now() - cachedAt < 5000) return cached;
  const [battery, frontApp, idle] = await Promise.all([
    readBattery().catch(() => null),
    readFrontApp().catch(() => ''),
    userIdleSeconds().catch(() => null),
  ]);
  cached = { host: os.hostname().replace(/\.local$/, ''), battery, frontApp, userIdleSeconds: idle };
  cachedAt = Date.now();
  return cached;
}

async function readBattery() {
  const { stdout } = await run('/usr/bin/pmset', ['-g', 'batt'], { timeout: 3000 });
  const pct = stdout.match(/(\d+)%/);
  return {
    percent: pct ? Number(pct[1]) : null,
    onAC: /AC Power/.test(stdout),
    charging: /;\s*charging/.test(stdout),
  };
}

async function readFrontApp() {
  // lsappinfo nu cere nicio permisiune, spre deosebire de AppleScript.
  const { stdout: asn } = await run('/usr/bin/lsappinfo', ['front'], { timeout: 3000 });
  const { stdout } = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', asn.trim()], { timeout: 3000 });
  const m = stdout.match(/"(?:LSDisplayName|name)"="([^"]*)"/i);
  return m ? m[1] : '';
}

export async function userIdleSeconds() {
  const { stdout } = await run('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  const m = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return m ? Math.round(Number(m[1]) / 1e9) : null;
}

// Ține Mac-ul treaz (fără să țină ecranul aprins) cât trăiește agentul.
export function keepAwake() {
  const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
  child.unref();
  return child;
}

// Adresele pe care ascultă agentul: loopback + Tailscale (100.64.0.0/10) + ce e în config.
export function bindAddresses(extra = []) {
  const addrs = new Set(['127.0.0.1', ...extra]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && isTailscale(a.address)) addrs.add(a.address);
    }
  }
  return [...addrs];
}

export function isTailscale(ip) {
  const p = ip.split('.').map(Number);
  return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}
