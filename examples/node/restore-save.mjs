#!/usr/bin/env node
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';

import { HostError, Op, OpsdkError, Status, crc32, isStatus, sameCartridge } from '@epilogue/opsdk';
import { openNodeSerial } from '@epilogue/opsdk/node';

const [input, backupPath, path] = process.argv.slice(2);
if (!input || !backupPath) {
  console.error('usage: restore-save.mjs INPUT.sav BACKUP.sav [PORT]');
  process.exit(2);
}
const data = new Uint8Array(await fs.readFile(input));

const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const op = await openNodeSerial(path ? { path } : {});
let session = false;
try {
  const info = await op.info();
  if (!info.has(Op.SAVE_WRITE)) throw new Error('This firmware cannot write saves.');

  const cart = await op.cartStatus();
  if (!cart.logoValid)
    throw new Error('No readable cartridge. Insert one, or clean and reseat it.');
  if (cart.flashcart || cart.counterfeit) throw new Error('Writes are refused on this cartridge.');
  if (data.length !== cart.saveSize)
    throw new Error(
      `${input} is ${data.length} B but this cartridge's save is ${cart.saveSize} B.`
    );
  const unchanged = now => now.logoValid && sameCartridge(cart, now);

  const current = await op.readSave(cart);
  if (crc32(current) !== (await op.saveCrc32(cart)) || !unchanged(await op.cartStatus()))
    throw new Error('The backup read did not verify, nothing written.');
  await fs.writeFile(backupPath, current, { flag: 'wx' });
  console.log(`Backed up the current save to ${backupPath}.`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Replace the save on the cartridge with ${input}? Type "yes": `);
  rl.close();
  if (answer.trim() !== 'yes') throw new Error('Not confirmed, nothing written.');

  const held = await op.sessionBegin();
  session = true;
  if (!unchanged(held)) throw new Error('The cartridge changed, nothing written.');
  if (!equal(await op.readSave(held), current))
    throw new Error(`The save no longer matches ${backupPath}, nothing written.`);
  if (!unchanged(await op.cartStatus())) throw new Error('The cartridge changed, nothing written.');

  try {
    await op.writeSave(held, data, {
      onProgress: (done, total) => void process.stdout.write(`\r${done}/${total} B`),
    });
    process.stdout.write('\n');
  } catch (e) {
    console.error(`\nThe write failed (${e.message}). The save may be partly written.`);
    console.error(`Recover by restoring ${backupPath} once the cartridge is reseated.`);
    throw e;
  }
  let verified = false;
  try {
    const written = await op.readSave(held);
    verified = unchanged(await op.cartStatus()) && equal(written, data);
  } catch (e) {
    console.error(e.message);
  }
  if (!verified) {
    throw new Error(
      `Verification failed. The save on the cartridge does not match ${input}. Restore ${backupPath}.`
    );
  }
  console.log('Save written and verified.');
} catch (e) {
  if (isStatus(e, Status.NOT_PERMITTED)) console.error('Writes are refused on this cartridge.');
  else if (e instanceof OpsdkError && e.code === HostError.TIMEOUT)
    console.error('The Operator stopped answering.');
  else console.error(e.message);
  process.exitCode = 1;
} finally {
  if (session) {
    await op.sessionEnd().catch(e => {
      if (!process.exitCode) console.error(`The session did not end cleanly (${e.message}).`);
      process.exitCode = 1;
    });
  }
  await op.close();
}
