#!/usr/bin/env node
// Adaugă (sau, cu --remove, scoate) hook-urile Veghe în
// ~/.claude/settings.json. Face o copie de siguranță înainte și nu atinge
// celelalte setări sau hook-uri.
//
// Hook-urile spun agentului exact când o sesiune primește o cerere, cere
// aprobare sau termină, iar când ești plecat de la Mac trimit cererile de
// aprobare (Allow/Deny) pe telefon. Se aplică sesiunilor pornite după instalare.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const node = process.execPath;
const hook = file => `"${node}" "${path.join(ROOT, 'agent', file)}"`;
// Starea sesiunilor + aprobările de pe telefon. PermissionRequest poate aștepta
// până la 15 minute un răspuns de pe telefon, de aici timeout-ul mai mare.
const EVENTS = {
  UserPromptSubmit: { command: hook('hook.js'), timeout: 5 },
  Notification: { command: hook('hook.js'), timeout: 5 },
  Stop: { command: hook('hook.js'), timeout: 5 },
  SessionEnd: { command: hook('hook.js'), timeout: 5 },
  PermissionRequest: { command: hook('permission-hook.js'), timeout: 900 },
};
const MARK = /agent\/(permission-)?hook\.js/;
const remove = process.argv.includes('--remove');

let settings = {};
if (fs.existsSync(SETTINGS)) {
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  settings = JSON.parse(raw);
  fs.writeFileSync(`${SETTINGS}.bak-control-laptop`, raw);
}
settings.hooks = settings.hooks || {};

for (const [ev, { command, timeout }] of Object.entries(EVENTS)) {
  // Scoatem întâi orice intrare veche a noastră, ca rularea repetată să nu dubleze.
  const groups = (settings.hooks[ev] || [])
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !MARK.test(String(h.command || ''))) }))
    .filter(g => g.hooks.length);
  if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout }] });
  if (groups.length) settings.hooks[ev] = groups;
  else delete settings.hooks[ev];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(remove
  ? 'Hook-urile Veghe au fost scoase.'
  : `Hook-uri adăugate pentru: ${Object.keys(EVENTS).join(', ')}.\nCopie de siguranță: ${SETTINGS}.bak-control-laptop\nSe aplică sesiunilor Claude pornite de acum înainte.`);
