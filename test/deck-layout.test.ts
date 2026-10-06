import { it } from 'node:test';
import assert from 'node:assert/strict';
import { deckOffset, deckPosition } from '../src/components/archive/deck-layout';

it('keeps a single active object and circular neighbors without duplicated cards', () => {
  for (const count of [1, 2, 3, 8, 9]) {
    for (let active = 0; active < count; active++) {
      const offsets = Array.from({ length: count }, (_, index) => deckOffset(index, active, count));
      assert.equal(offsets.filter(value => value === 0).length, 1);
      assert.equal(new Set(offsets).size, count);
    }
  }
  assert.equal(deckOffset(8, 0, 9), -1);
  assert.equal(deckOffset(0, 8, 9), 1);
});

it('layers equal frames with symmetrical spatial positions, not random floating images', () => {
  assert.equal(deckPosition(0).scale, 1);
  assert.equal(deckPosition(-2).x, -deckPosition(2).x);
  assert.equal(deckPosition(-2).z, deckPosition(2).z);
  assert.equal(deckPosition(-2).angle, -deckPosition(2).angle);
  assert.equal(deckPosition(5).opacity, 0);
});
