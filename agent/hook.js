#!/usr/bin/env node
// Hook pentru Claude Code: trimite agentului evenimentul (Stop, Notification…)
// ca să știe exact când o sesiune lucrează sau așteaptă aprobare.
// Nu blochează niciodată sesiunea: orice eroare e ignorată, ieșirea e mereu 0.

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
    // Trimitem doar ce trebuie pentru stare, nu și conținutul uneltelor.
    const body = JSON.stringify({
      session_id: p.session_id,
      cwd: p.cwd || '',
      hook_event_name: p.hook_event_name,
      message: p.message || '',
      tool_name: p.tool_name || '',
    });
    await fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(800),
    });
  } catch { /* agentul nu rulează */ }
  process.exit(0);
});
