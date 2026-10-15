import { ProviderError } from '@gmt/core';
import { isRecord } from '../../src/util.js';

/** Narrowing helpers so tests never cast parsed JSON (plan decision 15). */
export function obj(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`expected an object, got ${JSON.stringify(v)}`);
  return v;
}
export function arr(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error(`expected an array, got ${JSON.stringify(v)}`);
  return v;
}
export function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error(`expected a string, got ${JSON.stringify(v)}`);
  return v;
}
export function asProviderError(v: unknown): ProviderError {
  if (!(v instanceof ProviderError)) throw new Error(`expected a ProviderError, got ${String(v)}`);
  return v;
}
export async function jsonOf(res: Response): Promise<unknown> {
  const v: unknown = await res.json();
  return v;
}
