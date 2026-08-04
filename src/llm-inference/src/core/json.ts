export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeJsonValue(value: unknown, path = "$"): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new TypeError(`${path}[${index}] contains undefined`);
      }
      return normalizeJsonValue(item, `${path}[${index}]`);
    });
  }

  if (typeof value === "object" && isPlainObject(value)) {
    const normalized = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        normalized[key] = normalizeJsonValue(item, `${path}.${key}`);
      }
    }
    return normalized;
  }

  throw new TypeError(
    `${path} must be JSON-compatible; received ${typeof value}`,
  );
}

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item)}`)
    .join(",")}}`;
}
