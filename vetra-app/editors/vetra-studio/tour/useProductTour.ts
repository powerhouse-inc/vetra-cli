import { useEffect, useMemo, useRef } from "react";
import { driver, type Driver } from "driver.js";
import { baseDriverConfig } from "./constants.js";
import { TOUR_STEPS, type TourStep } from "./steps.js";
// driver.js base CSS is imported in style.css (bundled with the tour theme).

/** Studio actions the tour drives to stage each step's UI state. */
export type TourControls = {
  setSection: (section: NonNullable<TourStep["section"]>) => void;
  /** Deselect any open session so the sessions list (with "+ New") shows. */
  deselectSession: () => void;
  /** Open an existing session by id (re-opening the tour's cached session). */
  selectSession: (id: string) => void;
  /** Create + open a fresh chat session so the chat input renders; returns its id. */
  openNewSession: () => Promise<string>;
  /** Close any open document so the section grids (and their anchors) render. */
  closeDocument: () => void;
};

const dataSel = (anchor: string) => `[data-tour="${anchor}"]`;

/** A step's DOM target: raw selector wins, else the data-tour anchor, else none. */
function stepSelector(step: TourStep): string | undefined {
  if (step.selector) return step.selector;
  if (step.anchor) return dataSel(step.anchor);
  return undefined;
}

/** Resolve once the selector is in the DOM (or null after `timeout`) — covers the
 * gap while a newly-navigated section or freshly-opened session mounts. */
function waitForElement(selector: string, timeout = 4000): Promise<Element | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (performance.now() - start > timeout) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * The product tour. Returns `startTour`, which walks {@link TOUR_STEPS}: each
 * stop stages its UI (left-pane session state + main section), waits for its
 * target to mount, then highlights it with a condensed popover. A missing target
 * degrades to a centered popover rather than wedging the tour.
 */
export function useProductTour(controls: TourControls): { startTour: () => void } {
  const driverRef = useRef<Driver | null>(null);
  // One fresh session per tour run, cached so revisiting the input step (prev/next)
  // reuses it instead of creating another.
  const sessionIdRef = useRef<string | null>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const api = useMemo(() => {
    // Stage a step's UI state (session pane + section) and wait for its target
    // to mount — without highlighting yet. Staging is best-effort: a failure
    // (e.g. session creation rejects) just means the step's anchor won't mount
    // and the popover centers instead of wedging the tour.
    async function stage(index: number) {
      const step = TOUR_STEPS[index];
      const c = controlsRef.current;

      try {
        c.closeDocument();
        if (step.session === "none") {
          c.deselectSession();
        } else if (step.session === "new") {
          // Create the fresh session once; on later visits just re-open it.
          if (!sessionIdRef.current)
            sessionIdRef.current = await c.openNewSession();
          else c.selectSession(sessionIdRef.current);
        }
        if (step.section) c.setSection(step.section);
      } catch {
        // fall through to the centered-popover degradation
      }

      const selector = stepSelector(step);
      if (selector) await waitForElement(selector);
    }

    // Stage then highlight (for prev/next while the driver is already active).
    // The in-flight guard drops clicks that land while a step is still staging
    // (a double-click would otherwise stage twice, creating two sessions).
    let staging = false;
    async function goTo(index: number, d: Driver) {
      if (staging) return;
      staging = true;
      try {
        await stage(index);
        // The user may have dismissed the tour (Esc / overlay) mid-stage.
        if (d.isActive()) d.moveTo(index);
      } finally {
        staging = false;
      }
    }

    function build(): Driver {
      return driver({
        ...baseDriverConfig,
        // Block clicks on the highlighted element (no accidental create/open
        // mid-tour); clicking the dimmed overlay still dismisses.
        disableActiveInteraction: true,
        steps: TOUR_STEPS.map((s) => ({
          element: stepSelector(s),
          popover: {
            title: s.title,
            description: s.blurb,
            side: "right" as const,
            align: "start" as const,
          },
        })),
        // Custom hooks suppress auto-advance so we can stage + wait first.
        onNextClick: (_el, _step, { driver: d }) => {
          const i = d.getActiveIndex() ?? 0;
          if (i >= TOUR_STEPS.length - 1) {
            d.destroy();
            return;
          }
          void goTo(i + 1, d);
        },
        onPrevClick: (_el, _step, { driver: d }) => {
          const i = d.getActiveIndex() ?? 0;
          if (i <= 0) return;
          void goTo(i - 1, d);
        },
      });
    }

    async function startTour() {
      driverRef.current?.destroy();
      sessionIdRef.current = null; // fresh session per run
      const d = build();
      driverRef.current = d;
      await stage(0);
      // A re-click mid-stage replaces the driver; don't drive the stale one.
      if (driverRef.current === d) d.drive(0);
    }

    return { startTour };
  }, []);

  useEffect(() => () => driverRef.current?.destroy(), []);

  return api;
}
