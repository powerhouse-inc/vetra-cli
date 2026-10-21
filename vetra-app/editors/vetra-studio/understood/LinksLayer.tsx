/**
 * The links between things, drawn as arrows over the cards: cards in the
 * same row are joined by an arc over their tops (through the band the grid
 * leaves free above them), cards in different rows by a line from the upper
 * card's bottom to the lower card's top. The label sits at the midpoint.
 * Positions are measured from the DOM and recomputed on resize.
 */
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { DraftLink } from "../../../shared/understood-draft.js";
import {
  labelWidth,
  linkPaths,
  type LinkPath,
  type Rect,
} from "./linkPaths.js";

function measure(container: HTMLElement): Map<string, Rect> {
  const base = container.getBoundingClientRect();
  const rects = new Map<string, Rect>();
  for (const el of Array.from(
    container.querySelectorAll<HTMLElement>("[data-thing-id]"),
  )) {
    const r = el.getBoundingClientRect();
    const id = el.dataset.thingId;
    if (id)
      rects.set(id, {
        left: r.left - base.left,
        top: r.top - base.top,
        width: r.width,
        height: r.height,
      });
  }
  return rects;
}

/** Draws into its parent: the positioned element holding the cards
 *  (`data-thing-id`). */
export function LinksLayer({
  links,
  version,
}: {
  links: readonly DraftLink[];
  /** Changes whenever the cards may have moved (the draft). */
  version: unknown;
}) {
  const markerId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [paths, setPaths] = useState<LinkPath[]>([]);

  useLayoutEffect(() => {
    // The parent holds the cards: its own ref is not attached yet when
    // this child's layout effect runs, so measure from here.
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const update = () => setPaths(linkPaths(links, measure(container)));
    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [links, version]);

  return (
    <svg
      ref={svgRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-vetra-primary" />
        </marker>
      </defs>
      {paths.map((p) => (
        <g key={p.key}>
          <path
            d={p.d}
            fill="none"
            strokeWidth={1.75}
            markerEnd={`url(#${markerId})`}
            className="stroke-vetra-primary"
          />
          {p.label ? (
            <g>
              <rect
                x={p.labelX - labelWidth(p.label) / 2}
                y={p.labelY - 9}
                width={labelWidth(p.label)}
                height={18}
                rx={9}
                className="fill-card stroke-vetra-primary"
                strokeWidth={1}
              />
              <text
                x={p.labelX}
                y={p.labelY}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground text-[11px] font-medium"
              >
                {p.label}
              </text>
            </g>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
