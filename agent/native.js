// Programele mici scrise în Swift (tools/*.swift): click-uri, cameră.
// Le compilăm cu swiftc la prima nevoie, în ~/Library/Application Support/…/bin,
// și din nou doar când sursa e mai nouă decât binarul.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';

export const run = promisify(execFile);
const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools');
const building = new Map();

export function nativeTool(name) {
  const source = path.join(TOOLS, `${name}.swift`);
  // Cu tools/<nume>.plist, unealta devine o mini-aplicație (<nume>.app) pornită
  // cu `open`: macOS cere atunci permisiunile (Camera) pe numele ei, nu al lui node.
  const plist = path.join(TOOLS, `${name}.plist`);
  const asApp = fs.existsSync(plist);
  const bundle = path.join(DATA_DIR, 'bin', `${name}.app`);
  const binary = asApp ? path.join(bundle, 'Contents', 'MacOS', name) : path.join(DATA_DIR, 'bin', name);
  const newest = Math.max(fs.statSync(source).mtimeMs, asApp ? fs.statSync(plist).mtimeMs : 0);
  const fresh = fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= newest;
  if (fresh) return Promise.resolve(asApp ? bundle : binary);
  if (!building.has(name)) {
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const job = run('/usr/bin/swiftc', ['-O', source, '-o', binary], { timeout: 180000 })
      .then(async () => {
        if (!asApp) return binary;
        fs.copyFileSync(plist, path.join(bundle, 'Contents', 'Info.plist'));
        await run('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { timeout: 60000 });
        return bundle;
      })
      .catch(err => {
        throw new Error(`Nu pot compila ${name} (e nevoie de Xcode sau Command Line Tools): ${String(err.stderr || err.message).trim()}`);
      })
      .finally(() => building.delete(name));
    building.set(name, job);
  }
  return building.get(name);
}
