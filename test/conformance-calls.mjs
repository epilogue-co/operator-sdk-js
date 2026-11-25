import { HostError, Status } from '../dist/index.js';

const STATUS_NAMES = Object.fromEntries(Object.entries(Status).map(([k, v]) => [v, k]));
const HOST_NAMES = Object.fromEntries(Object.entries(HostError).map(([k, v]) => [v, k]));
const h8 = v => (v >>> 0).toString(16).padStart(8, '0');

const cartFields = c =>
  `platform=0x${c.platform.toString(16)} rom_size=${c.romSize} save_size=${c.saveSize}`;

export async function runCall(op, line, { OpsdkError, crc32 }) {
  const [name, ...args] = line.split(' ');
  const n = args.map(a => Number(a));
  try {
    switch (name) {
      case 'ping':
        await op.ping(n[0]);
        return 'ok';
      case 'info': {
        const i = await op.info();
        return `ok serial=${i.serial} protocol=${i.protocolVersion} device_id=${i.deviceId}`;
      }
      case 'cart_status':
        op.cart = await op.cartStatus();
        return `ok ${cartFields(op.cart)}`;
      case 'session_begin':
        op.cart = await op.sessionBegin();
        return `ok ${cartFields(op.cart)}`;
      case 'session_end':
        await op.sessionEnd();
        return 'ok';
      case 'rom_read':
      case 'save_read': {
        const read = name === 'rom_read' ? op.readRom : op.readSave;
        const d = await read.call(op, op.cart, { offset: n[0], length: n[1] });
        return `ok length=${d.length} crc32=${h8(crc32(d))}`;
      }
      case 'rom_crc32':
      case 'save_crc32': {
        const fn = name === 'rom_crc32' ? op.romCrc32 : op.saveCrc32;
        return `ok crc=${h8(await fn.call(op, op.cart, { offset: n[0], length: n[1] }))}`;
      }
      case 'save_write': {
        const data = Uint8Array.from({ length: n[0] }, (_, i) => (i * n[1]) & 0xff);
        if (args[2] !== undefined) data[0] = n[2];
        await op.writeSave(op.cart, data);
        return 'ok';
      }
      case 'led_set':
        await op.setLed({ primary: [n[0], n[1], n[2]] });
        return 'ok';
      case 'led_release':
        await op.releaseLed();
        return 'ok';
      default:
        throw new Error(`unknown conformance call ${name}`);
    }
  } catch (e) {
    if (!(e instanceof OpsdkError)) throw e;
    if (e.status !== null) return `status ${STATUS_NAMES[e.status]}`;
    const extra = e.deviceError
      ? ` device_error=0x${e.deviceError.toString(16).padStart(2, '0')}`
      : '';
    return `error ${HOST_NAMES[e.code]}${extra}`;
  }
}
