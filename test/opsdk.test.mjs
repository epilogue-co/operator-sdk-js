import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  Effect,
  HostError,
  Op,
  Operator,
  OpsdkError,
  Platform,
  Status,
  WebSerialTransport,
  WebUSBTransport,
  buildCommand,
  buildLed,
  cameraDefaults,
  cameraMatrix,
  crc32,
  decodeRtc4513,
  encodeRtc4513,
  isStatus,
  opName,
  parseSignature,
  sameCartridge,
} from '../dist/index.js';
import { FakeOperator, isAbort } from './fake-operator.mjs';

const hex = s => Uint8Array.from(s.match(/../g).map(b => parseInt(b, 16)));
const connect = (dev, timeoutMs = 1000) => new Operator(dev, { timeoutMs });

test('command packet matches create_data', () => {
  const want = hex(
    'a8020000800000800000000200000010000000000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000072c569f5'
  );
  const got = buildCommand(0xa8, {
    saveChip: 2,
    romSize: 0x800000,
    saveSize: 0x8000,
    data: [0, 2, 0, 0, 0, 0x10, 0, 0],
  });
  assert.deepEqual(got, want);
  assert.deepEqual(
    buildCommand(0xa8, {
      saveChip: 2,
      romSize: 0x800000,
      saveSize: 0x8000,
      data: Uint8Array.from([0, 2, 0, 0, 0, 0x10, 0, 0]),
    }),
    want
  );
});

test('led block matches create_led_settings', () => {
  const want = hex('b80000013238000000002a18010000003b0c000000017d05013032221e07dc05');
  const got = buildLed(0xb8, {
    primary: [255, 128, 0],
    secondary: [0, 64, 255],
    colorEffect: Effect.SINE,
    colorDuty: 50,
    lightEffect: Effect.TRIANGLE,
    lightDuty: 30,
    offset: 7,
    periodMs: 1500,
  });
  assert.deepEqual(got, want);
});

test('crc32 chained', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const p = Uint8Array.from({ length: 2048 }, (_, i) => i & 0xff);
  assert.equal(crc32(p), 0x9f5edd58);
  assert.equal(crc32(p.subarray(1000), crc32(p.subarray(0, 1000))), 0x9f5edd58);
});

test('signature parsing and cartridge comparison', () => {
  const raw = new Uint8Array(512);
  raw.set([0, 0, 0x31, 1, 1, 23, 17, 0x31]);
  let c = parseSignature(raw);
  assert.equal(c.platform, Platform.GBA);
  assert.ok(c.flashcart && !c.counterfeit);
  assert.equal(c.romSize, 8 << 20);
  assert.equal(c.saveSize, 128 << 10);
  assert.equal(c.saveChip, 3);
  const before = c;
  raw[2] = 0x20;
  raw[5] = 21;
  raw[0x0a] = (20 << 2) | 1;
  raw[7] = 0x40;
  c = parseSignature(raw);
  assert.equal(c.romSize, 2 << 20);
  assert.equal(c.saveChip, 0x40);
  assert.ok(sameCartridge(c, parseSignature(raw)));
  assert.ok(!sameCartridge(c, before));
  raw[2] = 0x90;
  assert.equal(parseSignature(raw).platform, Platform.UNKNOWN);
  raw[6] = 16;
  raw[7] = 0x24;
  assert.equal(parseSignature(raw).saveSize, 98304);
  raw.set([0, 0, 0x10, 0], 0x14);
  assert.equal(parseSignature(raw).romSize, 2 << 20);
  raw[5] = 31;
  raw[0x0a] = (29 << 2) | 1;
  assert.equal(parseSignature(raw).romSize, 2 ** 31);
});

test('rtc4513 decode', () => {
  const running = decodeRtc4513(hex('0207030000080109010101060204030f04'));
  assert.deepEqual(running, {
    year: 26,
    month: 11,
    day: 19,
    weekday: 4,
    hour: 18,
    minute: 0,
    second: 37,
    hour12: false,
    stopped: false,
    calendar: true,
    lostPower: false,
    valid: true,
  });
  const neverSet = decodeRtc4513(hex('0202020f0700000300010c0f0e00010f06'));
  assert.equal(neverSet.valid, false);
  assert.equal(neverSet.stopped, true);
  assert.equal(neverSet.calendar, false);
  const elevenPm = decodeRtc4513(hex('0205050905010509010101060204030f00'));
  assert.equal(elevenPm.hour12, true);
  assert.equal(elevenPm.hour, 23);
  const lost = decodeRtc4513([2, 0, 8, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 3, 15, 4]);
  assert.equal(lost.lostPower, true);
  assert.equal(lost.second, 0);
});

test('rtc4513 encode', () => {
  const time = { year: 26, month: 11, day: 19, weekday: 4, hour: 18, minute: 0, second: 37 };
  assert.deepEqual(encodeRtc4513(time), hex('07030000080109010101060204020f04'));
  assert.deepEqual([...encodeRtc4513({ ...time, hour: 0, hour12: true })].slice(4, 6), [2, 1]);
  assert.deepEqual([...encodeRtc4513({ ...time, hour: 12, hour12: true })].slice(4, 6), [2, 5]);
  assert.deepEqual([...encodeRtc4513({ ...time, hour: 13, hour12: true })].slice(4, 6), [1, 4]);
  assert.equal(encodeRtc4513({ ...time, hour12: true })[15], 0x00);
  assert.equal(encodeRtc4513({ ...time, stopped: true })[15], 0x06);
  for (const hour12 of [false, true]) {
    for (let hour = 0; hour < 24; hour++) {
      const back = decodeRtc4513([2, ...encodeRtc4513({ ...time, hour, hour12 })]);
      assert.equal(back.hour, hour);
      assert.equal(back.hour12, hour12);
      assert.equal(back.valid, true);
    }
  }
  const again = decodeRtc4513([2, ...encodeRtc4513(decodeRtc4513([2, ...encodeRtc4513(time)]))]);
  assert.equal(again.second, 37);
});

test('rtc4513 rejects bad arguments', () => {
  const time = { year: 26, month: 11, day: 19, weekday: 4, hour: 18, minute: 0, second: 37 };
  for (const bad of [
    { month: 13 },
    { day: 0 },
    { hour: 24 },
    { year: 2026 },
    { weekday: 7 },
    { second: 1.5 },
  ]) {
    assert.throws(
      () => encodeRtc4513({ ...time, ...bad }),
      e => e.code === HostError.ARGUMENT
    );
  }
  assert.throws(
    () => decodeRtc4513(new Uint8Array(64)),
    e => e.code === HostError.ARGUMENT
  );
  assert.throws(
    () => decodeRtc4513([1, ...new Uint8Array(16)]),
    e => e.code === HostError.ARGUMENT
  );
  assert.throws(
    () => decodeRtc4513([2, 0, 0]),
    e => e.code === HostError.ARGUMENT
  );
});

test('camera defaults match firmware', () => {
  const d = cameraDefaults();
  const m = d.matrix;
  assert.equal(m.length, 48);
  assert.equal(m[0], 0x82);
  assert.ok(m.every(v => v >= 0x82 && v < 0x82 + 3 * 0x12));
  assert.equal(cameraMatrix(80, 30)[0], 30);
  assert.equal(d.exposure, 0x1000);
  assert.equal(d.vref, 3);
  assert.equal(d.zeroCalibration, true);
});

test('opName known and unknown', () => {
  assert.equal(opName(Op.SAVE_WRITE), 'SAVE_WRITE');
  assert.equal(opName(0xa3), '0xa3');
});

test('basic transactions', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  await op.ping(0x12);
  const info = await op.info();
  assert.equal(info.serial, 'SIMULATED0001');
  assert.deepEqual(info.appVersion, [10, 1, 0]);
  const { has } = info;
  assert.ok(has(Op.ROM_READ) && !has(Op.LED_SET) && !has(0x10));

  let cart = await op.cartStatus();
  assert.equal(cart.platform, Platform.GB);
  assert.equal(cart.romSize, 65536);

  const progress = [];
  const part = await op.readRom(cart, {
    offset: 4096,
    length: 8192,
    onProgress: d => void progress.push(d),
  });
  assert.deepEqual(part, dev.rom.slice(4096, 4096 + 8192));
  assert.equal(progress.at(-1), 8192);
  assert.equal(await op.romCrc32(cart), crc32(dev.rom));
  await assert.rejects(
    op.readRom(cart, { offset: 100, length: 512 }),
    e => e.code === HostError.ARGUMENT
  );
  await assert.rejects(op.readRom(undefined), e => e.code === HostError.ARGUMENT);
  await assert.rejects(op.readRom(cart, { offset: 65536, length: 512 }), e =>
    isStatus(e, Status.BAD_ARGUMENT)
  );

  assert.deepEqual(await op.readSave(cart), dev.save);

  const data = Uint8Array.from({ length: 8192 }, (_, i) => (i * 3) & 0xff);
  await assert.rejects(
    op.writeSave(cart, data),
    e => isStatus(e, Status.NO_SESSION) && e.op === Op.SAVE_WRITE
  );
  await assert.rejects(op.writeSave(cart, new Uint8Array(0)), e => e.code === HostError.ARGUMENT);
  cart = await op.sessionBegin();
  await op.writeSave(cart, data);
  assert.equal(await op.saveCrc32(cart), crc32(data));
  data[0] = 0xee;
  await assert.rejects(
    op.writeSave(cart, data),
    e => e instanceof OpsdkError && e.code === HostError.DEVICE && e.deviceError === 0x48
  );
  await op.sessionEnd();
  await assert.rejects(op.sessionEnd(), e => isStatus(e, Status.NO_SESSION));
  await assert.rejects(op.setLed({ primary: [1, 2, 3] }), e => isStatus(e, Status.UNKNOWN_COMMAND));
  await op.releaseLed();
  await op.close();
  await op.close();
  await assert.rejects(op.ping(), e => e.code === HostError.IO);
});

test('range defaults and marker-like data', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  assert.deepEqual(await op.readRom(cart, { offset: 0, length: 4096 }), dev.rom.slice(0, 4096));
  assert.deepEqual(await op.readRom(cart, { offset: 61440 }), dev.rom.slice(61440));
  assert.equal(await op.romCrc32(cart, { offset: 61440 }), crc32(dev.rom.slice(61440)));
  assert.deepEqual(await op.readSave(cart, { offset: 4096 }), dev.save.slice(4096));
  assert.equal(await op.saveCrc32(cart, { offset: 4096 }), crc32(dev.save.slice(4096)));
  await assert.rejects(op.readRom(cart, { offset: 65536 }), e => e.code === HostError.ARGUMENT);
  await op.close();
});

test('save smaller than a packet', async () => {
  const dev = new FakeOperator({ saveSize: 32 });
  const op = connect(dev);
  const cart = await op.cartStatus();
  assert.equal(cart.saveSize, 32);
  assert.deepEqual(await op.readSave(cart), dev.save);
  assert.equal(await op.saveCrc32(cart), crc32(dev.save));
  await op.close();
});

test('cartridge error status surfaces', async () => {
  const op = connect(new FakeOperator({ rtcStatus: Status.CART_ERROR }));
  await assert.rejects(
    op.readRtc(await op.cartStatus()),
    e => isStatus(e, Status.CART_ERROR) && /did not complete/.test(e.message)
  );
  await op.close();
  const none = connect(new FakeOperator({ rtcStatus: Status.UNSUPPORTED }));
  await assert.rejects(none.readRtc(await none.cartStatus()), e => isStatus(e, Status.UNSUPPORTED));
  await none.close();
});

test('empty cartridge slot', async () => {
  const op = connect(new FakeOperator({ platform: 0 }));
  const cart = await op.cartStatus();
  assert.equal(cart.platform, Platform.EMPTY);
  await assert.rejects(op.sessionBegin(), e => isStatus(e, Status.NO_CARTRIDGE));
  await op.close();
});

test('session ends when cartridge removed', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.sessionBegin();
  assert.deepEqual(dev.commands, [0xa4, 0xa2]);
  dev.platform = 0;
  assert.equal((await op.cartStatus()).platform, Platform.EMPTY);
  await assert.rejects(op.writeSave(cart, new Uint8Array(8192)), e =>
    isStatus(e, Status.NO_SESSION)
  );
  await op.close();
});

test('sessionBegin holds the queue', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  await Promise.all([op.sessionBegin(), op.writeSave(cart, new Uint8Array(8192))]);
  assert.deepEqual(dev.commands, [0xa2, 0xa4, 0xa2, 0xb2]);
  await op.close();
});

test('sessionBegin with cartridge pulled', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  dev.pulledAfterBegin = true;
  await assert.rejects(op.sessionBegin(), e => isStatus(e, Status.NO_CARTRIDGE));
  assert.equal(dev.session, false);
  await assert.rejects(op.sessionEnd(), e => isStatus(e, Status.NO_SESSION));
  await op.close();
});

test('sessionBegin cleans up on failure', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  dev.statusFails = true;
  await assert.rejects(op.sessionBegin(), e => isStatus(e, Status.ABORTED));
  assert.deepEqual(dev.commands, [0xa4, 0xa2, 0xa5]);
  assert.equal(dev.session, false);
  await op.close();
});

test('sessionBegin with session expired', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  dev.expiresAfterBegin = true;
  await assert.rejects(op.sessionBegin(), e => isStatus(e, Status.NO_SESSION));
  assert.equal((await op.cartStatus()).platform, Platform.GB);
  await op.close();
});

test('firmware without sdk', async () => {
  const op = connect(new FakeOperator({ sdk: false }));
  await assert.rejects(op.ping(), e => isStatus(e, Status.UNKNOWN_COMMAND));
  await assert.rejects(op.info(), e => isStatus(e, Status.UNKNOWN_COMMAND));
  await op.close();
});

test('calls run in order', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  const results = await Promise.all([
    op.readRom(cart, { length: 4096 }),
    op.ping(),
    op.romCrc32(cart, { length: 4096 }),
  ]);
  assert.deepEqual(results[0], dev.rom.slice(0, 4096));
  assert.equal(results[2], crc32(dev.rom.subarray(0, 4096)));
  assert.deepEqual(dev.commands, [0xa2, 0xa8, 0xa0, 0xa9]);
  await op.close();
});

test('aborted signal sends nothing', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(op.readRom(cart, { signal: ac.signal }), e => isStatus(e, Status.ABORTED));
  assert.deepEqual(dev.commands, [0xa2]);
  await op.close();
});

test('abort during read', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  const ac = new AbortController();
  await assert.rejects(
    op.readRom(cart, { signal: ac.signal, onProgress: done => void (done >= 4096 && ac.abort()) }),
    e => isStatus(e, Status.ABORTED)
  );
  assert.equal(dev.aborts, 1);
  assert.equal(await op.romCrc32(cart), crc32(dev.rom));
  await op.close();
});

test('onProgress returning false cancels', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.cartStatus();
  await assert.rejects(op.readRom(cart, { onProgress: done => done < 2048 }), e =>
    isStatus(e, Status.ABORTED)
  );
  assert.equal(dev.aborts, 1);
  await op.close();
});

test('cancelled save write', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.sessionBegin();
  const original = dev.save.slice();
  const data = new Uint8Array(8192).fill(0x77);
  await assert.rejects(op.writeSave(cart, data, { onProgress: done => done < 1024 }), e =>
    isStatus(e, Status.ABORTED)
  );
  assert.equal(dev.save[0], 0x77);
  assert.equal(dev.save[8191], original[8191]);
  assert.deepEqual(dev.commands, [0xa4, 0xa2, 0xb2]);
  await op.close();
});

test('stale reply, read re-sent once', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  dev.stalePackets = 2;
  const cart = await op.cartStatus();
  assert.equal(cart.platform, Platform.GB);
  assert.deepEqual(dev.commands, [0xa2, 0xa2]);
  assert.equal(dev.aborts, 1);
  await op.close();
});

test('stale reply, write not re-sent', async () => {
  const dev = new FakeOperator();
  const op = connect(dev);
  const cart = await op.sessionBegin();
  dev.stalePackets = 1;
  await assert.rejects(
    op.writeSave(cart, new Uint8Array(8192)),
    e => e.code === HostError.PROTOCOL && /not re-sent/.test(e.message)
  );
  assert.deepEqual(dev.commands, [0xa4, 0xa2, 0xb2]);
  assert.equal(dev.aborts, 1);
  assert.equal(await op.saveCrc32(cart), crc32(dev.save));
  await op.close();
});

class FakeSerialPort {
  constructor(dev, failAt = 0) {
    this.dev = dev;
    this.failAt = failAt;
    this.chunks = 0;
    this.readable = null;
    this.writable = null;
    this.opened = null;
  }

  async open(options) {
    this.opened = options;
    this.readable = this.makeReadable();
    this.writable = new WritableStream({ write: c => this.dev.write(c) });
  }

  makeReadable() {
    return new ReadableStream({
      pull: async ctl => {
        const chunk = await this.dev.read();
        if (++this.chunks === this.failAt) {
          this.readable = this.makeReadable();
          ctl.error(Object.assign(new Error('Buffer overrun'), { name: 'BufferOverrunError' }));
          return;
        }
        if (chunk) ctl.enqueue(chunk);
        else ctl.close();
      },
    });
  }

  async close() {}
}

test('web serial buffer overrun', async () => {
  const dev = new FakeOperator();
  const port = new FakeSerialPort(dev, 6);
  const op = await Operator.openPort(port, { timeoutMs: 1000 });
  assert.equal(port.opened.bufferSize, 1 << 20);
  assert.ok(op.transport instanceof WebSerialTransport);
  const cart = await op.cartStatus();
  await assert.rejects(op.readRom(cart, { offset: 0, length: 16384 }), e => e.lost === true);
  assert.equal(await op.romCrc32(cart), crc32(dev.rom));
  assert.deepEqual(
    await op.readRom(cart, { offset: 4096, length: 4096 }),
    dev.rom.slice(4096, 8192)
  );
  await op.close();
});

class FakeUsbDevice {
  constructor(dev, { vendorInterface = true } = {}) {
    this.dev = dev;
    this.configuration = null;
    this.vendorInterface = vendorInterface;
    this.claimed = null;
    this.isOpen = false;
  }
  async open() {
    this.isOpen = true;
  }
  async close() {
    this.isOpen = false;
    this.dev.close();
  }
  async selectConfiguration() {
    const cdc = { interfaceNumber: 0, alternates: [{ interfaceClass: 0x02, endpoints: [] }] };
    const vendor = {
      interfaceNumber: 2,
      alternates: [
        {
          interfaceClass: 0xff,
          endpoints: [
            { endpointNumber: 3, direction: 'in' },
            { endpointNumber: 3, direction: 'out' },
          ],
        },
      ],
    };
    this.configuration = { interfaces: this.vendorInterface ? [cdc, vendor] : [cdc] };
  }
  async claimInterface(n) {
    this.claimed = n;
  }
  async releaseInterface() {
    this.claimed = null;
  }
  async transferIn() {
    const chunk = await this.dev.read();
    if (!chunk) throw new Error('device closed');
    return { status: 'ok', data: new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength) };
  }
  async transferOut(_ep, data) {
    await this.dev.write(data);
    return { status: 'ok', bytesWritten: data.length };
  }
  async clearHalt() {}
}

test('webusb claims vendor interface', async () => {
  const dev = new FakeOperator();
  const usb = new FakeUsbDevice(dev);
  const op = await Operator.requestUsbDevice({
    usb: { requestDevice: async () => usb },
    filters: [],
  });
  assert.ok(op.transport instanceof WebUSBTransport);
  assert.equal(usb.claimed, 2);
  const cart = await op.cartStatus();
  assert.deepEqual(await op.readRom(cart, { length: 8192 }), dev.rom.slice(0, 8192));
  await op.close();
  assert.equal(usb.claimed, null);
  assert.ok(!usb.isOpen);
});

test('webusb without vendor interface', async () => {
  const usb = new FakeUsbDevice(new FakeOperator(), { vendorInterface: false });
  await assert.rejects(Operator.openUsbDevice(usb), e => e.code === HostError.UNAVAILABLE);
  assert.ok(!usb.isOpen);
});

test('web apis unavailable', async () => {
  await assert.rejects(
    Operator.requestPort({ serial: undefined }),
    e => e.code === HostError.UNAVAILABLE
  );
  await assert.rejects(
    Operator.requestUsbDevice({ usb: undefined }),
    e => e.code === HostError.UNAVAILABLE
  );
});

test('abort packet encoding', async () => {
  const sent = [];
  const op = new Operator({
    read: () => new Promise(() => {}),
    write: async d => void sent.push(d),
  });
  await op.abort();
  assert.ok(isAbort(sent[0]) && sent[0].length === 64);
  await op.close();
});
