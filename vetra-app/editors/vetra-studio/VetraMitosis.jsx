import { useEffect, useRef } from "react";

const PATHS = {
  tl: "M0 14.4433C0 6.46648 6.46657 0 14.4435 0L80.9867 0C88.9636 0 95.4302 6.46649 95.4302 14.4433V23.2125C95.4302 63.0965 63.0973 95.429 23.2127 95.429H14.4435C6.46656 95.429 0 88.9625 0 80.9857L0 14.4433Z",
  tr: "M105.36 14.4433C105.36 6.46648 111.827 0 119.804 0L186.347 0C194.324 0 200.791 6.46649 200.791 14.4433V80.9857C200.791 88.9625 194.324 95.429 186.347 95.429H177.578C137.693 95.429 105.36 63.0965 105.36 23.2124V14.4433Z",
  bl: "M0.000976563 119.803C0.000976563 111.826 6.46754 105.359 14.4445 105.359H23.2137C63.0983 105.359 95.4311 137.692 95.4311 177.576V186.345C95.4311 194.322 88.9646 200.788 80.9876 200.788H14.4445C6.46754 200.788 0.000976563 194.322 0.000976563 186.345L0.000976563 119.803Z",
  br: "M105.36 177.578C105.36 137.694 137.693 105.361 177.578 105.361H186.347C194.324 105.361 200.791 111.828 200.791 119.805V186.347C200.791 194.324 194.324 200.79 186.347 200.79H119.804C111.827 200.79 105.36 194.324 105.36 186.347V177.578Z",
};

const SIGN = {
  tl: { x: -1, y: -1 },
  tr: { x: 1, y: -1 },
  bl: { x: -1, y: 1 },
  br: { x: 1, y: 1 },
};

const GUTTER = 9.93;
const off = (gap) => (gap - GUTTER) / 2;

const FRAMES = {
  blob: { gapX: -42, gapY: -42 },
  twoV: { gapX: 15, gapY: -30 },
  logo: { gapX: 15, gapY: 15 },
  twoH: { gapX: -30, gapY: 15 },
};

const SEQ = [
  { frame: "blob", hold: 520, trans: 0 },
  { frame: "twoV", hold: 300, trans: 480 },
  { frame: "logo", hold: 680, trans: 440 },
  { frame: "twoH", hold: 300, trans: 480 },
  { frame: "blob", hold: 520, trans: 500 },
];

function poseFromFrame(f) {
  const ox = off(f.gapX);
  const oy = off(f.gapY);
  const p = {};
  for (const k in SIGN) p[k] = [SIGN[k].x * ox, SIGN[k].y * oy];
  return p;
}

function easeOutBack(t, k = 1.6) {
  const c1 = k;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
const lerp = (a, b, t) => a + (b - a) * t;

const LOGO_POSE = poseFromFrame(FRAMES.logo);

// faint idle breathe
const IDLE_BREATHE_AMP = 0.02; // 2% scale pulse
const IDLE_BREATHE_SPEED = 1.5; // rad/s (~4s period)

export default function VetraMitosis({ size = 120, color = "#04C161", active = true }) {
  const refs = useRef({});
  const rafRef = useRef(null);
  const activeRef = useRef(active);

  // keep the latest `active` value readable inside the animation loop
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const poses = SEQ.map((s) => poseFromFrame(FRAMES[s.frame]));

    const timeline = [];
    let clock = 0;
    let logoResumeAt = 0;
    for (let i = 0; i < SEQ.length; i++) {
      const s = SEQ[i];
      const from = i === 0 ? poses[poses.length - 1] : poses[i - 1];
      const to = poses[i];
      if (s.trans > 0) {
        timeline.push({ t0: clock, t1: clock + s.trans, type: "trans", from, to });
        clock += s.trans;
      }
      const holdStart = clock;
      timeline.push({ t0: clock, t1: clock + s.hold, type: "hold", pose: to });
      clock += s.hold;
      if (s.frame === "logo") logoResumeAt = holdStart;
    }
    const LOOP = clock;

    // current applied pose + scale (mutated each frame so idle settle is graceful)
    const cur = {};
    for (const k in SIGN) cur[k] = [LOGO_POSE[k][0], LOGO_POSE[k][1]];
    let curScale = 1;

    const apply = (k, tx, ty, sc) => {
      const el = refs.current[k];
      if (el) el.style.transform = `translate(${tx}px,${ty}px) rotate(180deg) scale(${sc})`;
    };

    let t0 = null;
    let wasActive = activeRef.current;
    let resume = activeRef.current;

    function tick(ts) {
      const isActive = activeRef.current;

      if (isActive) {
        // detect idle -> active: resume the loop from the logo hold moment
        if (!wasActive || resume) {
          t0 = ts - logoResumeAt;
          resume = false;
        }
        const time = (ts - t0) % LOOP;
        for (const seg of timeline) {
          if (time >= seg.t0 && time < seg.t1) {
            if (seg.type === "hold") {
              const ht = (time - seg.t0) / (seg.t1 - seg.t0);
              curScale = 1 + Math.sin(ht * Math.PI * 2) * 0.012;
              for (const k in SIGN) {
                cur[k][0] = seg.pose[k][0];
                cur[k][1] = seg.pose[k][1];
              }
            } else {
              const e = easeOutBack((time - seg.t0) / (seg.t1 - seg.t0));
              curScale = 1;
              for (const k in SIGN) {
                cur[k][0] = lerp(seg.from[k][0], seg.to[k][0], e);
                cur[k][1] = lerp(seg.from[k][1], seg.to[k][1], e);
              }
            }
            break;
          }
        }
      } else {
        // idle: smoothly settle toward the logo pose, then a faint breathe
        const s = 0.12;
        for (const k in SIGN) {
          cur[k][0] += (LOGO_POSE[k][0] - cur[k][0]) * s;
          cur[k][1] += (LOGO_POSE[k][1] - cur[k][1]) * s;
        }
        const breathe = 1 + Math.sin((ts / 1000) * IDLE_BREATHE_SPEED) * IDLE_BREATHE_AMP;
        curScale += (breathe - curScale) * s;
      }

      for (const k in SIGN) apply(k, cur[k][0], cur[k][1], curScale);
      wasActive = isActive;
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 201 201"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      {Object.keys(PATHS).map((k) => (
        <g
          key={k}
          ref={(el) => (refs.current[k] = el)}
          style={{ transformBox: "fill-box", transformOrigin: "center", transform: "rotate(180deg)" }}
        >
          <path d={PATHS[k]} fill={color} />
        </g>
      ))}
    </svg>
  );
}
