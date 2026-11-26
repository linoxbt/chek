/**
 * JSON canonicalisation per RFC 8785 (JCS), restricted to the values Chek documents use:
 * null, booleans, safe integers, strings, arrays and objects. Non-integer numbers are refused,
 * so the Rust enclave and this library can never disagree on number formatting.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class CanonicalError extends Error {}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalError(`only safe integers are allowed, got ${value}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return canonicalString(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalError("only plain objects are allowed");
      }
      const obj = value as Record<string, unknown>;
      // Default string sort compares UTF-16 code units, which is what RFC 8785 requires.
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = obj[k];
        if (v === undefined) throw new CanonicalError(`undefined value at key ${k}`);
        parts.push(`${canonicalString(k)}:${canonicalize(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalError(`unsupported type ${typeof value}`);
  }
}

function canonicalString(s: string): string {
  if (!s.isWellFormed()) throw new CanonicalError("strings must not contain lone surrogates");
  // ES JSON.stringify escaping is exactly the RFC 8785 string serialisation.
  return JSON.stringify(s);
}

const encoder = new TextEncoder();

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}
