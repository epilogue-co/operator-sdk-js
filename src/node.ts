import fs from 'node:fs';
import path from 'node:path';
import tty from 'node:tty';

import { OpsdkError } from './errors.js';
import { Operator } from './operator.js';
import type { OperatorOptions } from './operator.js';
import {
  BAUD_RATE,
  DEFAULT_TIMEOUT_MS,
  HostError,
  PROBE_TIMEOUT_MS,
  Status,
  USB_PRODUCT_IDS,
  USB_VENDOR_ID,
} from './protocol.js';
import type { Transport } from './transport.js';

export type SerialBackend = 'tty' | 'serialport';

const posix = (): boolean => process.platform === 'darwin' || process.platform === 'linux';

// mac and linux get by with node:tty. serialport is optional, windows needs it
export function defaultBackend(): SerialBackend {
  return posix() ? 'tty' : 'serialport';
}

function assertPosix(): void {
  if (!posix()) {
    throw new OpsdkError(
      `the tty backend supports macOS and Linux, not ${process.platform}: use the serialport backend`,
      { code: HostError.UNAVAILABLE }
    );
  }
}

abstract class QueuedTransport {
  private readonly queue: Uint8Array[] = [];
  private readonly waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private ended = false;

  protected push(chunk: Uint8Array): void {
    const w = this.waiters.shift();
    if (w) w(chunk);
    else this.queue.push(chunk);
  }

  protected finish(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w(null);
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.queue.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.ended) return Promise.resolve(null);
    return new Promise(resolve => this.waiters.push(resolve));
  }

  protected send(write: (done: (err?: Error | null) => void) => void): Promise<void> {
    if (this.ended)
      return Promise.reject(new OpsdkError('serial port closed', { code: HostError.IO }));
    return new Promise((resolve, reject) =>
      write(err =>
        err
          ? reject(
              new OpsdkError(`write failed: ${err.message}`, { code: HostError.IO, cause: err })
            )
          : resolve()
      )
    );
  }
}

export class NodeSerialTransport extends QueuedTransport implements Transport {
  readonly path: string;
  private readonly input: tty.ReadStream;
  private readonly output: tty.WriteStream;
  private closed = false;

  constructor(devicePath: string) {
    super();
    assertPosix();
    this.path = devicePath;
    let fd: number;
    try {
      fd = fs.openSync(
        devicePath,
        fs.constants.O_RDWR | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK
      );
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new OpsdkError(`cannot open ${devicePath}: ${(e as Error).message}`, {
        code: code === 'ENOENT' ? HostError.NO_DEVICE : HostError.IO,
        cause: e,
      });
    }
    if (!tty.isatty(fd)) {
      fs.closeSync(fd);
      throw new OpsdkError(`${devicePath} is not a serial port`, { code: HostError.IO });
    }
    this.input = new tty.ReadStream(fd);
    this.input.setRawMode(true);
    this.output = new tty.WriteStream(fd);
    this.input.on('data', (chunk: Buffer) => this.push(new Uint8Array(chunk)));
    this.input.on('end', () => this.finish());
    this.input.on('error', () => this.finish());
    this.output.on('error', () => this.finish());
  }

  write(data: Uint8Array): Promise<void> {
    return this.send(done => this.output.write(data, done));
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.finish();
    this.input.destroy();
    this.output.destroy();
    return Promise.resolve();
  }
}

function readSysfs(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim().toLowerCase();
  } catch {
    return null;
  }
}

const isOperatorUsbId = (vendor: string, product: string): boolean =>
  parseInt(vendor, 16) === USB_VENDOR_ID && USB_PRODUCT_IDS.includes(parseInt(product, 16));

function linuxIsOperator(name: string): boolean {
  const usbDevice = path.join('/sys/class/tty', name, 'device', '..');
  const vendor = readSysfs(path.join(usbDevice, 'idVendor'));
  const product = readSysfs(path.join(usbDevice, 'idProduct'));
  // no usb ids in sysfs, can't rule it out. the ping decides
  if (vendor === null || product === null) return true;
  return isOperatorUsbId(vendor, product);
}

interface PortInfo {
  path: string;
  vendorId?: string;
  productId?: string;
}

interface NodeSerialPort {
  open(cb: (err: Error | null) => void): void;
  on(event: string, listener: (arg?: unknown) => void): unknown;
  write(data: Uint8Array, cb: (err: Error | null | undefined) => void): boolean;
  close(cb: (err: Error | null) => void): void;
  readonly isOpen: boolean;
}

interface SerialPortModule {
  SerialPort: {
    new (options: { path: string; baudRate: number; autoOpen: boolean }): NodeSerialPort;
    list(): Promise<PortInfo[]>;
  };
}

let loaded: Promise<SerialPortModule> | null = null;

async function loadSerialPort(module?: unknown): Promise<SerialPortModule> {
  if (module) return module as SerialPortModule;
  loaded ??= (import('serialport' as string) as Promise<SerialPortModule>).catch((e: unknown) => {
    loaded = null;
    throw new OpsdkError(
      'the serialport backend needs the serialport package: npm install serialport',
      { code: HostError.UNAVAILABLE, cause: e }
    );
  });
  return loaded;
}

// TODO: only exercised against a mocked serialport so far, needs a run on windows
export class SerialPortTransport extends QueuedTransport implements Transport {
  static async open(
    devicePath: string,
    options: { serialport?: unknown } = {}
  ): Promise<SerialPortTransport> {
    const { SerialPort } = await loadSerialPort(options.serialport);
    const port = new SerialPort({ path: devicePath, baudRate: BAUD_RATE, autoOpen: false });
    const transport = new SerialPortTransport(devicePath, port);
    await new Promise<void>((resolve, reject) =>
      port.open(err => {
        if (!err) return resolve();
        const missing = /no such file|not found|cannot find/i.test(err.message);
        reject(
          new OpsdkError(`cannot open ${devicePath}: ${err.message}`, {
            code: missing ? HostError.NO_DEVICE : HostError.IO,
            cause: err,
          })
        );
      })
    );
    return transport;
  }

  private closed = false;

  private constructor(
    readonly path: string,
    private readonly port: NodeSerialPort
  ) {
    super();
    port.on('data', chunk => this.push(new Uint8Array(chunk as Uint8Array)));
    port.on('close', () => this.finish());
    port.on('error', () => this.finish());
  }

  write(data: Uint8Array): Promise<void> {
    return this.send(done => this.port.write(data, done));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.finish();
    if (!this.port.isOpen) return;
    await new Promise<void>(resolve => this.port.close(() => resolve()));
  }
}

const isOperatorId = (vendorId?: string, productId?: string): boolean =>
  !!vendorId && !!productId && isOperatorUsbId(vendorId, productId);

export interface ListPortsOptions {
  backend?: SerialBackend;
  serialport?: unknown;
}

export async function listPorts(options: ListPortsOptions = {}): Promise<string[]> {
  const backend = options.backend ?? defaultBackend();
  if (backend === 'serialport') {
    const { SerialPort } = await loadSerialPort(options.serialport);
    const ports = await SerialPort.list();
    return ports
      .filter(p => isOperatorId(p.vendorId, p.productId))
      .map(p => p.path)
      .sort();
  }
  assertPosix();
  const names = fs.readdirSync('/dev');
  if (process.platform === 'darwin') {
    return names
      .filter(n => n.startsWith('cu.usbmodem'))
      .sort()
      .map(n => `/dev/${n}`);
  }
  return names
    .filter(n => n.startsWith('ttyACM') && linuxIsOperator(n))
    .sort()
    .map(n => `/dev/${n}`);
}

export interface OpenNodeSerialOptions extends OperatorOptions {
  path?: string;
  backend?: SerialBackend;
  serialport?: unknown;
}

async function openTransport(
  devicePath: string,
  backend: SerialBackend,
  serialport: unknown
): Promise<Transport> {
  if (backend === 'serialport') return SerialPortTransport.open(devicePath, { serialport });
  return new NodeSerialTransport(devicePath);
}

export async function openNodeSerial(options: OpenNodeSerialOptions = {}): Promise<Operator> {
  const { path: devicePath, backend = defaultBackend(), serialport, ...operatorOptions } = options;
  if (devicePath) {
    return new Operator(await openTransport(devicePath, backend, serialport), operatorOptions);
  }
  let withoutSdk: OpsdkError | null = null;
  for (const candidate of await listPorts({ backend, serialport })) {
    let op: Operator;
    try {
      op = new Operator(await openTransport(candidate, backend, serialport), {
        ...operatorOptions,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    } catch {
      continue;
    }
    try {
      await op.ping();
      op.timeoutMs = operatorOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return op;
    } catch (e) {
      if (e instanceof OpsdkError && e.status === Status.UNKNOWN_COMMAND) withoutSdk ??= e;
      await op.close();
    }
  }
  if (withoutSdk) {
    throw new OpsdkError('found an Operator, but its firmware has no SDK support: update it', {
      status: Status.UNKNOWN_COMMAND,
      op: withoutSdk.op,
    });
  }
  throw new OpsdkError('no Operator found', { code: HostError.NO_DEVICE });
}
