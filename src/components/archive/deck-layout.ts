/** Signed circular distance; each item keeps its identity during deck movement. */
export function deckOffset(index: number, active: number, count: number): number {
  if (count <= 1) return 0;
  let offset = ((index - active) % count + count) % count;
  if (offset > count / 2) offset -= count;
  return offset;
}

export function deckPosition(offset: number) {
  const depth = Math.abs(offset);
  return {
    x: offset * 62,
    z: -depth * 72,
    angle: offset === 0 ? 0 : -Math.sign(offset) * Math.min(14 + depth * 5, 34),
    scale: Math.max(.72, 1 - depth * .045),
    opacity: depth <= 4 ? 1 - depth * .075 : 0,
  };
}
