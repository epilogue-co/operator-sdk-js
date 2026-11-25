import { OpsdkError, ignore } from './errors.js';
import { HostError, USB_PRODUCT_IDS, USB_VENDOR_ID } from './protocol.js';
import type { Transport } from './transport.js';

export interface SerialPortFilterLike {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface StreamReaderLike {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

export interface StreamWriterLike {
  write(chunk: Uint8Array): Promise<void>;
  releaseLock(): void;
}

export interface SerialPortLike {
  readonly readable: { getReader(): StreamReaderLike } | null;
  readonly writable: { getWriter(): StreamWriterLike } | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
}

export interface SerialLike {
  requestPort(options?: { filters?: SerialPortFilterLike[] }): Promise<SerialPortLike>;
  getPorts?(): Promise<SerialPortLike[]>;
}

export const USB_FILTERS: readonly SerialPortFilterLike[] = Object.freeze(
  USB_PRODUCT_IDS.map(id => ({ usbVendorId: USB_VENDOR_ID, usbProductId: id }))
);

// web serial talks to the CDC port, webusb to the vendor interface next to it
export class WebSerialTransport implements Transport {
  private reader: StreamReaderLike;
  private writer: StreamWriterLike;

  constructor(readonly port: SerialPortLike) {
    if (!port.readable || !port.writable) {
      throw new OpsdkError('the serial port is not open', { code: HostError.IO });
    }
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
  }

  async read(): Promise<Uint8Array | null> {
    try {
      const { value, done } = await this.reader.read();
      return done ? null : (value ?? new Uint8Array(0));
    } catch (e) {
      this.reader.releaseLock();
      if (!this.port.readable) throw e;
      this.reader = this.port.readable.getReader();
      const err = e as Error;
      throw Object.assign(new Error(`${err.name}: ${err.message}`), { lost: true });
    }
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(ignore);
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.port.close();
  }
}

export interface USBDeviceFilterLike {
  vendorId?: number;
  productId?: number;
}

export interface USBEndpointLike {
  readonly endpointNumber: number;
  readonly direction: 'in' | 'out';
}

export interface USBInterfaceLike {
  readonly interfaceNumber: number;
  readonly alternates: readonly {
    readonly interfaceClass: number;
    readonly endpoints: readonly USBEndpointLike[];
  }[];
}

export interface USBInTransferResultLike {
  readonly data?: DataView;
  readonly status?: 'ok' | 'stall' | 'babble';
}

export interface USBDeviceLike {
  readonly configuration: { readonly interfaces: readonly USBInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferIn(endpoint: number, length: number): Promise<USBInTransferResultLike>;
  transferOut(endpoint: number, data: ArrayBuffer | ArrayBufferView): Promise<unknown>;
  clearHalt(direction: 'in' | 'out', endpoint: number): Promise<void>;
}

export interface USBLike {
  requestDevice(options: { filters: USBDeviceFilterLike[] }): Promise<USBDeviceLike>;
  getDevices?(): Promise<USBDeviceLike[]>;
}

export const USB_DEVICE_FILTERS: readonly USBDeviceFilterLike[] = Object.freeze(
  USB_PRODUCT_IDS.map(id => ({ vendorId: USB_VENDOR_ID, productId: id }))
);

const USB_VENDOR_CLASS = 0xff;
const USB_READS_IN_FLIGHT = 8;
const USB_READ_SIZE = 65536;

type QueuedRead = USBInTransferResultLike & { error?: unknown };

export class WebUSBTransport implements Transport {
  static async open(device: USBDeviceLike): Promise<WebUSBTransport> {
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const iface = device.configuration?.interfaces.find(
      i => i.alternates[0]?.interfaceClass === USB_VENDOR_CLASS
    );
    if (!iface) {
      await device.close();
      throw new OpsdkError(
        'this Operator firmware has no WebUSB interface: update it, or use Web Serial',
        { code: HostError.UNAVAILABLE }
      );
    }
    await device.claimInterface(iface.interfaceNumber);
    const eps = iface.alternates[0].endpoints;
    const epIn = eps.find(e => e.direction === 'in');
    const epOut = eps.find(e => e.direction === 'out');
    if (!epIn || !epOut) {
      await device.close();
      throw new OpsdkError('the WebUSB interface has no bulk endpoints', { code: HostError.IO });
    }
    return new WebUSBTransport(
      device,
      iface.interfaceNumber,
      epIn.endpointNumber,
      epOut.endpointNumber
    );
  }

  private closed = false;
  private reads: Promise<QueuedRead>[] = [];

  constructor(
    readonly device: USBDeviceLike,
    private readonly iface: number,
    private readonly epIn: number,
    private readonly epOut: number
  ) {
    for (let i = 0; i < USB_READS_IN_FLIGHT; i++) this.queueRead();
  }

  private queueRead(): void {
    // parked unawaited, so a rejection has to be kept as a value or node/chrome
    // reports it as unhandled
    this.reads.push(
      this.device.transferIn(this.epIn, USB_READ_SIZE).then(
        r => r as QueuedRead,
        (error: unknown) => ({ error })
      )
    );
  }

  async read(): Promise<Uint8Array | null> {
    for (;;) {
      if (this.closed) return null;
      const next = this.reads.shift();
      if (!next) return null;
      const r = await next;
      if (this.closed) return null;
      if (r.error) throw r.error instanceof Error ? r.error : new Error('USB transfer failed');
      this.queueRead();
      if (r.status === 'stall') {
        await this.device.clearHalt('in', this.epIn);
        continue;
      }
      if (r.data?.byteLength)
        return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    }
  }

  async write(data: Uint8Array): Promise<void> {
    await this.device.transferOut(this.epOut, data);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.device.releaseInterface(this.iface).catch(ignore);
    await this.device.close();
  }
}
