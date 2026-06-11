# VetraMitosis — Animated Logo Component (Handover)

Self-contained, dependency-free React component. Animates the four-quadrant Vetra
logo through a looping "cell mitosis" sequence. Intended use: animated agent
profile picture / loading indicator.

File: `VetraMitosis.jsx`

## Usage

```jsx
import VetraMitosis from "./VetraMitosis";

<VetraMitosis size={48} active={isThinking} />
```

### Props
| Prop     | Type    | Default     | Description |
|----------|---------|-------------|-------------|
| `size`   | number  | `120`       | Width/height in px. viewBox is fixed, scales cleanly. |
| `color`  | string  | `"#04C161"` | Fill color (Vetra green). |
| `active` | boolean | `true`      | `true` = loops the mitosis animation. `false` = settles onto the logo pose and does a faint idle breathe. |

Typical agent wiring: tie `active` to the agent's working state
(`active={thinking}`), flip freely — transitions are graceful in both directions.

## How it works

### The four shapes
The logo is four SVG `<path>` quadrants (`tl`, `tr`, `bl`, `br`). Each is rendered
inside a `<g>` with `transform-box: fill-box; transform-origin: center` so it can be
translated/scaled about its own center.

Each `<g>` carries a permanent `rotate(180deg)`. This is load-bearing: rotating
180° makes each quadrant's large rounded curve face OUTWARD and its sharp corner
face the center. That's what lets the four pieces overlap into a clean round blob,
and it is the fixed orientation for every frame (no rotation animation occurs).

### Gap-based frame system
The natural gutter between two adjacent quadrants is **9.93px** (in viewBox units).
Any target gap is achieved by offsetting each piece from its natural position:

```
offset_per_piece = (targetGap - 9.93) / 2     // negative gap = overlap
```

Frames are defined purely by horizontal/vertical gaps in the `FRAMES` config:

```js
const FRAMES = {
  blob: { gapX: -42, gapY: -42 },  // heavy overlap -> solid round blob
  twoV: { gapX:  15, gapY: -30 },  // two vertical halves (15px apart, merged pills)
  logo: { gapX:  15, gapY:  15 },  // the four-quadrant Vetra mark, 15px cross
  twoH: { gapX: -30, gapY:  15 },  // two horizontal halves (15px apart, merged pills)
};
```
- `gapX` = horizontal gap between the left column (tl,bl) and right column (tr,br)
- `gapY` = vertical gap between the top row (tl,tr) and bottom row (bl,br)
- Negative = pieces overlap/merge; positive = visible gap.
- `SIGN` maps each piece to its quadrant direction so one gap value drives all four.

### Animation loop
`SEQ` lists the keyframe order and timing (ms):

```js
const SEQ = [
  { frame: "blob", hold: 520, trans: 0   },
  { frame: "twoV", hold: 300, trans: 480 },
  { frame: "logo", hold: 680, trans: 440 },
  { frame: "twoH", hold: 300, trans: 480 },
  { frame: "blob", hold: 520, trans: 500 },
];
```
`hold` = dwell time on a pose. `trans` = transition duration INTO that pose from
the previous one. A flat `timeline` of `{t0, t1, type}` segments is precomputed once;
the `requestAnimationFrame` loop finds the active segment by `time % LOOP`.

- Transitions use `easeOutBack` (overshoot) for the "snap into place" mitosis feel.
- Holds apply a tiny sine scale pulse (~1.2%) so poses never look frozen.

### active / idle behavior
- A single rAF loop runs for the component's life. It reads `activeRef.current`
  each frame (kept in sync with the `active` prop via a separate effect).
- **active**: drives position/scale from the timeline.
- **idle**: exponentially eases the current pose toward `LOGO_POSE` (smoothing
  factor `0.12`) from wherever it was — no snap — then applies a faint idle breathe.
- **idle -> active**: resets the loop clock so playback resumes from the logo hold
  moment (`logoResumeAt`), avoiding a jump.

### Idle breathe constants
```js
const IDLE_BREATHE_AMP   = 0.02;  // 2% scale pulse
const IDLE_BREATHE_SPEED = 1.5;   // rad/s, ~4s period
```

## Tuning cheatsheet
- **Gaps / pose shapes** → edit `FRAMES` (values are literal viewBox px gaps).
- **Speed / rhythm** → edit `hold` and `trans` in `SEQ`.
- **Snap intensity** → `easeOutBack` `k` arg (higher = more overshoot).
- **Blob roundness** → `blob` gaps (more negative = tighter/rounder; -42 = clean circle).
- **Idle feel** → `IDLE_BREATHE_AMP` / `IDLE_BREATHE_SPEED`, or smoothing `s = 0.12`.
- **Color** → `color` prop. Green is `#04C161` (~`hsl(148, 96%, 39%)`).

## Notes / gotchas
- The permanent `rotate(180deg)` on each `<g>` must be preserved in `apply()` —
  every transform string re-includes it. Remove it and the blob loses its round silhouette.
- `overflow: visible` on the `<svg>` is required; pieces translate beyond the viewBox
  during the blob/halves poses.
- No external dependencies, no browser storage, no timers besides rAF. Cleans up on unmount.
- viewBox is `0 0 201 201`; all geometry constants (9.93 gutter, gap values) are in
  those units, independent of the rendered `size`.

## A standalone HTML version also exists
`vetra-mitosis.html` — same logic in vanilla JS (no active/idle prop; loops only).
Useful for static embeds. If you need the active/idle + breathe there, port the
`activeRef`/idle-settle block from the JSX.
