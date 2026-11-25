import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { Operator, OpsdkError, crc32 } from '../dist/index.js';
import { runCall } from './conformance-calls.mjs';

const file = new URL('../conformance/transcripts.txt', import.meta.url);

function parse(text) {
  const scenarios = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [word, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (word === 'scenario') scenarios.push((current = { name: value, items: [] }));
    else if (word === 'end') current = null;
    else current.items.push({ word, value });
  }
  return scenarios;
}

class ReplayTransport {
  constructor(items) {
    this.items = items;
    this.cursor = 0;
    this.queue = [];
    this.waiters = [];
    this.mismatch = null;
  }
  read() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise(r => this.waiters.push(r));
  }
  async write(data) {
    const item = this.items[this.cursor];
    const got = Buffer.from(data).toString('hex');
    if (item?.word !== '>' || item.value !== got) {
      this.mismatch ??= `expected ${item ? `${item.word} ${item.value.slice(0, 40)}` : 'nothing'}, host sent ${got.slice(0, 40)}...`;
      throw new Error('conformance: unexpected host bytes');
    }
    this.cursor++;
    while (this.items[this.cursor]?.word === '<') {
      const bytes = Uint8Array.from(Buffer.from(this.items[this.cursor++].value, 'hex'));
      const w = this.waiters.shift();
      if (w) w(bytes);
      else this.queue.push(bytes);
    }
  }
  close() {
    for (const w of this.waiters.splice(0)) w(null);
  }
}

for (const scenario of parse(fs.readFileSync(file, 'utf8'))) {
  test(`conformance ${scenario.name}`, async () => {
    const t = new ReplayTransport(scenario.items);
    const op = new Operator(t, { timeoutMs: 500 });
    while (t.cursor < scenario.items.length) {
      const item = scenario.items[t.cursor++];
      assert.equal(item.word, 'call', `item ${t.cursor}: ${item.word}`);
      const result = await runCall(op, item.value, { OpsdkError, crc32 });
      assert.equal(t.mismatch, null, `${item.value}: ${t.mismatch}`);
      const expect = scenario.items[t.cursor++];
      assert.equal(expect?.word, 'expect', `${item.value}: host stopped before the recorded bytes`);
      assert.equal(result, expect.value, item.value);
    }
    await op.close();
  });
}
