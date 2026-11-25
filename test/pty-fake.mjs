import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { FakeOperator } from './fake-operator.mjs';

export const ptyAvailable =
  (process.platform === 'darwin' || process.platform === 'linux') &&
  spawnSync('python3', ['--version']).status === 0;

export async function startPtyFake(options = {}) {
  const bridge = fileURLToPath(new URL('./pty_bridge.py', import.meta.url));
  const child = spawn('python3', [bridge], { stdio: ['pipe', 'pipe', 'inherit'] });
  const dev = new FakeOperator(options);
  let pending = Buffer.alloc(0);
  let path = null;
  let ready;
  const opened = new Promise(resolve => (ready = resolve));

  child.stdout.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (path === null) {
      const end = pending.indexOf(10);
      if (end < 0) return;
      path = pending.subarray(0, end).toString();
      pending = pending.subarray(end + 1);
      ready();
    }
    while (pending.length >= 64) {
      void dev.write(Uint8Array.from(pending.subarray(0, 64)));
      pending = pending.subarray(64);
    }
  });

  void (async () => {
    for (;;) {
      const bytes = await dev.read();
      if (!bytes) break;
      child.stdin.write(bytes);
    }
  })();

  await opened;
  return {
    path,
    dev,
    stop() {
      dev.close();
      child.stdin.end();
      child.kill();
    },
  };
}
