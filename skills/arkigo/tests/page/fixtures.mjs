import { readFileSync } from 'node:fs';
import { revision } from '../../scripts/lib/design.mjs';

export const clinicDir = new URL('./fixtures/clinic/', import.meta.url);
const readClinic = (name) => JSON.parse(readFileSync(new URL(name + '.json', clinicDir), 'utf8'));

export function pageInput(design, extra = {}) {
  return {
    design, rev: revision(design), layout: null, evidence: {},
    generatedAt: '2026-11-20T09:00:00Z', editor: null, ...extra
  };
}

export function clinicInput(extra = {}) {
  return pageInput(readClinic('design'), {
    evidence: readClinic('evidence'), ...extra
  });
}
