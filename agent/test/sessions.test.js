import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guessState, describeTool, parseTranscript, questionFrom } from '../sessions.js';
import { isTailscale } from '../system.js';

const MIN = 60 * 1000;

test('starea din ultimul mesaj', () => {
  const text = { role: 'assistant', hasToolUse: false, endTurnText: true };
  const tool = { role: 'assistant', hasToolUse: true, endTurnText: false };
  const prompt = { role: 'user', interrupted: false };

  assert.equal(guessState(null, 0), 'idle');
  assert.equal(guessState(text, 2 * MIN), 'idle');
  assert.equal(guessState(tool, 1 * MIN), 'working');
  assert.equal(guessState(tool, 10 * MIN), 'waiting');
  assert.equal(guessState(tool, 2 * 60 * MIN), 'idle');
  assert.equal(guessState(prompt, 5 * MIN), 'working');
  assert.equal(guessState(prompt, 30 * MIN), 'idle');
  assert.equal(guessState({ role: 'user', interrupted: true }, 5000), 'working', 'scriere foarte recentă');
  assert.equal(guessState({ role: 'user', interrupted: true }, MIN), 'idle');
});

test('descrierea uneltelor', () => {
  assert.equal(describeTool({ name: 'Bash', input: { command: 'npm test' } }), 'Bash: npm test');
  assert.equal(describeTool({ name: 'Edit', input: { file_path: '/a/b/app.js' } }), 'Edit: app.js');
  assert.equal(describeTool({ name: 'mcp__ccd_turn__wrap_up', input: {} }), 'wrap_up');
});

test('transcriere: titlu, ultimul text și starea', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
  const file = path.join(dir, 'abc-123.jsonl');
  const lines = [
    { type: 'user', cwd: '/proiect', message: { role: 'user', content: 'Repară testele' }, timestamp: '2026-10-17T10:00:00.000Z' },
    { type: 'assistant', cwd: '/proiect', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', cwd: '/proiect', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', cwd: '/proiect', message: { role: 'assistant', content: [{ type: 'text', text: 'Am reparat.' }], stop_reason: 'end_turn' } },
    { type: 'custom-title', customTitle: 'Teste reparate', sessionId: 'abc-123' },
  ];
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const info = parseTranscript(file, fs.statSync(file).size, { timeline: true });
  assert.equal(info.title, 'Teste reparate');
  assert.equal(info.cwd, '/proiect');
  assert.equal(info.lastText, 'Am reparat.');
  assert.equal(info.lastTool, 'Bash: npm test');
  assert.equal(info.last.endTurnText, true);
  assert.deepEqual(info.timeline.map(t => t.kind), ['prompt', 'tool', 'text']);
  fs.rmSync(dir, { recursive: true });
});

test('adrese Tailscale', () => {
  assert.equal(isTailscale('100.101.102.103'), true);
  assert.equal(isTailscale('100.63.0.1'), false);
  assert.equal(isTailscale('192.168.1.10'), false);
});

test('întrebările cu butoane: deschise, apoi închise de răspuns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-q-'));
  const file = path.join(dir, 'q-1.jsonl');
  const ask = {
    type: 'assistant', cwd: '/p', timestamp: '2026-10-19T08:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__ccd_turn__wrap_up', input: {
      recap: 'Gata partea întâi.', ask: 'Continui cu partea a doua?',
      actions: [{ label: 'Da', message: 'Da, continuă.' }, { action: 'commit' }],
    } }] },
  };
  const result = { type: 'user', cwd: '/p', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } };
  const notification = { type: 'user', cwd: '/p', message: { role: 'user', content: '<task-notification>gata</task-notification>' } };
  fs.writeFileSync(file, [ask, result, notification].map(l => JSON.stringify(l)).join('\n') + '\n');
  let info = parseTranscript(file, fs.statSync(file).size);
  assert.equal(info.question.text, 'Continui cu partea a doua?');
  assert.deepEqual(info.question.options, [{ label: 'Da', message: 'Da, continuă.' }, { label: 'Fă commit', message: 'Fă commit' }]);

  const typed = { type: 'user', cwd: '/p', message: { role: 'user', content: 'Da, continuă.' } };
  fs.appendFileSync(file, JSON.stringify(typed) + '\n');
  info = parseTranscript(file, fs.statSync(file).size);
  assert.equal(info.question, null);
  fs.rmSync(dir, { recursive: true });
});

test('AskUserQuestion: deschisă până vine rezultatul uneltei', () => {
  const t = { name: 'AskUserQuestion', id: 'a1', input: { questions: [{ question: 'Ce variantă?', options: [{ label: 'A', description: 'prima' }, { label: 'B' }] }] } };
  const q = questionFrom(t, '2026-10-19T08:00:00.000Z');
  assert.equal(q.kind, 'ask');
  assert.equal(q.toolId, 'a1');
  assert.deepEqual(q.options.map(o => o.label), ['A', 'B']);
  assert.equal(questionFrom({ name: 'mcp__ccd_turn__wrap_up', input: { recap: 'doar rezumat' } }), null);
});
