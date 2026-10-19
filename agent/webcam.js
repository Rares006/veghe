// Camera laptopului (FaceTime HD, o cameră USB sau iPhone prin Continuity),
// prin tools/cl-camera.swift. Prima poză face macOS să ceară permisiunea
// Camera pentru node.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeTool, run } from './native.js';
import { httpError } from './tasks.js';

export const ensureCameraTool = () => nativeTool('cl-camera');

const APPROVE = 'Camera nu răspunde încă. Dacă pe Mac a apărut cererea de acces la cameră („cl-camera”), apasă OK, apoi încearcă din nou.';

export async function listWebcams() {
  const app = await ensureCameraTool();
  // Lista nu folosește camera, deci binarul poate rula direct.
  const { stdout } = await run(path.join(app, 'Contents', 'MacOS', 'cl-camera'), ['list'], { timeout: 10000 });
  return JSON.parse(stdout);
}

// O singură cameră o dată: două sesiuni pornite deodată se încurcă.
let busy = Promise.resolve();

export function snapWebcam({ id = 'default', maxWidth = 1280 } = {}) {
  const job = busy.then(async () => {
    const app = await ensureCameraTool();
    // O poză anterioară încă așteaptă (de obicei cererea de acces de pe Mac):
    // nu pornim încă una, ar aduna dialoguri.
    const waiting = await run('/usr/bin/pgrep', ['-f', `${path.basename(app)}/Contents/MacOS/cl-camera snap`]).then(() => true, () => false);
    if (waiting) throw httpError(409, APPROVE);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veghe-cam-'));
    const out = path.join(dir, 'cam.jpg');
    try {
      // -W așteaptă să se termine, -g nu-l aduce în față, -n pornește o instanță nouă.
      await run('/usr/bin/open', ['-W', '-g', '-n', '-a', app, '--args', 'snap', id, out, String(maxWidth)], { timeout: 30000 })
        .catch(err => {
          if (err.killed) throw httpError(504, APPROVE);
          throw err;
        });
      if (fs.existsSync(out + '.err')) throw new Error(fs.readFileSync(out + '.err', 'utf8').trim());
      if (!fs.existsSync(out)) throw new Error('Camera n-a trimis nicio imagine (macOS a oprit programul?).');
      return fs.readFileSync(out);
    } catch (err) {
      if (err.status) throw err;
      const msg = String(err.message || err).trim();
      if (msg.includes('denied')) {
        throw httpError(403, 'Lipsește permisiunea Camera. Pe Mac: System Settings → Privacy & Security → Camera → activează „cl-camera”.');
      }
      throw httpError(500, msg || 'Camera nu răspunde.');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  busy = job.catch(() => {});
  return job;
}
