// Justified rows preserve the source ratio; sparse final rows do not stretch.
export function galleryRows<T>(
  items: T[],
  width: number,
  ratioFor: (item: T) => number,
) {
  const gap = 12;
  const target = width < 600 ? 170 : 220;
  const rows: { items: T[]; height: number }[] = [];
  let row: T[] = [];
  let sum = 0;
  for (const item of items) {
    row.push(item);
    sum += ratioFor(item);
    if (sum * target + gap * (row.length - 1) >= width) {
      rows.push({ items: row, height: (width - gap * (row.length - 1)) / sum });
      row = [];
      sum = 0;
    }
  }
  if (row.length)
    rows.push({
      items: row,
      height: Math.min(target, (width - gap * (row.length - 1)) / sum),
    });
  return rows;
}
