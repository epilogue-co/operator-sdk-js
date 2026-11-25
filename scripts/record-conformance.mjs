#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Operator, OpsdkError, crc32 } from '../dist/index.js';
import { FakeOperator } from '../test/fake-operator.mjs';
import { runCall } from '../test/conformance-calls.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hex = b => Buffer.from(b).toString('hex');
const RECORDED_APP_VERSION = [1, 2, 3];

const SCENARIOS = [
  ['device', {}, ['ping 0x5a', 'info']],
  [
    'cartridge_and_reads',
    {},
    [
      'cart_status',
      'rom_read 4096 8192',
      'rom_crc32 0 65536',
      'save_read 0 8192',
      'save_crc32 0 8192',
      'rom_read 65536 512',
    ],
  ],
  [
    'session_and_save_write',
    {},
    [
      'cart_status',
      'save_write 8192 3',
      'session_begin',
      'save_write 8192 3',
      'save_crc32 0 8192',
      'save_write 8192 5 0xee',
      'session_end',
      'session_end',
    ],
  ],
  ['firmware_without_sdk', { sdk: false }, ['ping 0x5a', 'info']],
  ['empty_slot', { platform: 0 }, ['cart_status', 'session_begin']],
  ['led', {}, ['led_set 255 128 0', 'led_release']],
  ['stale_reply_read_is_resent', {}, [dev => (dev.stalePackets = 2), 'cart_status', 'info']],
  [
    'stale_reply_write_is_not_resent',
    {},
    ['session_begin', dev => (dev.stalePackets = 1), 'save_write 8192 7', 'save_crc32 0 8192'],
  ],
];

async function record([name, options, steps]) {
  const dev = new FakeOperator({ appVersion: RECORDED_APP_VERSION, ...options });
  const lines = [`scenario ${name}`];
  let pending = null;
  const flush = () => {
    if (pending) lines.push(`< ${hex(Uint8Array.from(pending))}`);
    pending = null;
  };
  const send = dev.send.bind(dev);
  dev.send = bytes => {
    pending = (pending ?? []).concat(Array.from(bytes));
    send(bytes);
  };
  const transport = {
    read: () => dev.read(),
    write: async data => {
      flush();
      lines.push(`> ${hex(data)}`);
      await dev.write(data);
    },
    close: () => dev.close(),
  };
  const op = new Operator(transport, { timeoutMs: 1000 });
  for (const step of steps) {
    if (typeof step === 'function') {
      step(dev);
      continue;
    }
    flush();
    lines.push(`call ${step}`);
    const result = await runCall(op, step, { OpsdkError, crc32 });
    await new Promise(r => setTimeout(r, 0));
    flush();
    lines.push(`expect ${result}`);
  }
  flush();
  lines.push('end');
  await op.close();
  return lines.join('\n');
}

const out = [];
for (const s of SCENARIOS) out.push(await record(s), '');
const file = path.join(root, 'conformance', 'transcripts.txt');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, out.join('\n'));
console.log(`wrote ${path.relative(root, file)}: ${SCENARIOS.length} scenarios`);
