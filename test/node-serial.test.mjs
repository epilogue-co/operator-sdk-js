import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HostError, Platform, Status, crc32, isStatus } from '../dist/index.js';
import { NodeSerialTransport, listPorts, openNodeSerial } from '../dist/node.js';
import { ptyAvailable, startPtyFake } from './pty-fake.mjs';

const posix = process.platform === 'darwin' || process.platform === 'linux';

test(
  'tty transport over a pty',
  { skip: !ptyAvailable && 'needs macOS/Linux and python3' },
  async () => {
    const fake = await startPtyFake();
    const { path } = fake;
    try {
      const op = await openNodeSerial({ path, timeoutMs: 2000 });
      assert.ok(op.transport instanceof NodeSerialTransport);
      await op.ping(0x33);
      const info = await op.info();
      assert.equal(info.serial, 'SIMULATED0001');
      assert.equal(info.deviceId, 0);
      const cart = await op.cartStatus();
      assert.equal(cart.platform, Platform.GB);
      const rom = await op.readRom(cart);
      assert.equal(rom.length, 65536);
      assert.equal(crc32(rom), await op.romCrc32(cart));

      await assert.rejects(op.writeSave(cart, new Uint8Array(8192)), e =>
        isStatus(e, Status.NO_SESSION)
      );
      const session = await op.sessionBegin();
      const data = Uint8Array.from({ length: 8192 }, (_, i) => (i * 5) & 0xff);
      await op.writeSave(session, data);
      assert.equal(await op.saveCrc32(session), crc32(data));
      assert.deepEqual(await op.readSave(session), data);
      await op.sessionEnd();
      await op.close();
      await op.close();
    } finally {
      fake.stop();
    }
  }
);

test('open missing path', { skip: !posix && 'macOS/Linux only' }, async () => {
  await assert.rejects(
    openNodeSerial({ path: '/dev/does-not-exist-opsdk' }),
    e => e.code === HostError.NO_DEVICE
  );
  assert.throws(
    () => new NodeSerialTransport('/dev/null'),
    e => e.code === HostError.IO
  );
});

test('listPorts returns device paths', { skip: !posix && 'macOS/Linux only' }, async () => {
  const ports = await listPorts();
  assert.ok(Array.isArray(ports));
  for (const p of ports) assert.match(p, /^\/dev\/(cu\.usbmodem|ttyACM)/);
});
