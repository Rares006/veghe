#!/usr/bin/env node
// Hook PermissionRequest pentru Claude Code: când ești plecat de la Mac,
// cererea de aprobare ajunge pe telefon și răspunsul de acolo decide.
// Dacă agentul nu rulează sau nu răspunde, nu scrie nimic și apare dialogul
// obișnuit pe Mac.

import fs from 'node:fs';
import { CONFIG_PATH } from './config.js';

let port = 8787;
try { port = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).port || port; } catch { /* agent neinstalat */ }

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', async () => {
  try {
    const p = JSON.parse(input);
    const r = await fetch(`http://127.0.0.1:${port}/hook/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: p.session_id,
        cwd: p.cwd,
        tool_name: p.tool_name,
        tool_input: p.tool_input,
      }),
      // Puțin sub timeout-ul hook-ului din settings.json (900 s).
      signal: AbortSignal.timeout(14 * 60 * 1000),
    });
    const { decision } = await r.json();
    if (decision && (decision.behavior === 'allow' || decision.behavior === 'deny')) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision },
      }));
    }
  } catch { /* agentul nu rulează: apare dialogul de pe Mac */ }
  process.exit(0);
});
