import { indexDesign, descendants, revision } from './design.mjs';
import { project } from './paths.mjs';
import { loadDesign } from './validate.mjs';
import { fail } from './errors.mjs';

export function readModel(options) {
  const locations = project(options);
  const design = loadDesign(locations);
  const index = indexDesign(design);
  return { locations, design, index, rev: revision(design) };
}

export function getObject(index, id) {
  const item = index.objects.get(id);
  if (!item) fail('OBJECT_NOT_FOUND', 'Object does not exist.', 1, { id });
  return item;
}

export function scope(index, under) {
  if (under === undefined) return undefined;
  getObject(index, under);
  return descendants(index, under);
}
