import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HostError, Platform, crc32 } from '../dist/index.js';
import { SerialPortTransport, listPorts, openNodeSerial } from '../dist/node.js';
import { FakeOperator } from './fake-operator.mjs';

function fakeSerialportModule(devices) {
  class SerialPort {
    static async list() {
      return [
        { path: 'COM1' },
        { path: 'COM9', vendorId: '2341', productId: '0043' },
        ...Object.keys(devices).map(path => ({ path, vendorId: '16D0', productId: '123D' })),
      ];
    }
    constructor({ path, baudRate, autoOpen }) {
      assert.equal(baudRate, 115200);
      assert.equal(autoOpen, false);
      this.path = path;
      this.isOpen = false;
      this.listeners = { data: [], close: [], error: [] };
    }
    open(cb) {
      this.dev = devices[this.path];
      if (!this.dev) return cb(new Error(`Opening ${this.path}: File not found`));
      this.isOpen = true;
      (async () => {
        for (;;) {
          const chunk = await this.dev.read();
          if (!chunk || !this.isOpen) break;
          for (const l of this.listeners.data) l(Buffer.from(chunk));
        }
      })();
      cb(null);
    }
    on(event, listener) {
      this.listeners[event].push(listener);
      return this;
    }
    write(data, cb) {
      this.dev.write(Uint8Array.from(data)).then(() => cb(null), cb);
      return true;
    }
    close(cb) {
      this.isOpen = false;
      this.dev.close();
      for (const l of this.listeners.close) l();
      cb(null);
    }
  }
  return { SerialPort };
}

test('serialport discovery and transactions', async () => {
  const dev = new FakeOperator();
  const serialport = fakeSerialportModule({ COM7: dev });
  assert.deepEqual(await listPorts({ backend: 'serialport', serialport }), ['COM7']);

  const op = await openNodeSerial({ backend: 'serialport', serialport, timeoutMs: 1000 });
  assert.ok(op.transport instanceof SerialPortTransport);
  assert.equal(op.transport.path, 'COM7');
  const cart = await op.cartStatus();
  assert.equal(cart.platform, Platform.GB);
  assert.equal(crc32(await op.readRom(cart, { length: 8192 })), crc32(dev.rom.subarray(0, 8192)));
  const session = await op.sessionBegin();
  const data = Uint8Array.from({ length: 8192 }, (_, i) => (i * 11) & 0xff);
  await op.writeSave(session, data);
  assert.equal(await op.saveCrc32(session), crc32(data));
  await op.sessionEnd();
  await op.close();
  await op.close();
});

test('serialport missing port or module', async () => {
  const serialport = fakeSerialportModule({});
  await assert.rejects(
    openNodeSerial({ backend: 'serialport', serialport, path: 'COM42' }),
    e => e.code === HostError.NO_DEVICE
  );
  await assert.rejects(
    openNodeSerial({ backend: 'serialport', serialport }),
    e => e.code === HostError.NO_DEVICE
  );
  await assert.rejects(
    openNodeSerial({ backend: 'serialport', serialport: { SerialPort: null }, path: 'COM1' }),
    e => e instanceof TypeError && /SerialPort is not a constructor/.test(e.message)
  );
});
