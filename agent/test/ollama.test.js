import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ollamaModels, ollamaEnv } from '../tasks.js';

test('ollamaModels: cel mai recent model primul', async () => {
  const srv = http.createServer((req, res) => {
    assert.equal(req.url, '/api/tags');
    res.end(JSON.stringify({ models: [
      { name: 'qwen2.5-coder:7b', modified_at: '2026-01-01T00:00:00Z', details: { parameter_size: '7.6B' } },
      { name: 'llama3.1:8b', modified_at: '2026-05-01T00:00:00Z', details: {} },
    ] }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const models = await ollamaModels(`http://127.0.0.1:${srv.address().port}`);
    assert.deepEqual(models.map(m => m.name), ['llama3.1:8b', 'qwen2.5-coder:7b']);
    assert.equal(models[1].parameterSize, '7.6B');
  } finally {
    srv.close();
  }
});

test('ollamaModels: mesaj clar când Ollama e oprit', async () => {
  await assert.rejects(ollamaModels('http://127.0.0.1:1'), /Ollama nu răspunde/);
});

test('ollamaEnv: toate rolurile folosesc modelul ales', () => {
  const env = ollamaEnv('http://127.0.0.1:11434', 'qwen3:8b');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:11434');
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'qwen3:8b');
  assert.equal(env.ANTHROPIC_MODEL, 'qwen3:8b');
});
