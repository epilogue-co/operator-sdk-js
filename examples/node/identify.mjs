#!/usr/bin/env node
import { HostError, Op, OpsdkError, Platform, Status, isStatus } from '@epilogue/opsdk';
import { openNodeSerial } from '@epilogue/opsdk/node';

const PLATFORM_NAMES = {
  [Platform.GB]: 'Game Boy / Color',
  [Platform.GBA]: 'Game Boy Advance',
  [Platform.SNES]: 'Super Nintendo',
  [Platform.N64]: 'Nintendo 64',
};

let op;
try {
  op = await openNodeSerial(process.argv[2] ? { path: process.argv[2] } : {});
  const info = await op.info();
  console.log(
    `Operator ${info.serial}, firmware ${info.appVersion.join('.')}, SDK protocol ${info.protocolVersion}`
  );
  console.log(
    `  save writes ${info.has(Op.SAVE_WRITE) ? 'yes' : 'no'}, clock ${info.has(Op.RTC_READ) ? 'yes' : 'no'}, camera ${info.has(Op.CAMERA_START) ? 'yes' : 'no'}`
  );

  const cart = await op.cartStatus();
  if (!cart.logoValid) {
    console.log('No readable cartridge. Insert one, or clean and reseat it.');
  } else {
    console.log(
      `${PLATFORM_NAMES[cart.platform] ?? 'Unknown platform'} cartridge, game ${cart.romSize} B, save ${cart.saveSize} B`
    );
    if (cart.flashcart || cart.counterfeit)
      console.log('  Writes are refused on this cartridge (flashcart or counterfeit).');
  }
} catch (e) {
  if (!(e instanceof OpsdkError)) throw e;
  if (e.code === HostError.NO_DEVICE)
    console.error(
      'No Operator found. Is it plugged in? Pass the port path to skip auto-detection.'
    );
  else if (isStatus(e, Status.UNKNOWN_COMMAND))
    console.error('This firmware has no SDK support. Update the Operator.');
  else if (e.code === HostError.TIMEOUT)
    console.error('The Operator stopped answering. Reconnect it.');
  else console.error(`The Operator reported an error (${e.message}).`);
  process.exitCode = 1;
} finally {
  await op?.close();
}
