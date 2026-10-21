/**
 * Pure geometry for the links between things (drawn by LinksLayer): an arc
 * over the tops of cards in the same row, a straight line between cards in
 * different rows, the label at the midpoint.
 */
import type { DraftLink } from "../../../shared/understood-draft.js";

export type Rect = { left: number; top: number; width: number; height: number };

export type LinkPath = {
  key: string;
  d: string;
  labelX: number;
  labelY: number;
  label: string;
};

/** Pure geometry: one path per link whose cards were measured. */
export function linkPaths(
  links: readonly DraftLink[],
  rects: ReadonlyMap<string, Rect>,
): LinkPath[] {
  // Spread the arc ends over each card's top so arrows don't overlap.
  const ends = new Map<string, number>();
  const slot = new Map<string, number>();
  links.forEach((l, i) => {
    for (const id of [l.from, l.to]) {
      slot.set(`${i}:${id}`, ends.get(id) ?? 0);
      ends.set(id, (ends.get(id) ?? 0) + 1);
    }
  });
  const anchorX = (i: number, id: string, r: Rect) =>
    r.left +
    (r.width * ((slot.get(`${i}:${id}`) ?? 0) + 1)) / ((ends.get(id) ?? 0) + 1);

  const out: LinkPath[] = [];
  links.forEach((l, i) => {
    const a = rects.get(l.from);
    const b = rects.get(l.to);
    if (!a || !b || l.from === l.to) return;
    const key = `${l.from}-${l.to}-${i}`;
    if (Math.abs(a.top - b.top) < 8) {
      const x1 = anchorX(i, l.from, a);
      const x2 = anchorX(i, l.to, b);
      const y = Math.min(a.top, b.top);
      const lift = Math.min(50, 18 + Math.abs(x2 - x1) * 0.05);
      out.push({
        key,
        d: `M ${x1} ${y} C ${x1} ${y - lift}, ${x2} ${y - lift}, ${x2} ${y - 2}`,
        labelX: (x1 + x2) / 2,
        labelY: y - lift * 0.75 - 3,
        label: l.label,
      });
      return;
    }
    const [upper, lower, down] = a.top < b.top ? [a, b, true] : [b, a, false];
    const x1 = upper.left + upper.width / 2;
    const y1 = upper.top + upper.height;
    const x2 = lower.left + lower.width / 2;
    const y2 = lower.top;
    out.push({
      key,
      d: down
        ? `M ${x1} ${y1} L ${x2} ${y2 - 2}`
        : `M ${x2} ${y2} L ${x1} ${y1 + 2}`,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2,
      label: l.label,
    });
  });
  return out;
}

/** About how wide a label pill is (11px text). */
export function labelWidth(label: string): number {
  return label.length * 6 + 14;
}
