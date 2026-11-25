import { OpsdkError, ignore } from './errors.js';
import {
  CART_STATUS_REQUIRE_SESSION,
  ABORT_MAGIC,
  ALIGN,
  BAUD_RATE,
  CAMERA_FRAME_SIZE,
  CAM_EDGE_OPERATION,
  CAM_EDGE_RATIO,
  CAM_EXPOSURE,
  CAM_GAIN,
  CAM_INVERT,
  CAM_MATRIX,
  CAM_OUTPUT_REF,
  CAM_VERTICAL_EDGE,
  CAM_VREF,
  CAM_ZERO_CALIBRATION,
  CMD_SIZE,
  DEFAULT_TIMEOUT_MS,
  ERROR_CODE,
  ERROR_MAGIC,
  HostError,
  INFO_APP_VERSION,
  INFO_BOARD,
  INFO_CAPABILITIES,
  INFO_DEVICE_ID,
  INFO_IDLE_TIMEOUT,
  INFO_PROTOCOL,
  INFO_SERIAL,
  INFO_SIZE,
  INFO_SYS_VERSION,
  Op,
  PKT_DONE,
  PKT_PROCEED,
  PKT_READY,
  PKT_SIZE,
  READ_ONLY_OPS,
  REPLY_REQUEST_ID,
  REPLY_STATUS,
  REQUEST_ID_OFFSET,
  RTC_SIZE,
  SENSOR_KIND,
  SENSOR_SIZE,
  SENSOR_X,
  SENSOR_Y,
  SENSOR_Z,
  Status,
  buildCommand,
  buildLed,
  cameraDefaults,
  crc32,
  isDone,
  isReadyDone,
  isUnstable,
  opName,
  parseSignature,
  putU32,
  seal,
  statusText,
  u32,
} from './protocol.js';
import type { CameraSettings, Cartridge, LedSettings } from './protocol.js';
import { ByteStream } from './transport.js';
import type { Transport } from './transport.js';
import { USB_DEVICE_FILTERS, USB_FILTERS, WebSerialTransport, WebUSBTransport } from './web.js';
import type {
  SerialLike,
  SerialPortFilterLike,
  SerialPortLike,
  USBDeviceFilterLike,
  USBDeviceLike,
  USBLike,
} from './web.js';

const READY_TIMEOUT_MS = 3000;
const DONE_WRITE_TIMEOUT_MS = 120000;
const RTC_WRITE_TIMEOUT_MS = 10000;
const CRC_BASE_MS = 5000;
const CRC_MS_PER_KIB = 10;
const STALE_QUIET_MS = 300;

const alignUp = (n: number): number => Math.ceil(n / ALIGN) * ALIGN;

const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');

function requireCart(cart: Cartridge | undefined, op: number): asserts cart is Cartridge {
  if (!cart) {
    throw new OpsdkError('a cartridge is required (cartStatus() or sessionBegin())', {
      code: HostError.ARGUMENT,
      op,
    });
  }
}

export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type ProgressCallback = (done: number, total: number) => boolean | void;

export interface CancelOptions {
  signal?: AbortSignalLike;
}

export interface RangeOptions extends CancelOptions {
  offset?: number;
  length?: number;
}

export interface ReadRomOptions extends RangeOptions {
  onProgress?: ProgressCallback;
}

export interface WriteSaveOptions extends CancelOptions {
  onProgress?: ProgressCallback;
}

export interface TraceEvent {
  kind: 'send' | 'receive' | 'event';
  op: number;
  data?: Uint8Array;
  message?: string;
}

export interface OperatorOptions {
  timeoutMs?: number;
  onTrace?: (event: TraceEvent) => void;
}

export interface DeviceInfo {
  protocolVersion: number;
  deviceId: number;
  boardRevision: number;
  appVersion: [number, number, number];
  sysVersion: [number, number, number];
  capabilities: number;
  serial: string;
  sessionIdleTimeoutS: number;
  has(op: number): boolean;
}

export interface SensorReading {
  kind: number;
  x: number;
  y: number;
  z: number;
}

interface Exchange {
  op: number;
  saveChip?: number;
  romSize?: number;
  saveSize?: number;
  data?: ArrayLike<number> | null;
  raw?: Uint8Array;
  expect?: number;
  upload?: Uint8Array;
  doneTimeoutMs?: number;
  skipWaitMs?: number;
  onProgress?: ProgressCallback | undefined;
  signal?: AbortSignalLike | undefined;
}

interface ExchangeResult {
  data: Uint8Array;
  got: number;
}

export class Operator {
  static async requestPort({
    serial = (globalThis as { navigator?: { serial?: SerialLike } }).navigator?.serial,
    filters = USB_FILTERS,
  }: { serial?: SerialLike; filters?: readonly SerialPortFilterLike[] } = {}): Promise<Operator> {
    if (!serial) {
      throw new OpsdkError(
        'Web Serial is not available (Chromium-based browser, https or localhost)',
        {
          code: HostError.UNAVAILABLE,
        }
      );
    }
    const port = await serial.requestPort({ filters: [...filters] });
    return Operator.openPort(port);
  }

  static async requestUsbDevice({
    usb = (globalThis as { navigator?: { usb?: USBLike } }).navigator?.usb,
    filters = USB_DEVICE_FILTERS,
  }: { usb?: USBLike; filters?: readonly USBDeviceFilterLike[] } = {}): Promise<Operator> {
    if (!usb) {
      throw new OpsdkError('WebUSB is not available (Chromium-based browser, https or localhost)', {
        code: HostError.UNAVAILABLE,
      });
    }
    return Operator.openUsbDevice(await usb.requestDevice({ filters: [...filters] }));
  }

  static async openUsbDevice(device: USBDeviceLike, options?: OperatorOptions): Promise<Operator> {
    return new Operator(await WebUSBTransport.open(device), options);
  }

  static async openPort(port: SerialPortLike, options?: OperatorOptions): Promise<Operator> {
    await port.open({ baudRate: BAUD_RATE, bufferSize: 1 << 20 });
    return new Operator(new WebSerialTransport(port), options);
  }

  readonly transport: Transport;
  timeoutMs: number;
  private readonly stream: ByteStream;
  private requestId = 0;
  private stale = true;
  private busy: Promise<unknown> = Promise.resolve();
  private closed = false;
  private op = 0;
  onTrace: ((event: TraceEvent) => void) | undefined;

  constructor(
    transport: Transport,
    { timeoutMs = DEFAULT_TIMEOUT_MS, onTrace }: OperatorOptions = {}
  ) {
    this.transport = transport;
    this.stream = new ByteStream(transport);
    this.timeoutMs = timeoutMs;
    this.onTrace = onTrace;
  }

  private traceEvent(message: string): void {
    this.onTrace?.({ kind: 'event', op: this.op, message });
  }

  private async send(data: Uint8Array): Promise<void> {
    this.onTrace?.({ kind: 'send', op: this.op, data: data.slice() });
    await this.transport.write(data);
  }

  private async drain(quietMs: number): Promise<void> {
    const n = await this.stream.drain(quietMs);
    if (n) this.traceEvent(`drained ${n} stale bytes`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close?.();
  }

  async abort(): Promise<void> {
    const p = new Uint8Array(CMD_SIZE);
    ABORT_MAGIC.forEach((c, i) => {
      p[i] = c;
      p[8 + i] = c ^ 0xff;
    });
    this.traceEvent('abort sent');
    await this.send(p);
  }

  // one command on the wire at a time. a failed call must not block the rest
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.busy.then(async () => {
      try {
        return await work();
      } finally {
        this.op = 0;
      }
    });
    this.busy = next.catch(ignore);
    return next;
  }

  private run(x: Exchange): Promise<ExchangeResult> {
    return this.queue(() => this.transact(x, false));
  }

  private async readExact(n: number, ms: number): Promise<Uint8Array> {
    try {
      const data = await this.stream.read(n, ms);
      this.onTrace?.({ kind: 'receive', op: this.op, data: data.slice() });
      return data;
    } catch (e) {
      const err = e as OpsdkError;
      if (err.code === HostError.TIMEOUT) {
        this.stale = true;
        this.traceEvent(`timeout: ${this.stream.available} of ${n} bytes`);
      }
      if (err.lost) {
        this.stale = true;
        await this.abort().catch(ignore);
      }
      throw e;
    }
  }

  private async transact(x: Exchange, retried: boolean): Promise<ExchangeResult> {
    if (this.closed) throw new OpsdkError('connection closed', { code: HostError.IO, op: x.op });
    if (x.signal?.aborted) {
      throw new OpsdkError(`${opName(x.op)}: aborted before it started`, {
        status: Status.ABORTED,
        op: x.op,
      });
    }
    this.op = x.op;
    // never 0: firmware without the SDK answers with id 0, see the check at the end
    this.requestId = (this.requestId % 255) + 1;
    const id = this.requestId;
    let cmd: Uint8Array;
    if (x.raw) {
      cmd = new Uint8Array(CMD_SIZE);
      cmd.set(x.raw.subarray(0, 60));
      cmd[0] = x.op;
      cmd[REQUEST_ID_OFFSET] = id;
      seal(cmd);
    } else {
      cmd = buildCommand(x.op, { ...x, requestId: id });
    }

    // anything buffered is from an earlier command. after a timeout the device
    // may still be sending, so wait for quiet
    await this.drain(this.stale ? STALE_QUIET_MS : 0);
    this.stale = false;
    await this.send(cmd);

    let pkt = await this.readExact(PKT_SIZE, READY_TIMEOUT_MS);
    if (!isReadyDone(pkt, PKT_READY, x.op)) {
      this.traceEvent('unexpected packet instead of READY: aborting the previous transfer');
      await this.abort();
      await this.drain(STALE_QUIET_MS);
      // no way to know if the device ran it. safe to repeat a read, never a write
      if (!retried && READ_ONLY_OPS.has(x.op)) {
        this.traceEvent(`re-sending ${opName(x.op)} (read-only)`);
        return this.transact(x, true);
      }
      this.traceEvent(`not re-sending ${opName(x.op)} (it changes state)`);
      this.stale = true;
      throw new OpsdkError(
        READ_ONLY_OPS.has(x.op)
          ? `${opName(x.op)}: expected READY`
          : `${opName(x.op)}: expected READY; the command was not re-sent (verify the device state before retrying)`,
        { code: HostError.PROTOCOL, op: x.op }
      );
    }

    let aborted = false;
    const cancel = (): void => {
      if (aborted) return;
      aborted = true;
      this.abort().catch(ignore);
    };
    x.signal?.addEventListener('abort', cancel, { once: true });
    if (x.signal?.aborted) cancel();
    try {
      let done: Uint8Array | null = null;
      if (x.upload) {
        pkt = await this.readExact(PKT_SIZE, this.timeoutMs);
        if (isReadyDone(pkt, PKT_DONE, x.op)) {
          done = pkt;
        } else {
          if (!isReadyDone(pkt, PKT_PROCEED, x.op)) {
            this.traceEvent('unexpected packet instead of PROCEED');
            this.stale = true;
            throw new OpsdkError(`${opName(x.op)}: expected PROCEED`, {
              code: HostError.PROTOCOL,
              op: x.op,
            });
          }
          const chunk = new Uint8Array(CMD_SIZE);
          for (let sent = 0; sent < x.upload.length && !aborted; sent += CMD_SIZE) {
            chunk.fill(0xff);
            chunk.set(x.upload.subarray(sent, sent + CMD_SIZE));
            await this.send(chunk.slice());
            const n = Math.min(sent + CMD_SIZE, x.upload.length);
            if (x.onProgress?.(n, x.upload.length) === false) cancel();
          }
        }
      }

      const expect = x.expect ?? 0;
      const out = new Uint8Array(expect);
      let got = 0;
      const dataWait =
        x.doneTimeoutMs && expect <= PKT_SIZE
          ? x.doneTimeoutMs
          : this.timeoutMs + (x.skipWaitMs ?? 0);
      while (!done && got < expect) {
        pkt = await this.readExact(PKT_SIZE, dataWait);
        if (isDone(pkt, x.op)) {
          done = pkt;
          break;
        }
        if (isUnstable(pkt)) continue;
        const n = Math.min(expect - got, PKT_SIZE);
        out.set(pkt.subarray(0, n), got);
        got += n;
        if (!aborted && x.onProgress?.(got, expect) === false) cancel();
      }

      let deviceError = 0;
      if (!done) {
        const wait = x.doneTimeoutMs ?? this.timeoutMs;
        // error packets are 64 bytes, not 512: read that much first
        for (;;) {
          const head = await this.readExact(CMD_SIZE, wait);
          if (head[0] === ERROR_MAGIC[0] && head[1] === ERROR_MAGIC[1]) {
            deviceError = head[ERROR_CODE];
            this.traceEvent(`device error packet 0x${hex2(deviceError)}`);
            continue;
          }
          const rest = await this.readExact(PKT_SIZE - CMD_SIZE, this.timeoutMs);
          pkt = new Uint8Array(PKT_SIZE);
          pkt.set(head);
          pkt.set(rest, CMD_SIZE);
          if (isReadyDone(pkt, PKT_DONE, x.op)) {
            done = pkt;
            break;
          }
        }
      }

      const reported = done[REPLY_STATUS];
      let status = reported;
      if (done[REPLY_REQUEST_ID] !== id) {
        if (reported === 0 && done[REPLY_REQUEST_ID] === 0) status = Status.UNKNOWN_COMMAND;
        else if (reported !== Status.UNKNOWN_COMMAND) {
          this.traceEvent('request id mismatch');
          this.stale = true;
          throw new OpsdkError(`${opName(x.op)}: request id mismatch`, {
            code: HostError.PROTOCOL,
            op: x.op,
          });
        }
      }
      this.traceEvent(`DONE status 0x${hex2(reported)}`);
      if (status !== Status.OK) {
        throw new OpsdkError(`${opName(x.op)}: ${statusText(status)}`, {
          status: status as Status,
          deviceError,
          op: x.op,
        });
      }
      if (deviceError) {
        throw new OpsdkError(`${opName(x.op)}: device error 0x${hex2(deviceError)}`, {
          code: HostError.DEVICE,
          deviceError,
          op: x.op,
        });
      }
      return { data: out, got };
    } finally {
      x.signal?.removeEventListener('abort', cancel);
    }
  }

  async ping(challenge = 0x5a): Promise<void> {
    const { got, data } = await this.run({ op: Op.PING, data: [challenge], expect: 1 });
    if (!got) {
      throw new OpsdkError('PING: firmware without the SDK', {
        status: Status.UNKNOWN_COMMAND,
        op: Op.PING,
      });
    }
    if (data[0] !== (~challenge & 0xff)) {
      throw new OpsdkError('PING: wrong reply', { code: HostError.PROTOCOL, op: Op.PING });
    }
  }

  async info(): Promise<DeviceInfo> {
    const { data, got } = await this.run({ op: Op.GET_INFO, expect: PKT_SIZE });
    if (got < INFO_SIZE || String.fromCharCode(...data.subarray(0, 4)) !== 'OPSD') {
      throw new OpsdkError('GET_INFO: firmware without the SDK', {
        status: Status.UNKNOWN_COMMAND,
        op: Op.GET_INFO,
      });
    }
    const serialBytes = data.subarray(INFO_SERIAL, INFO_IDLE_TIMEOUT);
    const end = serialBytes.indexOf(0);
    const capabilities = u32(data, INFO_CAPABILITIES);
    return {
      protocolVersion: data[INFO_PROTOCOL] | (data[INFO_PROTOCOL + 1] << 8),
      deviceId: data[INFO_DEVICE_ID],
      boardRevision: data[INFO_BOARD],
      appVersion: [data[INFO_APP_VERSION], data[INFO_APP_VERSION + 1], data[INFO_APP_VERSION + 2]],
      sysVersion: [data[INFO_SYS_VERSION], data[INFO_SYS_VERSION + 1], data[INFO_SYS_VERSION + 2]],
      capabilities,
      serial: String.fromCharCode(...serialBytes.subarray(0, end < 0 ? 16 : end)),
      sessionIdleTimeoutS: data[INFO_IDLE_TIMEOUT] | (data[INFO_IDLE_TIMEOUT + 1] << 8),
      has: (op: number): boolean =>
        op >= 0xa0 && op <= 0xbf && ((capabilities >>> (op - 0xa0)) & 1) === 1,
    };
  }

  private async signature(inSession = false): Promise<Cartridge> {
    const op = Op.CART_STATUS;
    const data = inSession ? [CART_STATUS_REQUIRE_SESSION] : null;
    const { data: raw, got } = await this.transact({ op, data, expect: PKT_SIZE }, false);
    if (got !== PKT_SIZE) {
      throw new OpsdkError(`${opName(op)}: no signature`, { code: HostError.PROTOCOL, op });
    }
    return parseSignature(raw);
  }

  cartStatus(): Promise<Cartridge> {
    return this.queue(() => this.signature());
  }

  sessionBegin(): Promise<Cartridge> {
    return this.queue(async () => {
      await this.transact({ op: Op.SESSION_BEGIN }, false);
      try {
        return await this.signature(true);
      } catch (e) {
        await this.transact({ op: Op.SESSION_END }, false).catch(ignore);
        throw e;
      }
    });
  }

  async sessionEnd(): Promise<void> {
    await this.run({ op: Op.SESSION_END });
  }

  private async rangeStream(
    op: number,
    cart: Cartridge,
    {
      offset = 0,
      length,
      crc = false,
      onProgress,
      signal,
    }: RangeOptions & { crc?: boolean; onProgress?: ProgressCallback | undefined }
  ): Promise<Uint8Array | number> {
    if (
      !(length !== undefined && length > 0) ||
      offset < 0 ||
      offset % ALIGN ||
      length % ALIGN ||
      offset + length > 0xffffffff
    ) {
      throw new OpsdkError(`offset and length must be multiples of ${ALIGN}, length positive`, {
        code: HostError.ARGUMENT,
        op,
      });
    }
    const args = new Uint8Array(8);
    putU32(args, 0, offset);
    putU32(args, 4, length);
    const { data, got } = await this.run({
      op,
      saveChip: cart.saveChip,
      romSize: cart.romSize,
      saveSize: cart.saveSize,
      data: args,
      expect: crc ? 4 : length,
      // the device reads the whole range before it answers
      ...(crc
        ? { doneTimeoutMs: CRC_BASE_MS + Math.ceil((offset + length) / 1024) * CRC_MS_PER_KIB }
        : {}),
      skipWaitMs: Math.ceil(offset / 1024) * CRC_MS_PER_KIB,
      onProgress,
      signal,
    });
    if (got < (crc ? 4 : length)) {
      throw new OpsdkError(`${opName(op)}: short stream`, { code: HostError.PROTOCOL, op });
    }
    return crc ? u32(data, 0) : data;
  }

  async readRom(cart: Cartridge, options: ReadRomOptions = {}): Promise<Uint8Array> {
    requireCart(cart, Op.ROM_READ);
    const { offset = 0, length = cart.romSize - offset, onProgress, signal } = options;
    const data = await this.rangeStream(Op.ROM_READ, cart, { offset, length, onProgress, signal });
    return data as Uint8Array;
  }

  async romCrc32(cart: Cartridge, options: RangeOptions = {}): Promise<number> {
    requireCart(cart, Op.ROM_CRC32);
    const { offset = 0, length = cart.romSize - offset, signal } = options;
    const crc = await this.rangeStream(Op.ROM_CRC32, cart, { offset, length, crc: true, signal });
    return crc as number;
  }

  async readSave(
    cart: Cartridge,
    { offset = 0, length, signal }: RangeOptions = {}
  ): Promise<Uint8Array> {
    requireCart(cart, Op.SAVE_READ);
    if (length !== undefined) {
      return this.rangeStream(Op.SAVE_READ, cart, {
        offset,
        length,
        signal,
      }) as Promise<Uint8Array>;
    }
    // saves under 512 bytes (MBC7, TAMA5): read a full packet and trim
    const size = cart.saveSize;
    const data = (await this.rangeStream(Op.SAVE_READ, cart, {
      offset,
      length: alignUp(size) - offset,
      signal,
    })) as Uint8Array;
    return data.subarray(0, Math.max(0, size - offset));
  }

  async saveCrc32(
    cart: Cartridge,
    { offset = 0, length, signal }: RangeOptions = {}
  ): Promise<number> {
    requireCart(cart, Op.SAVE_CRC32);
    const size = cart.saveSize;
    // SAVE_CRC32 only takes aligned ranges
    if (length === undefined && size % ALIGN) {
      return crc32(await this.readSave(cart, { offset, signal }));
    }
    return this.rangeStream(Op.SAVE_CRC32, cart, {
      offset,
      length: length ?? size - offset,
      crc: true,
      signal,
    }) as Promise<number>;
  }

  async writeSave(
    cart: Cartridge,
    data: Uint8Array | ArrayLike<number>,
    { onProgress, signal }: WriteSaveOptions = {}
  ): Promise<void> {
    if (!cart || !data || !data.length) {
      throw new OpsdkError('a cartridge and non-empty data are required', {
        code: HostError.ARGUMENT,
        op: Op.SAVE_WRITE,
      });
    }
    const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
    await this.run({
      op: Op.SAVE_WRITE,
      saveChip: cart.saveChip,
      romSize: cart.romSize,
      saveSize: bytes.length,
      upload: bytes,
      doneTimeoutMs: DONE_WRITE_TIMEOUT_MS,
      onProgress,
      signal,
    });
  }

  async readRtc(cart?: Cartridge): Promise<Uint8Array> {
    const { data, got } = await this.run({
      op: Op.RTC_READ,
      saveChip: cart?.saveChip ?? 0,
      expect: PKT_SIZE,
    });
    if (!got) {
      throw new OpsdkError('RTC_READ: no clock data', {
        status: Status.UNSUPPORTED,
        op: Op.RTC_READ,
      });
    }
    return data.slice(0, RTC_SIZE);
  }

  async writeRtc(cart: Cartridge | undefined, raw: Uint8Array | ArrayLike<number>): Promise<void> {
    const upload = new Uint8Array(RTC_SIZE);
    upload.set(Array.from(raw).slice(0, RTC_SIZE));
    await this.run({
      op: Op.RTC_WRITE,
      saveChip: cart?.saveChip ?? 0,
      upload,
      doneTimeoutMs: RTC_WRITE_TIMEOUT_MS,
    });
  }

  async setLed(led: LedSettings): Promise<void> {
    await this.run({ op: Op.LED_SET, data: buildLed(Op.LED_SET, led) });
  }

  async releaseLed(): Promise<void> {
    await this.run({ op: Op.LED_RELEASE });
  }

  async cameraStart(): Promise<void> {
    await this.run({ op: Op.CAMERA_START });
  }

  async cameraCapture(settings: Partial<CameraSettings> = {}): Promise<Uint8Array> {
    const s = { ...cameraDefaults(), ...settings };
    const body = new Uint8Array(60);
    body[CAM_EXPOSURE] = s.exposure & 0xff;
    body[CAM_EXPOSURE + 1] = (s.exposure >> 8) & 0xff;
    body[CAM_GAIN] = s.gain;
    body[CAM_VERTICAL_EDGE] = s.verticalEdge ? 1 : 0;
    body[CAM_EDGE_OPERATION] = s.edgeOperation;
    body[CAM_EDGE_RATIO] = s.edgeRatio;
    body[CAM_INVERT] = s.invert ? 1 : 0;
    body[CAM_VREF] = s.vref;
    body[CAM_ZERO_CALIBRATION] = s.zeroCalibration ? 1 : 0;
    body[CAM_OUTPUT_REF] = s.outputRefVoltage;
    body.set(s.matrix.slice(0, 48), CAM_MATRIX);
    const { data, got } = await this.run({
      op: Op.CAMERA_CAPTURE,
      raw: body,
      expect: CAMERA_FRAME_SIZE,
    });
    if (got < CAMERA_FRAME_SIZE) {
      throw new OpsdkError('CAMERA_CAPTURE: short frame', {
        code: HostError.PROTOCOL,
        op: Op.CAMERA_CAPTURE,
      });
    }
    return data;
  }

  async cameraStop(): Promise<void> {
    await this.run({ op: Op.CAMERA_STOP });
  }

  async readSensor(): Promise<SensorReading> {
    const { data, got } = await this.run({ op: Op.SENSOR_READ, expect: PKT_SIZE });
    if (got < SENSOR_SIZE) {
      throw new OpsdkError('SENSOR_READ: short reply', {
        code: HostError.PROTOCOL,
        op: Op.SENSOR_READ,
      });
    }
    return {
      kind: data[SENSOR_KIND],
      x: data[SENSOR_X] | (data[SENSOR_X + 1] << 8),
      y: data[SENSOR_Y] | (data[SENSOR_Y + 1] << 8),
      z: data[SENSOR_Z] | (data[SENSOR_Z + 1] << 8),
    };
  }

  async setRumble(on: boolean): Promise<void> {
    await this.run({ op: Op.RUMBLE_SET, data: [on ? 1 : 0] });
  }
}
