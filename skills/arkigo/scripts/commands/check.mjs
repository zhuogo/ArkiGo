import { readModel, scope } from '../lib/read-model.mjs';
import { warningsFor } from '../lib/warnings.mjs';
import { page } from '../lib/output.mjs';
import { CliError } from '../lib/errors.mjs';

export const flags = { under: 1, strict: 0 };
export const paging = true;

export default function check(options) {
  const { locations, design, index, rev } = readModel(options);
  const warnings = warningsFor(design, index, locations.root, scope(index, options.under));
  const result = page({ ok: true, rev }, 'warnings', warnings, options);
  if (options.strict && warnings.length) {
    const report = page({ ok: false, code: 'CHECK_WARNINGS', rev, message: 'Design has check warnings.' },
      'warnings', warnings, options);
    throw new CliError('CHECK_WARNINGS', 'Design has check warnings.', 1, report);
  }
  return result;
}
