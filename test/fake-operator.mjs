import { crc32 } from '@epilogue/opsdk';

function mpeg2(d, n) {
  let c = 0xffffffff;
  for (let i = 0; i < n; i++) {
    c ^= d[i] << 24;
    for (let b = 0; b < 8; b++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  }
  return c >>> 0;
}

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tick = () => new Promise(r => setTimeout(r, 0));
const ABORT = [...'EPIABORT'].map(c => c.charCodeAt(0));
export const isAbort = d =>
  d.length >= 16 && ABORT.every((c, i) => d[i] === c && d[8 + i] === (c ^ 0xff));

export class FakeOperator {
  constructor({ sdk = true, platform = 0x20, saveSize = 8192, rtcStatus = 0 } = {}) {
    this.sdk = sdk;
    this.platform = platform;
    this.rom = Uint8Array.from({ length: 65536 }, (_, i) => (i * 7 + (i >> 9)) & 0xff);
    // marker lookalikes inside the rom, must come back as plain data
    this.rom.set([0x55, 0xde, 0xc0, 0xde, 0xdb, 0xa1, 0x1a, 0xd5], 1024);
    this.rom.set([0xc0, 0xde, 0x01, 0xa8, 0x57], 2048);
    this.save = Uint8Array.from({ length: saveSize }, (_, i) => (i ^ 0xa5) & 0xff);
    this.rtcStatus = rtcStatus;
    this.session = false;
    this.out = [];
    this.waiters = [];
    this.upload = null;
    this.aborted = false;
    this.commands = [];
    this.aborts = 0;
    this.stalePackets = 0;
    this.pulledAfterBegin = false;
    this.expiresAfterBegin = false;
    this.statusFails = false;
    this.closed = false;
  }

  read() {
    if (this.out.length) return Promise.resolve(this.out.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise(r => this.waiters.push(r));
  }

  async write(data) {
    if (isAbort(data)) {
      this.aborts++;
      this.aborted = true;
      if (this.upload) {
        const u = this.upload;
        this.upload = null;
        u.done({ complete: false, got: u.got });
      }
      return;
    }
    if (this.upload) {
      const u = this.upload;
      u.buf.set(data.subarray(0, Math.min(64, u.size - u.got)), u.got);
      u.got += 64;
      if (u.got >= u.size) {
        this.upload = null;
        u.done({ complete: true, got: u.got });
      }
      return;
    }
    void this.handle(data);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w(null);
  }

  send(bytes) {
    const w = this.waiters.shift();
    if (w) w(bytes);
    else this.out.push(bytes);
  }

  rd(type, op, status = 0, id = 0) {
    const p = new Uint8Array(512);
    p.set([0xc0, 0xde, type, op, ~op & 0xff, status, id]);
    this.send(p);
  }

  async handle(cmd) {
    const op = u32(cmd, 0x3c) === mpeg2(cmd, 0x3c) ? cmd[0] : 0xfe;
    const id = cmd[0x3b];
    this.commands.push(op);
    this.aborted = false;
    for (; this.stalePackets > 0; this.stalePackets--) this.send(new Uint8Array(512).fill(0x42));
    this.rd(0, op);
    if (!this.sdk) return this.rd(1, op);
    const off = u32(cmd, 0x0a);
    const len = u32(cmd, 0x0e);
    const pkt = new Uint8Array(512);
    let status = 0;
    switch (op) {
      case 0xa0:
        pkt[0] = ~cmd[0x0a] & 0xff;
        this.send(pkt);
        break;
      case 0xa1:
        pkt.set([...'OPSD'].map(c => c.charCodeAt(0)));
        pkt[4] = 1;
        pkt.set([1, 2, 3], 0x08);
        pkt.set(
          [...'SIMULATED0001'].map(c => c.charCodeAt(0)),
          0x12
        );
        pkt.set([0x37, 0x03, 0x1e, 0x02], 0x0e);
        pkt[0x22] = 30;
        this.send(pkt);
        break;
      case 0xa4:
        if (this.platform) this.session = true;
        else status = 0x04;
        if (this.pulledAfterBegin) this.platform = 0;
        if (this.expiresAfterBegin) this.session = false;
        break;
      case 0xa2:
        if (!this.platform) this.session = false;
        if (this.statusFails) {
          status = 0x06;
          break;
        }
        if (cmd[0x0a] === 1 && !this.platform) {
          status = 0x04;
          break;
        }
        if (cmd[0x0a] === 1 && !this.session) {
          status = 0x0b;
          break;
        }
        pkt.set([
          0,
          0,
          this.platform,
          this.platform ? 1 : 0,
          this.platform ? 1 : 0,
          this.platform ? 16 : 0,
          this.platform ? Math.log2(this.save.length) : 0,
          0x21,
        ]);
        this.send(pkt);
        break;
      case 0xa5:
        status = this.session ? 0 : 0x0b;
        this.session = false;
        break;
      case 0xa8:
        if (off + len > this.rom.length) {
          status = 0x03;
          break;
        }
        for (let p = off; p < off + len; p += 512) {
          if (this.aborted) {
            status = 0x06;
            break;
          }
          if (p === off + 512 && len > 1024) {
            const u = new Uint8Array(512);
            u.set([0x55, 0xde, 0xc0, 0xde, 0xdb, 0xa1, 0x1a, 0xd5]);
            this.send(u);
          }
          this.send(this.rom.slice(p, p + 512));
          await tick();
        }
        break;
      case 0xa9:
      case 0xb3: {
        const src = op === 0xa9 ? this.rom : this.save;
        const c = crc32(src.subarray(off, off + len));
        pkt.set([c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, c >>> 24]);
        this.send(pkt);
        break;
      }
      case 0xb1:
        for (let p = off; p < off + len; p += 512) {
          const block = new Uint8Array(512);
          block.set(this.save.slice(p, p + 512));
          this.send(block);
        }
        break;
      case 0xb4:
        this.send(pkt);
        status = this.rtcStatus;
        break;
      case 0xb2: {
        if (!this.session) {
          status = 0x0b;
          break;
        }
        this.rd(2, op);
        const size = u32(cmd, 6);
        const buf = new Uint8Array(size);
        const { complete, got } = await new Promise(
          done => (this.upload = { buf, size, got: 0, done })
        );
        if (!complete) {
          this.save.set(buf.subarray(0, Math.min(got, size)));
          status = 0x06;
          break;
        }
        this.save.set(buf);
        if (buf[0] === 0xee) {
          const e = new Uint8Array(64);
          e.set([0x55, 0xaa, 0x48]);
          this.send(e);
        }
        break;
      }
      case 0xb9:
        break;
      default:
        status = 0x01;
    }
    this.rd(1, op, status, id);
  }
}
