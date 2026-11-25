import { Effect, Op, Platform, Status, crc32, decodeRtc4513 } from '../dist/index.js';

const hex8 = v => v.toString(16).toUpperCase().padStart(8, '0');
const hex = b => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const pause = ms => new Promise(r => setTimeout(r, ms));
const attempt = async fn => {
  try {
    return { value: await fn() };
  } catch (e) {
    return { error: e };
  }
};

export async function runChecks(op, report, { write = false, stall = null } = {}) {
  let checks = 0;
  let fails = 0;
  const result = (ok, name, detail = '') => {
    if (ok !== null) {
      checks++;
      if (!ok) fails++;
    }
    report(ok, name, detail);
  };
  const msg = r => r.error?.message ?? '';

  try {
    let r = await attempt(() => op.info());
    const info = r.value;
    result(
      !r.error,
      'GET_INFO',
      info
        ? `app ${info.appVersion.join('.')}, serial ${info.serial}, caps 0x${hex8(info.capabilities)}`
        : msg(r)
    );
    if (!info) return { checks, fails };
    result(!(await attempt(() => op.ping(0x3c))).error, 'PING');

    let cart = await op.cartStatus();
    result(
      !!cart.romSize,
      'CART_STATUS',
      `platform 0x${cart.platform.toString(16)} ROM ${cart.romSize} B save ${cart.saveSize} B`
    );
    if (!cart.romSize) return { checks, fails };

    let t0 = Date.now();
    const rom = await op.readRom(cart);
    let dt = (Date.now() - t0) / 1000;
    const romCrc = crc32(rom);
    result(
      rom.length === cart.romSize,
      'ROM_READ whole',
      `${rom.length} B in ${dt.toFixed(1)} s (${(rom.length / 1024 / dt).toFixed(0)} KB/s), crc32 ${hex8(romCrc)}`
    );
    t0 = Date.now();
    r = await attempt(() => op.romCrc32(cart));
    result(
      r.value === romCrc,
      'ROM_CRC32 whole',
      `${r.value !== undefined ? hex8(r.value) : msg(r)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );

    if (stall) {
      let busy = true;
      const blocker = (async () => {
        while (busy) {
          await pause(250);
          stall(150);
        }
      })();
      t0 = Date.now();
      r = await attempt(() => op.readRom(cart));
      busy = false;
      await blocker;
      result(
        r.value && crc32(r.value) === romCrc,
        'ROM_READ, busy page',
        r.error ? msg(r) : `${((Date.now() - t0) / 1000).toFixed(1)} s with 150 ms stalls`
      );
    }

    const mid = Math.floor(cart.romSize / 2) & ~511;
    const len = cart.romSize >= 65536 ? 16384 : 1024;
    r = await attempt(() => op.readRom(cart, { offset: mid, length: len }));
    result(
      !!r.value && equal(r.value, rom.subarray(mid, mid + len)),
      'ROM_READ range',
      `0x${mid.toString(16)} +${len}`
    );
    r = await attempt(() => op.romCrc32(cart, { offset: mid, length: len }));
    result(
      r.value === crc32(rom.subarray(mid, mid + len)),
      'ROM_CRC32 range',
      r.value !== undefined ? hex8(r.value) : msg(r)
    );
    r = await attempt(() => op.readRom(cart, { offset: cart.romSize, length: 512 }));
    result(r.error?.status === Status.BAD_ARGUMENT, 'ROM_READ past the end', msg(r) || 'accepted');

    r = await attempt(() => op.sessionBegin());
    result(!r.error, 'SESSION_BEGIN', msg(r));
    if (r.error) return { checks, fails };
    cart = r.value;
    let same = true;
    for (let i = 0; i < 20 && same; i++) same = (await op.cartStatus()).typeByte === cart.typeByte;
    r = await attempt(() => op.romCrc32(cart));
    result(
      same && r.value === romCrc,
      'ROM CRC after 20 polls',
      r.value !== undefined ? hex8(r.value) : msg(r)
    );

    if (cart.saveSize > 0) {
      const save = await op.readSave(cart);
      const saveCrc = crc32(save);
      result(
        save.length === cart.saveSize,
        'SAVE_READ',
        `${save.length} B, crc32 ${hex8(saveCrc)}`
      );
      r = await attempt(() => op.saveCrc32(cart));
      result(r.value === saveCrc, 'SAVE_CRC32', r.value !== undefined ? hex8(r.value) : msg(r));
      if (write) {
        const pattern = Uint8Array.from({ length: cart.saveSize }, (_, i) => (i * 13 + 7) & 0xff);
        r = await attempt(() => op.writeSave(cart, pattern));
        let c = await attempt(() => op.saveCrc32(cart));
        result(!r.error && c.value === crc32(pattern), 'SAVE_WRITE pattern', msg(r));
        r = await attempt(() => op.writeSave(cart, save));
        c = await attempt(() => op.saveCrc32(cart));
        result(
          !r.error && c.value === saveCrc,
          'SAVE_WRITE restore',
          c.value !== undefined ? hex8(c.value) : msg(r)
        );
      }
    } else {
      result(null, 'save', 'none');
    }

    if (info.has(Op.RTC_READ)) {
      r = await attempt(() => op.readRtc(cart));
      result(!r.error, 'RTC_READ', r.value ? hex(r.value.subarray(0, 8)) : msg(r));
      if (r.value && cart.platform === Platform.SNES && r.value[0] === 2) {
        const c = decodeRtc4513(r.value);
        const two = v => String(v).padStart(2, '0');
        result(
          c.valid && c.calendar,
          'RTC-4513',
          `${two(c.year)}-${two(c.month)}-${two(c.day)} ${two(c.hour)}:${two(c.minute)}:${two(c.second)}` +
            `${c.hour12 ? ' 12-hour' : ''}${c.stopped ? ' stopped' : ''}` +
            `${c.calendar ? '' : ' calendar off'}${c.lostPower ? ' lost power' : ''}`
        );
      }
    }
    if (info.has(Op.SENSOR_READ)) {
      r = await attempt(() => op.readSensor());
      if (r.error?.status === Status.UNSUPPORTED)
        result(null, 'SENSOR_READ', 'no sensor on this cart');
      else result(!r.error, 'SENSOR_READ', r.value ? JSON.stringify(r.value) : msg(r));
    }
    if (info.has(Op.RUMBLE_SET)) {
      r = await attempt(() => op.setRumble(true));
      if (r.error?.status === Status.UNSUPPORTED)
        result(null, 'RUMBLE_SET', 'no motor on this cart');
      else {
        await pause(500);
        const r2 = await attempt(() => op.setRumble(false));
        result(!r.error && !r2.error, 'RUMBLE_SET on/off', '0.5 s');
      }
    }
    r = await attempt(async () => {
      await op.setLed({
        primary: [0, 128, 255],
        secondary: [255, 0, 128],
        colorEffect: Effect.SINE,
        colorDuty: 50,
      });
      await pause(300);
      await op.releaseLed();
    });
    result(!r.error, 'LED_SET / RELEASE', msg(r));

    r = await attempt(() => op.sessionEnd());
    result(!r.error, 'SESSION_END');
    r = await attempt(() => op.sessionEnd());
    result(r.error?.status === Status.NO_SESSION, 'SESSION_END twice', msg(r) || 'accepted');
  } catch (e) {
    result(false, 'unexpected', e.message);
  }
  return { checks, fails };
}
