import { OpsdkError } from './errors.js';

export const VERSION = '0.3.0';

export const PROTOCOL_VERSION = 1;

export const Status = Object.freeze({
  OK: 0x00,
  UNKNOWN_COMMAND: 0x01,
  UNSUPPORTED: 0x02,
  BAD_ARGUMENT: 0x03,
  NO_CARTRIDGE: 0x04,
  CART_UNSTABLE: 0x05,
  ABORTED: 0x06,
  TIMEOUT: 0x07,
  NOT_PERMITTED: 0x09,
  NO_SESSION: 0x0b,
  CART_ERROR: 0x0c,
} as const);
export type Status = (typeof Status)[keyof typeof Status];

export const HostError = Object.freeze({
  IO: 'io',
  TIMEOUT: 'timeout',
  PROTOCOL: 'protocol',
  ARGUMENT: 'argument',
  DEVICE: 'device',
  NO_DEVICE: 'no_device',
  UNAVAILABLE: 'unavailable',
} as const);
export type HostError = (typeof HostError)[keyof typeof HostError];

export const Op = Object.freeze({
  PING: 0xa0,
  GET_INFO: 0xa1,
  CART_STATUS: 0xa2,
  SESSION_BEGIN: 0xa4,
  SESSION_END: 0xa5,
  ROM_READ: 0xa8,
  ROM_CRC32: 0xa9,
  SAVE_READ: 0xb1,
  SAVE_WRITE: 0xb2,
  SAVE_CRC32: 0xb3,
  RTC_READ: 0xb4,
  RTC_WRITE: 0xb5,
  LED_SET: 0xb8,
  LED_RELEASE: 0xb9,
  CAMERA_START: 0xba,
  CAMERA_CAPTURE: 0xbb,
  CAMERA_STOP: 0xbc,
  SENSOR_READ: 0xbd,
  RUMBLE_SET: 0xbe,
} as const);
export type Op = (typeof Op)[keyof typeof Op];

export const Device = Object.freeze({
  GB_OPERATOR: 0,
  SN_OPERATOR: 1,
  N64_OPERATOR: 2,
} as const);
export type Device = (typeof Device)[keyof typeof Device];

export const Platform = Object.freeze({
  EMPTY: 0x00,
  GB: 0x20,
  GBA: 0x30,
  SNES: 0x50,
  N64: 0x60,
  UNKNOWN: 0xe0,
} as const);
export type Platform = (typeof Platform)[keyof typeof Platform];

export const Effect = Object.freeze({
  OFF: 0x00,
  CONSTANT: 0x10,
  SQUARE: 0x20,
  SAWTOOTH: 0x21,
  TRIANGLE: 0x22,
  SINE: 0x30,
  ALWAYS_ON: 0xff,
} as const);
export type Effect = (typeof Effect)[keyof typeof Effect];

export const Sensor = Object.freeze({
  MBC7_ACCEL: 0x01,
  GBA_TILT: 0x02,
  GBA_GYRO: 0x03,
  GBA_SOLAR: 0x04,
} as const);
export type Sensor = (typeof Sensor)[keyof typeof Sensor];

export const ALIGN = 512;
export const CAMERA_FRAME_SIZE = 3584;
export const RTC_SIZE = 64;

export const USB_VENDOR_ID = 0x16d0;
export const USB_PRODUCT_IDS: readonly number[] = Object.freeze([0x123d, 0x123e, 0x134d]);

export const BAUD_RATE = 115200;
export const DEFAULT_TIMEOUT_MS = 5000;
export const PROBE_TIMEOUT_MS = 500;

export const CMD_SIZE = 64;
export const PKT_SIZE = 512;
export const DATA_OFFSET = 0x0a;
export const CART_STATUS_REQUIRE_SESSION = 0x01;
export const REQUEST_ID_OFFSET = 0x3b;
export const PKT_READY = 0x00;
export const PKT_DONE = 0x01;
export const PKT_PROCEED = 0x02;

export const CMD_SAVE_CHIP = 0x01;
export const CMD_ROM_SIZE = 0x02;
export const CMD_SAVE_SIZE = 0x06;
export const CMD_CRC = 0x3c;

export const REPLY_MAGIC = [0xc0, 0xde] as const;
export const REPLY_TYPE = 0x02;
export const REPLY_OP = 0x03;
export const REPLY_OP_INVERSE = 0x04;
export const REPLY_STATUS = 0x05;
export const REPLY_REQUEST_ID = 0x06;

export const ERROR_MAGIC = [0x55, 0xaa] as const;
export const ERROR_CODE = 0x02;

export const SIG_TYPE = 0x02;
export const SIG_LOGO = 0x03;
export const SIG_CHECKSUM = 0x04;
export const SIG_ROM_SHIFT = 0x05;
export const SIG_SAVE_SHIFT = 0x06;
export const SIG_SAVE_CHIP = 0x07;
export const SIG_REVISION = 0x08;
export const SIG_REGION = 0x09;
export const SIG_ROM_CODED = 0x0a;
export const SIG_HEADER = 0x0d;
export const SIG_HEADER_END = 0x14;
export const SAVE_CHIP_SRAM_96K = 0x24;
export const SAVE_SIZE_SRAM_96K = 98304;
export const PLATFORM_MASK = 0xf0;
export const FLAGS_MASK = 0x0f;
export const FLAG_FLASHCART = 0x0b;
export const FLAG_COUNTERFEIT = 0x04;

export const INFO_PROTOCOL = 0x04;
export const INFO_DEVICE_ID = 0x06;
export const INFO_BOARD = 0x07;
export const INFO_APP_VERSION = 0x08;
export const INFO_SYS_VERSION = 0x0b;
export const INFO_CAPABILITIES = 0x0e;
export const INFO_SERIAL = 0x12;
export const INFO_IDLE_TIMEOUT = 0x22;
export const INFO_SIZE = 0x24;

export const SENSOR_KIND = 0;
export const SENSOR_X = 2;
export const SENSOR_Y = 4;
export const SENSOR_Z = 6;
export const SENSOR_SIZE = 8;

export const LED_COLORS = 0x01;
export const LED_COLOR_EFFECT = 0x19;
export const LED_COLOR_DUTY = 0x1a;
export const LED_LIGHT_EFFECT = 0x1b;
export const LED_LIGHT_DUTY = 0x1c;
export const LED_OFFSET = 0x1d;
export const LED_PERIOD = 0x1e;

export const CAM_EXPOSURE = 1;
export const CAM_GAIN = 3;
export const CAM_VERTICAL_EDGE = 4;
export const CAM_EDGE_OPERATION = 5;
export const CAM_EDGE_RATIO = 6;
export const CAM_INVERT = 7;
export const CAM_VREF = 8;
export const CAM_ZERO_CALIBRATION = 9;
export const CAM_OUTPUT_REF = 10;
export const CAM_MATRIX = 11;

export const UNSTABLE_MAGIC: readonly number[] = [0x55, 0xde, 0xc0, 0xde, 0xdb, 0xa1, 0x1a, 0xd5];
export const ABORT_MAGIC: readonly number[] = [...'EPIABORT'].map(c => c.charCodeAt(0));

export const READ_ONLY_OPS: ReadonlySet<number> = new Set<number>([
  Op.PING,
  Op.GET_INFO,
  Op.CART_STATUS,
  Op.ROM_READ,
  Op.ROM_CRC32,
  Op.SAVE_READ,
  Op.SAVE_CRC32,
  Op.RTC_READ,
  Op.SENSOR_READ,
]);

export const STATUS_TEXT: Readonly<Record<number, string>> = {
  [Status.OK]: 'ok',
  [Status.UNKNOWN_COMMAND]: 'unknown command (firmware without this SDK command)',
  [Status.UNSUPPORTED]: 'not supported by this cartridge or device',
  [Status.BAD_ARGUMENT]: 'bad argument',
  [Status.NO_CARTRIDGE]: 'no cartridge',
  [Status.CART_UNSTABLE]: 'cartridge connection unstable',
  [Status.ABORTED]: 'aborted',
  [Status.TIMEOUT]: 'device timed out waiting for data',
  [Status.NOT_PERMITTED]: 'not permitted on this cartridge',
  [Status.NO_SESSION]: 'no session open',
  [Status.CART_ERROR]: 'the cartridge did not complete the operation',
};

export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? `status 0x${status.toString(16)}`;
}

export function opName(op: number): string {
  return (Object.keys(Op) as (keyof typeof Op)[]).find(k => Op[k] === op) ?? `0x${op.toString(16)}`;
}

// command packets carry CRC-32/MPEG-2, data crcs are the zlib kind
export function crc32Mpeg2(data: ArrayLike<number>, length: number): number {
  let crc = 0xffffffff;
  for (let i = 0; i < length; i++) {
    crc ^= data[i] << 24;
    for (let b = 0; b < 8; b++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

const ZLIB_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: ArrayLike<number>, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = ZLIB_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export const u32 = (b: ArrayLike<number>, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

export function seal(packet: Uint8Array): Uint8Array {
  putU32(packet, CMD_CRC, crc32Mpeg2(packet, CMD_CRC));
  return packet;
}

export interface CommandFields {
  saveChip?: number;
  romSize?: number;
  saveSize?: number;
  data?: ArrayLike<number> | null;
  requestId?: number;
}

export function buildCommand(
  op: number,
  { saveChip = 0, romSize = 0, saveSize = 0, data = null, requestId = 0 }: CommandFields = {}
): Uint8Array {
  const p = new Uint8Array(CMD_SIZE);
  p[0] = op;
  p[CMD_SAVE_CHIP] = saveChip;
  putU32(p, CMD_ROM_SIZE, romSize >>> 0);
  putU32(p, CMD_SAVE_SIZE, saveSize >>> 0);
  if (data) p.set(Array.from(data).slice(0, REQUEST_ID_OFFSET - DATA_OFFSET), DATA_OFFSET);
  p[REQUEST_ID_OFFSET] = requestId;
  return seal(p);
}

export type Rgb = readonly [number, number, number];

export interface LedSettings {
  primary: Rgb;
  secondary?: Rgb;
  colorEffect?: number;
  colorDuty?: number;
  lightEffect?: number;
  lightDuty?: number;
  offset?: number;
  periodMs?: number;
}

export function buildLed(id: number, led: LedSettings): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = id;
  [led.primary, led.secondary ?? led.primary].forEach((color, c) => {
    const lin = color.map(v => Math.pow(v / 255, 2.2));
    const fields = [...lin, Math.pow(lin[0] + lin[1] + lin[2], 1 / 2.2)];
    fields.forEach((v, i) => {
      const fx = Math.trunc(v * 65536);
      const o = LED_COLORS + c * 12 + i * 3;
      b[o] = fx & 0xff;
      b[o + 1] = (fx >> 8) & 0xff;
      b[o + 2] = (fx >> 16) & 0xff;
    });
  });
  b[LED_COLOR_EFFECT] = led.colorEffect ?? Effect.CONSTANT;
  b[LED_COLOR_DUTY] = led.colorDuty ?? 0;
  b[LED_LIGHT_EFFECT] = led.lightEffect ?? Effect.CONSTANT;
  b[LED_LIGHT_DUTY] = led.lightDuty ?? 100;
  b[LED_OFFSET] = led.offset ?? 0;
  const period = led.periodMs ?? 1000;
  b[LED_PERIOD] = period & 0xff;
  b[LED_PERIOD + 1] = (period >> 8) & 0xff;
  return b;
}

function protocolSaveChip(t: number): number {
  const special: Record<number, number> = {
    0x40: 0x40,
    0x41: 0x02,
    0x42: 0x01,
    0x43: 0x03,
  };
  if (t in special) return special[t];
  return ({ 0x10: 0x01, 0x20: 0x02, 0x30: 0x03 } as Record<number, number>)[t & PLATFORM_MASK] ?? 0;
}

export interface Cartridge {
  raw: Uint8Array;
  platform: Platform;
  typeByte: number;
  flashcart: boolean;
  counterfeit: boolean;
  logoValid: boolean;
  checksumValid: boolean;
  romSize: number;
  saveSize: number;
  saveChipType: number;
  saveChip: number;
  revision: number;
  region: number;
  headerBytes: Uint8Array;
}

const PLATFORMS = new Set<number>(Object.values(Platform));

export function parseSignature(raw: Uint8Array): Cartridge {
  const plat = raw[SIG_TYPE] & PLATFORM_MASK;
  const flags = raw[SIG_TYPE] & FLAGS_MASK;
  const romShift = raw[SIG_ROM_SHIFT];
  const saveShift = raw[SIG_SAVE_SHIFT];
  const pow2 = romShift && romShift < 32 ? 2 ** romShift : 0;
  // non power-of-two roms (3 MiB, 6 MiB): odd multiplier in the low 2 bits, shift above
  const coded = raw[SIG_ROM_CODED];
  let exact = coded && coded >> 2 < 29 ? (2 * (coded & 3) + 1) * 2 ** (coded >> 2) : 0;
  if (exact && pow2 && exact > pow2) exact = pow2;
  const saveShiftSize = saveShift && saveShift < 32 ? 2 ** saveShift : 0;
  return {
    raw: raw.slice(0, PKT_SIZE),
    platform: (PLATFORMS.has(plat) ? plat : Platform.UNKNOWN) as Platform,
    typeByte: raw[SIG_TYPE],
    flashcart: (flags & FLAG_FLASHCART) !== 0,
    counterfeit: (flags & FLAG_COUNTERFEIT) !== 0,
    logoValid: raw[SIG_LOGO] !== 0,
    checksumValid: raw[SIG_CHECKSUM] !== 0,
    romSize: exact || pow2,
    saveSize: raw[SIG_SAVE_CHIP] === SAVE_CHIP_SRAM_96K ? SAVE_SIZE_SRAM_96K : saveShiftSize,
    saveChipType: raw[SIG_SAVE_CHIP],
    saveChip: protocolSaveChip(raw[SIG_SAVE_CHIP]),
    revision: raw[SIG_REVISION],
    region: raw[SIG_REGION],
    headerBytes: raw.slice(SIG_HEADER, SIG_HEADER_END),
  };
}

export function sameCartridge(a: Cartridge, b: Cartridge): boolean {
  return (
    a.typeByte === b.typeByte &&
    a.romSize === b.romSize &&
    a.saveSize === b.saveSize &&
    a.saveChipType === b.saveChipType &&
    a.revision === b.revision &&
    a.region === b.region &&
    a.headerBytes.length === b.headerBytes.length &&
    a.headerBytes.every((v, i) => v === b.headerBytes[i])
  );
}

export const isReadyDone = (p: Uint8Array, type: number, op: number): boolean =>
  p[0] === REPLY_MAGIC[0] &&
  p[1] === REPLY_MAGIC[1] &&
  p[REPLY_TYPE] === type &&
  p[REPLY_OP] === op &&
  p[REPLY_OP_INVERSE] === (~op & 0xff);

const zeroFrom = (p: Uint8Array, start: number): boolean => {
  for (let i = start; i < p.length; i++) if (p[i]) return false;
  return true;
};

// rom data can begin like a DONE header, a real one is all zero after the id
export const isDone = (p: Uint8Array, op: number): boolean =>
  isReadyDone(p, PKT_DONE, op) && zeroFrom(p, REPLY_REQUEST_ID + 1);

export const isUnstable = (p: Uint8Array): boolean =>
  UNSTABLE_MAGIC.every((v, i) => p[i] === v) && zeroFrom(p, UNSTABLE_MAGIC.length);

export interface CameraSettings {
  exposure: number;
  gain: number;
  verticalEdge: boolean;
  edgeOperation: number;
  edgeRatio: number;
  invert: boolean;
  vref: number;
  zeroCalibration: boolean;
  outputRefVoltage: number;
  matrix: Uint8Array;
}

export const CAMERA_MATRIX_SLOPE = 0x12;
export const CAMERA_MATRIX_OFFSET = 0x82;

export function cameraMatrix(slope: number, offset: number): Uint8Array {
  const layout = [0, 30, 24, 6, 15, 45, 39, 21, 12, 42, 36, 18, 3, 33, 27, 9];
  const q = [0, 1, 2, 3].map(i => Math.min(offset + i * slope, 255));
  const matrix = new Uint8Array(48);
  for (let comp = 0; comp < 3; comp++) {
    let acc = q[comp] << 4;
    const inc = q[comp + 1] - q[comp];
    for (let px = 0; px < 16; px++) {
      matrix[comp + layout[px]] = (acc >> 4) & 0xff;
      acc = (acc + inc) & 0xffff;
    }
  }
  return matrix;
}

export function cameraDefaults(): CameraSettings {
  return {
    exposure: 0x1000,
    gain: 0,
    verticalEdge: false,
    edgeOperation: 0,
    edgeRatio: 0x40,
    invert: false,
    vref: 0x03,
    zeroCalibration: true,
    outputRefVoltage: 0,
    matrix: cameraMatrix(CAMERA_MATRIX_SLOPE, CAMERA_MATRIX_OFFSET),
  };
}

export function decodeCameraFrame(frame: Uint8Array): Uint8Array {
  const img = new Uint8Array(128 * 112);
  for (let t = 0; t < 16 * 14; t++) {
    for (let y = 0; y < 8; y++) {
      const lo = frame[t * 16 + y * 2];
      const hi = frame[t * 16 + y * 2 + 1];
      for (let x = 0; x < 8; x++) {
        const v = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
        img[(Math.floor(t / 16) * 8 + y) * 128 + (t % 16) * 8 + x] = 255 - v * 85;
      }
    }
  }
  return img;
}

export const SN_RTC_TYPE_RTC4513 = 2;
export const RTC4513_REGISTERS = 16;
export const RTC4513_SECOND = 0;
export const RTC4513_MINUTE = 2;
export const RTC4513_HOUR = 4;
export const RTC4513_DAY = 6;
export const RTC4513_MONTH = 8;
export const RTC4513_YEAR = 10;
export const RTC4513_WEEKDAY = 12;
export const RTC4513_CONTROL_D = 13;
export const RTC4513_CONTROL_E = 14;
export const RTC4513_CONTROL_F = 15;
export const RTC4513_LOST_POWER = 0x08;
export const RTC4513_PM = 0x04;
export const RTC4513_CALENDAR = 0x02;
export const RTC4513_INTERRUPT_MASKED = 0x0f;
export const RTC4513_24_HOUR = 0x04;
export const RTC4513_STOP = 0x02;

export interface Rtc4513Time {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  hour12?: boolean;
  stopped?: boolean;
}

export interface Rtc4513 extends Rtc4513Time {
  hour12: boolean;
  stopped: boolean;
  calendar: boolean;
  lostPower: boolean;
  valid: boolean;
}

export function decodeRtc4513(raw: Uint8Array | ArrayLike<number>): Rtc4513 {
  if (raw.length < 1 + RTC4513_REGISTERS || raw[0] !== SN_RTC_TYPE_RTC4513) {
    throw new OpsdkError('not the clock of an SPC7110 cartridge (readRtc() of one)', {
      code: HostError.ARGUMENT,
    });
  }
  const reg = (index: number): number => raw[1 + index] & 0x0f;
  const pair = (index: number, tensMask: number): number =>
    reg(index) + (reg(index + 1) & tensMask) * 10;
  const hour12 = !(reg(RTC4513_CONTROL_F) & RTC4513_24_HOUR);
  const pm = Boolean(reg(RTC4513_HOUR + 1) & RTC4513_PM);
  const counted = pair(RTC4513_HOUR, hour12 ? 0x01 : 0x03);
  const clock = {
    year: pair(RTC4513_YEAR, 0x0f),
    month: pair(RTC4513_MONTH, 0x01),
    day: pair(RTC4513_DAY, 0x03),
    weekday: reg(RTC4513_WEEKDAY) & 0x07,
    hour: hour12 ? (counted % 12) + (pm ? 12 : 0) : counted,
    minute: pair(RTC4513_MINUTE, 0x07),
    second: pair(RTC4513_SECOND, 0x07),
  };
  const ones = [
    RTC4513_SECOND,
    RTC4513_MINUTE,
    RTC4513_HOUR,
    RTC4513_DAY,
    RTC4513_MONTH,
    RTC4513_YEAR,
    RTC4513_YEAR + 1,
  ];
  return {
    ...clock,
    hour12,
    stopped: Boolean(reg(RTC4513_CONTROL_F) & RTC4513_STOP),
    calendar: Boolean(reg(RTC4513_CONTROL_D) & RTC4513_CALENDAR),
    lostPower: Boolean(reg(RTC4513_SECOND + 1) & RTC4513_LOST_POWER),
    valid:
      ones.every(index => reg(index) <= 9) &&
      rtc4513InRange(clock) &&
      (hour12 ? counted >= 1 && counted <= 12 : true),
  };
}

function rtc4513InRange(clock: Rtc4513Time): boolean {
  const within = (value: number, low: number, high: number): boolean =>
    Number.isInteger(value) && value >= low && value <= high;
  return (
    within(clock.year, 0, 99) &&
    within(clock.month, 1, 12) &&
    within(clock.day, 1, 31) &&
    within(clock.weekday, 0, 6) &&
    within(clock.hour, 0, 23) &&
    within(clock.minute, 0, 59) &&
    within(clock.second, 0, 59)
  );
}

export function encodeRtc4513(clock: Rtc4513Time): Uint8Array {
  if (!rtc4513InRange(clock)) {
    throw new OpsdkError(
      'year 0-99, month 1-12, day 1-31, weekday 0-6, hour 0-23, minute and second 0-59',
      { code: HostError.ARGUMENT }
    );
  }
  const registers = new Uint8Array(RTC4513_REGISTERS);
  const put = (index: number, value: number): void => {
    registers[index] = value % 10;
    registers[index + 1] = Math.floor(value / 10);
  };
  put(RTC4513_SECOND, clock.second);
  put(RTC4513_MINUTE, clock.minute);
  put(RTC4513_HOUR, clock.hour12 ? clock.hour % 12 || 12 : clock.hour);
  if (clock.hour12 && clock.hour >= 12) registers[RTC4513_HOUR + 1] |= RTC4513_PM;
  put(RTC4513_DAY, clock.day);
  put(RTC4513_MONTH, clock.month);
  put(RTC4513_YEAR, clock.year);
  registers[RTC4513_WEEKDAY] = clock.weekday;
  registers[RTC4513_CONTROL_D] = RTC4513_CALENDAR;
  registers[RTC4513_CONTROL_E] = RTC4513_INTERRUPT_MASKED;
  registers[RTC4513_CONTROL_F] =
    (clock.hour12 ? 0 : RTC4513_24_HOUR) | (clock.stopped ? RTC4513_STOP : 0);
  return registers;
}
