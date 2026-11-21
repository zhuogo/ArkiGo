#!/usr/bin/env node
import { CliError, fail } from './lib/errors.mjs';
import { jsonLine } from './lib/io.mjs';
import { commands } from './lib/commands.mjs';

const pagination = { offset: 1, limit: 1, 'max-bytes': 1 };

function parse(tokens, command) {
  const { flags, paging, budget, positionals: [min, max] = [0, 0] } = command;
  const accepted = { dir: 1, root: 1, ...(paging && pagination), ...(budget && { 'max-bytes': 1 }), ...flags };
  const options = Object.create(null);
  const args = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-') || token === '-') {
      args.push(token);
      continue;
    }
    const flag = token.slice(2);
    if (!token.startsWith('--') || !Object.hasOwn(accepted, flag)) {
      fail('UNKNOWN_ARGUMENT', 'Unknown argument: ' + token);
    }
    if (Object.hasOwn(options, flag)) fail('DUPLICATE_ARGUMENT', 'Repeated argument: ' + token);
    const count = accepted[flag];
    const values = tokens.slice(i + 1, i + 1 + count);
    if (values.length !== count || values.some(value => value.startsWith('--'))) {
      fail('ARGUMENT_REQUIRED', 'Missing value for ' + token);
    }
    options[flag] = count === 0 ? true : count === 1 ? values[0] : values;
    i += count;
  }
  if (args.length < min) fail('ARGUMENT_REQUIRED', 'Missing positional argument.');
  if (args.length > max) fail('UNKNOWN_ARGUMENT', 'Unexpected positional argument.');
  const ranges = [['offset', 0, Number.MAX_SAFE_INTEGER], ['limit', 1, 100], ['max-bytes', 1024, 65536]];
  for (const [flag, min, max] of ranges) {
    if (!Object.hasOwn(options, flag)) continue;
    const value = Number(options[flag]);
    if (!/^\d+$/.test(options[flag]) || !Number.isSafeInteger(value) || value < min || value > max) {
      fail('INVALID_ARGUMENT', 'Invalid --' + flag + ' value.');
    }
    options[flag] = value;
  }
  for (const key of ['dir', 'root']) {
    if (options[key] === '') fail('INVALID_ARGUMENT', '--' + key + ' needs a directory.');
  }
  return [options, args];
}

try {
  const [name, ...tokens] = process.argv.slice(2);
  if (!commands.includes(name)) fail('UNKNOWN_COMMAND', 'Available commands: ' + commands.join(', '));
  const command = await import('./commands/' + name + '.mjs');
  const result = await command.default(...parse(tokens, command));
  process.stdout.write(typeof result === 'string' ? result : jsonLine(result));
} catch (error) {
  const expected = error instanceof CliError;
  const message = expected ? error.message : 'Unable to read, write, or process ArkiGo data' +
    (error.code ? ' (' + error.code + ').' : '.');
  process.stderr.write(jsonLine({ ok: false, code: expected ? error.code : 'IO_ERROR', message, ...error.details }));
  process.exitCode = expected ? error.status : 2;
}
