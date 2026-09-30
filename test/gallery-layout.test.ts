import assert from "node:assert/strict";
import { test } from "node:test";
import { galleryRows } from "../src/components/archive/gallery-layout";

test("mixed portrait, landscape and paper ratios fit phone, tablet and desktop rows", () => {
  const items = [1.5, 2 / 3, 16 / 9, 0.707, 1, 2, 0.5, 1.5];
  for (const width of [288, 358, 680, 920, 1440]) {
    const rows = galleryRows(items, width, (ratio) => ratio);
    assert.deepEqual(
      rows.flatMap((row) => row.items),
      items,
    );
    for (const row of rows) {
      const usedWidth =
        row.items.reduce((sum, ratio) => sum + ratio * row.height, 0) +
        12 * (row.items.length - 1);
      assert.ok(row.height > 0);
      assert.ok(usedWidth <= width + 0.001);
    }
  }
});

test("one portrait does not stretch to fill a desktop row", () => {
  const [row] = galleryRows([2 / 3], 1200, (ratio) => ratio);
  assert.ok(row.height <= 220);
  assert.equal(galleryRows([], 360, (ratio) => ratio).length, 0);
});
