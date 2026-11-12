import type { ApiFetchResult } from "../lib/apiFetch.ts";
export type DataErrorKind = "limited" | "unauthorized" | "network" | "http" | "invalid";
export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly status: number;
  readonly retryAt: number | null;
  readonly networkError: boolean;
  constructor(kind: DataErrorKind, status = 0, retryAt: number | null = null) {
    super(`Server data: ${kind}`);
    this.name = "DataError";
    this.kind = kind;
    this.status = status;
    this.retryAt = retryAt;
    this.networkError = kind === "network";
  }
}
export function parseApiResult<T>(result: ApiFetchResult, parse: (value: unknown) => T): T {
  if (!result.ok) {
    throw new DataError(result.limited ? "limited" : result.unauthorized ? "unauthorized" : result.networkError ? "network" : "http", result.status, result.retryAt ?? null);
  }
  return parse(result.data);
}
export type DataRecord = Record<string, unknown>;
export function record(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataError("invalid");
  return value as DataRecord;
}
export function rows(value: unknown): DataRecord[] {
  if (!Array.isArray(value)) throw new DataError("invalid");
  return value.map(record);
}
