#!/usr/bin/env node
import fs from 'node:fs/promises';

import { Platform, Status, crc32, isStatus } from '@epilogue/opsdk';
import { openNodeSerial } from '@epilogue/opsdk/node';

const [output, path] = process.argv.slice(2);
if (!output) {
  console.error('usage: backup-save.mjs OUTPUT.sav [PORT]');
  process.exit(2);
}

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());

async function writeNewFile(file, bytes) {
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.close();
  } catch (e) {
    await handle.close().catch(() => {});
    await fs.unlink(file).catch(() => {});
    throw e;
  }
}

const op = await openNodeSerial(path ? { path } : {});
let session = false;
try {
  const cart = await op.sessionBegin();
  session = true;
  if (cart.platform === Platform.UNKNOWN || cart.saveSize === 0)
    throw new Error('This cartridge has no save to back up.');

  const save = await op.readSave(cart, { signal: controller.signal });
  const deviceCrc = await op.saveCrc32(cart, { signal: controller.signal });
  if (crc32(save) !== deviceCrc)
    throw new Error('The save changed or was corrupted during the read. Try again.');

  await writeNewFile(output, save);
  const crc = deviceCrc.toString(16).padStart(8, '0');
  console.log(`Wrote ${save.length} B to ${output}, CRC-32 ${crc}.`);
} catch (e) {
  if (isStatus(e, Status.ABORTED)) console.error('Cancelled.');
  else if (isStatus(e, Status.NO_CARTRIDGE)) console.error('No cartridge inserted.');
  else console.error(e.message);
  process.exitCode = 1;
} finally {
  if (session) await op.sessionEnd().catch(() => {});
  await op.close();
}
