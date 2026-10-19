// Controlul Mac-ului de pe telefon: click, scroll, text și taste.
//
// Evenimentele le trimite tools/cl-input.swift, compilat la prima nevoie în
// ~/Library/Application Support/ControlLaptop/bin. macOS le acceptă doar dacă
// node are permisiunea Accessibility (Privacy & Security → Accessibility).

import { nativeTool, run } from './native.js';
import { httpError } from './tasks.js';

const KEYS = new Set(['return', 'tab', 'space', 'delete', 'escape', 'left', 'right', 'up', 'down',
  'forwarddelete', 'home', 'end', 'pageup', 'pagedown', 'a', 'c', 'v', 'x', 'z', 'w', 'q', 's', 'f', 'n', 't']);
const MODS = new Set(['cmd', 'shift', 'alt', 'ctrl']);

export const ensureHelper = () => nativeTool('cl-input');

async function helper(args) {
  const bin = await ensureHelper();
  try {
    const { stdout } = await run(bin, args, { timeout: 10000 });
    return stdout.trim();
  } catch (err) {
    if (String(err.stderr).includes('untrusted')) throw untrusted();
    throw httpError(400, String(err.stderr || err.message).trim());
  }
}

function untrusted() {
  return httpError(403, 'Lipsește permisiunea Accessibility. Pe Mac: System Settings → Privacy & Security → Accessibility → activează node, apoi încearcă din nou.');
}

// prompt = true deschide pe Mac cererea de permisiune (o dată, când activezi controlul).
export async function checkAccess(prompt = true) {
  return (await helper([prompt ? 'check' : 'status'])) === 'trusted';
}

const fraction = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw httpError(400, 'Poziție invalidă.');
  return n.toFixed(5);
};
const display = v => String(Math.min(8, Math.max(1, parseInt(v, 10) || 1)));

export async function performInput(body) {
  switch (body.action) {
    case 'click': {
      const button = ['left', 'right', 'double'].includes(body.button) ? body.button : 'left';
      return helper(['click', display(body.display), fraction(body.x), fraction(body.y), button]);
    }
    case 'scroll': {
      const dy = Math.max(-3000, Math.min(3000, parseInt(body.dy, 10) || 0));
      return helper(['scroll', display(body.display), fraction(body.x ?? 0.5), fraction(body.y ?? 0.5), String(dy)]);
    }
    case 'type': {
      const text = String(body.text || '');
      if (!text || text.length > 2000) throw httpError(400, 'Text gol sau prea lung.');
      return helper(['type', text]);
    }
    case 'key': {
      const key = String(body.key || '').toLowerCase();
      if (!KEYS.has(key)) throw httpError(400, 'Tastă necunoscută.');
      const mods = (Array.isArray(body.mods) ? body.mods : []).filter(m => MODS.has(m));
      return helper(['key', key, mods.join(',')]);
    }
    default:
      throw httpError(400, 'Acțiune necunoscută.');
  }
}
