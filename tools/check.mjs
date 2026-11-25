#!/usr/bin/env node
import { openNodeSerial } from '../dist/node.js';
import { runChecks } from './checks.mjs';

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--'));

const stall = ms => {
  const end = Date.now() + ms;
  while (Date.now() < end);
};
const op = await openNodeSerial(path ? { path } : {});
console.log(`port ${op.transport.path}`);
const { checks, fails } = await runChecks(
  op,
  (ok, name, detail) =>
    console.log(
      `${ok === null ? '  --  ' : ok ? '  ok  ' : '  FAIL'} ${name.padEnd(28)} ${detail}`
    ),
  { write: args.includes('--write'), stall: args.includes('--stall') ? stall : null }
);
await op.close();
console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
