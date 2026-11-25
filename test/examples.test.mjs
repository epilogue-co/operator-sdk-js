import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { ptyAvailable, startPtyFake } from './pty-fake.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.join(here, '..', 'examples', 'node');
async function withFake(fn) {
  const fake = await startPtyFake();
  try {
    await fn(fake.path);
  } finally {
    fake.stop();
  }
}

test(
  'identify and backup-save examples',
  { skip: !ptyAvailable && 'needs macOS/Linux and python3' },
  async () => {
    await withFake(async port => {
      const { stdout } = await run(process.execPath, [path.join(examples, 'identify.mjs'), port]);
      assert.match(stdout, /Operator SIMULATED0001, firmware 1\.2\.3/);
      assert.match(stdout, /Game Boy \/ Color cartridge, game 65536 B, save 8192 B/);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsdk-'));
      const out = path.join(dir, 'game.sav');
      const r = await run(process.execPath, [path.join(examples, 'backup-save.mjs'), out, port]);
      assert.match(r.stdout, /Wrote 8192 B to .*game\.sav, CRC-32/);
      assert.equal(fs.statSync(out).size, 8192);
      await assert.rejects(
        run(process.execPath, [path.join(examples, 'backup-save.mjs'), out, port]),
        e => e.code === 1 && /EEXIST/.test(e.stderr)
      );
    });
  }
);
