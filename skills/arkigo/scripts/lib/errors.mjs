export class CliError extends Error {
  constructor(code, message, status = 2, details = {}) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}

export function fail(code, message, status, details) {
  throw new CliError(code, message, status, details);
}

export const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

export function readPointer(value, path) {
  if (!/^(?:\/(?:[^~]|~[01])*)?$/u.test(path)) fail('INVALID_POINTER', 'Expected an RFC 6901 pointer.');
  for (const part of path ? path.slice(1).split('/') : []) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)
        || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) {
      fail('FIELD_NOT_FOUND', 'The JSON pointer does not resolve.', 1, { path });
    }
    value = value[key];
  }
  return value;
}
