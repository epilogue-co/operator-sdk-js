import type { HostError, Status } from './protocol.js';

export interface OpsdkErrorOptions {
  status?: Status | null;
  code?: HostError | null;
  deviceError?: number;
  lost?: boolean;
  op?: number | null;
  cause?: unknown;
}

export class OpsdkError extends Error {
  readonly status: Status | null;
  readonly code: HostError | null;
  readonly deviceError: number;
  readonly lost: boolean;
  readonly op: number | null;

  constructor(message: string, options: OpsdkErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OpsdkError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.deviceError = options.deviceError ?? 0;
    this.lost = options.lost ?? false;
    this.op = options.op ?? null;
  }
}

export const ignore = (): void => {};

export function isStatus(e: unknown, status: Status): e is OpsdkError {
  return e instanceof OpsdkError && e.status === status;
}
