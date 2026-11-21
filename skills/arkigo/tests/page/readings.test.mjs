import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexDesign } from '../../assets/model.mjs';
import { inventoryRows } from '../../assets/inventory.mjs';
import { clinicInput } from './fixtures.mjs';

const clinic = clinicInput();
const index = indexDesign(clinic.design);
test('inventory has six typed groups, stable order and composable nearest-module filters', () => {
  const rows = inventoryRows(index, clinic.evidence);
  assert.deepEqual(Object.keys(rows), ['rule', 'acceptance', 'decision', 'entity', 'interface', 'screen']);
  for (const [type, items] of Object.entries(rows)) {
    assert.ok(items.length && items.every(({ object }) => object.type === type));
  }
  assert.deepEqual(inventoryRows(indexDesign({ ...clinic.design, objects: [...clinic.design.objects].reverse() }),
    clinic.evidence), rows);
  const count = (filters) => Object.values(inventoryRows(index, clinic.evidence, filters)).flat().length;
  assert.ok(count({ status: 'proposed' }) > 0);
  assert.equal(count({ implementation: 'stale' }), 1);
  assert.equal(rows.entity.find(({ object }) => object.id === 'appointment').module.id, 'reserve');
  assert.equal(count({ module: 'booking' }), 2);
  assert.equal(count({ status: 'accepted', implementation: 'stale', module: 'reserve' }), 1);
  assert.equal(count({ status: 'proposed', implementation: 'stale', module: 'reserve' }), 0);
});
