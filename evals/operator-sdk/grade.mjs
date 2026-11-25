import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Op, Operator, Platform } from '@epilogue/opsdk';
import { FakeOperator } from '../../test/fake-operator.mjs';

const { identify, backup, restore } = await import(
  pathToFileURL(resolve(process.env.OPSDK_CANDIDATE))
);

function fixture(t, options) {
  const fake = new FakeOperator(options);
  const op = new Operator(fake, { timeoutMs: 500 });
  const saved = [];
  const original = fake.save.slice();
  const replacement = original.map(byte => byte ^ 255);
  const controller = new AbortController();
  const persist = async bytes => {
    assert.deepEqual(bytes, original);
    saved.push(bytes.slice());
  };
  const confirm = async () => {
    assert.equal(saved.length, 1);
    return true;
  };
  const write = (ask = confirm, store = persist) =>
    restore(op, replacement, store, ask, controller.signal);
  const writes = () => fake.commands.filter(opcode => opcode === Op.SAVE_WRITE).length;
  t.after(async () => {
    try {
      assert.equal(fake.closed, false, 'caller owns connection');
      assert.equal(fake.session, false, 'session leaked');
    } finally {
      await op.close();
    }
  });
  return { fake, op, saved, original, replacement, controller, persist, confirm, write, writes };
}

test('identify returns a readable signature', async t => {
  const { op } = fixture(t);
  assert.deepEqual(await identify(op), await op.cartStatus());
});

test('identify checks header even when SN platform is present', async t => {
  const { op, fake } = fixture(t, { platform: Platform.SNES });
  const send = fake.send.bind(fake);
  fake.send = bytes => {
    if (bytes[2] === Platform.SNES && bytes[0] === 0) bytes[3] = 0;
    send(bytes);
  };
  assert.equal(await identify(op), null);
});

test('identify propagates a device error', async t => {
  const { op, fake } = fixture(t);
  fake.statusFails = true;
  await assert.rejects(() => identify(op));
});

for (const size of [8192, 128]) {
  test('backup verifies ' + size + ' bytes', async t => {
    const { op, fake, saved, persist } = fixture(t, { saveSize: size });
    await backup(op, persist);
    assert.equal(saved.length, 1);
    if (size < 512) assert.ok(fake.commands.filter(cmd => cmd === Op.SAVE_READ).length >= 2);
    else assert.ok(fake.commands.includes(Op.SAVE_CRC32));
  });
}

test('backup rejects a damaged read before storing', async t => {
  const { op } = fixture(t);
  const read = op.readSave.bind(op);
  op.readSave = async (...args) => {
    const bytes = await read(...args);
    bytes[0] ^= 1;
    return bytes;
  };
  let stored = false;
  await assert.rejects(() =>
    backup(op, async () => {
      stored = true;
    })
  );
  assert.equal(stored, false);
});

test('a readable cartridge with no save produces no backup file', async t => {
  const { op, saved, persist } = fixture(t, { saveSize: 0 });
  assert.equal((await op.cartStatus()).saveSize, 0);
  await assert.rejects(() => backup(op, persist));
  assert.equal(saved.length, 0);
});

test('backup detects removal after the checksum', async t => {
  const { op, fake, saved, persist } = fixture(t);
  const checksum = op.saveCrc32.bind(op);
  op.saveCrc32 = async (...args) => {
    const value = await checksum(...args);
    fake.platform = 0;
    return value;
  };
  await assert.rejects(() => backup(op, persist));
  assert.equal(saved.length, 0);
});

test('restore keeps a recovery copy and writes once', async t => {
  const { write, writes, saved, replacement, fake } = fixture(t);
  assert.equal(await write(), true);
  assert.equal(saved.length, 1);
  assert.equal(writes(), 1);
  assert.deepEqual(fake.save, replacement);
});

test('declining leaves the save intact', async t => {
  const { write, writes, saved, fake, original } = fixture(t);
  assert.equal(await write(async () => false), false);
  assert.equal(saved.length, 1);
  assert.equal(writes(), 0);
  assert.deepEqual(fake.save, original);
});

test('a recovery file failure stops the restore', async t => {
  const { write, writes } = fixture(t);
  let asked = false;
  await assert.rejects(() =>
    write(
      async () => {
        asked = true;
        return true;
      },
      async () => {
        throw new Error('disk full');
      }
    )
  );
  assert.equal(asked, false);
  assert.equal(writes(), 0);
});

test('restore rejects damaged recovery bytes before storage or confirmation', async t => {
  const { op, write, writes } = fixture(t);
  const read = op.readSave.bind(op);
  op.readSave = async (...args) => {
    const bytes = await read(...args);
    bytes[0] ^= 1;
    return bytes;
  };
  const calls = [];
  await assert.rejects(() =>
    write(
      async () => {
        calls.push('confirm');
        return true;
      },
      async () => calls.push('persist')
    )
  );
  assert.deepEqual(calls, []);
  assert.equal(writes(), 0);
});

test('rejects a whole-block replacement of the wrong length', async t => {
  const { op, replacement, persist, confirm, controller, writes } = fixture(t);
  await assert.rejects(() =>
    restore(op, replacement.slice(512), persist, confirm, controller.signal)
  );
  assert.equal(writes(), 0);
});

test('rejects removal during session begin', async t => {
  const { fake, write, writes } = fixture(t);
  fake.pulledAfterBegin = true;
  await assert.rejects(write);
  assert.equal(writes(), 0);
});

test('rejects a different save on an identical cartridge signature', async t => {
  const { confirm, write, writes, fake } = fixture(t);
  await assert.rejects(() =>
    write(async () => {
      fake.save[0] ^= 1;
      return confirm();
    })
  );
  assert.equal(writes(), 0);
});

test('respects cancellation during session begin', async t => {
  const { op, controller, write, writes } = fixture(t);
  const begin = op.sessionBegin.bind(op);
  op.sessionBegin = async () => {
    const cart = await begin();
    controller.abort();
    return cart;
  };
  await assert.rejects(write);
  assert.equal(writes(), 0);
});

for (const change of ['cancel', 'swap']) {
  test(change + ' during the in-session save comparison stops the write', async t => {
    const { op, fake, write, writes, controller } = fixture(t);
    const read = op.readSave.bind(op);
    op.readSave = async (...args) => {
      const bytes = await read(...args);
      if (fake.session) {
        if (change === 'cancel') controller.abort();
        else fake.platform = Platform.SNES;
      }
      return bytes;
    };
    await assert.rejects(write);
    assert.equal(writes(), 0);
  });
}

test('removal after readback prevents reporting success', async t => {
  const { op, fake, write, writes } = fixture(t);
  const read = op.readSave.bind(op);
  op.readSave = async (...args) => {
    const bytes = await read(...args);
    if (writes() === 1) fake.platform = 0;
    return bytes;
  };
  await assert.rejects(write);
  assert.equal(writes(), 1);
});

test('a successful write with damaged readback fails verification', async t => {
  const { op, fake, write, writes } = fixture(t);
  const transfer = op.writeSave.bind(op);
  op.writeSave = async (...args) => {
    await transfer(...args);
    fake.save[0] ^= 1;
  };
  await assert.rejects(write);
  assert.equal(writes(), 1);
});

for (const failWrite of [true, false]) {
  test(
    failWrite ? 'preserves write failure when end also fails' : 'reports an isolated end failure',
    async t => {
      const { op, write, writes } = fixture(t);
      const transfer = op.writeSave.bind(op);
      const end = op.sessionEnd.bind(op);
      op.writeSave = async (...args) => {
        await transfer(...args);
        if (failWrite) throw new Error('injected write failure');
      };
      op.sessionEnd = async () => {
        await end();
        throw new Error('injected end failure');
      };
      await assert.rejects(write, failWrite ? /injected write failure/ : /injected end failure/);
      assert.equal(writes(), 1);
    }
  );
}
