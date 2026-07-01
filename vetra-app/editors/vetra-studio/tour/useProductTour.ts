import { useEffect, useMemo, useRef } from "react";
import { driver, type Driver } from "driver.js";
import { TOUR_STEPS, type TourSection } from "./steps.js";
// driver.js base CSS is imported in style.css (bundled with the tour theme).

const sel = (anchor: string) => `[data-tour="${anchor}"]`;

/** Resolve once the selector is in the DOM (or null after `timeout`) — covers the
 * gap while a newly-navigated section mounts its content. */
function waitForElement(selector: string, timeout = 1500): Promise<Element | null> {
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
 * The "Meet the models" product tour. Returns `startTour`, which walks
 * {@link TOUR_STEPS}: each stop navigates to its section (via `setSection`),
 * waits for the anchor to mount, then highlights it with a condensed popover.
 * A missing anchor degrades to a centered popover rather than wedging the tour.
 */
export function useProductTour(setSection: (section: TourSection) => void): {
  startTour: () => void;
} {
  const driverRef = useRef<Driver | null>(null);

  const api = useMemo(() => {
    // Navigate to a step's section, let it mount, then highlight it.
    async function goTo(index: number, d: Driver) {
      const step = TOUR_STEPS[index];
      setSection(step.section);
      await waitForElement(sel(step.anchor));
      d.moveTo(index);
    }

    function build(): Driver {
      return driver({
        showProgress: true,
        allowClose: true,
        // Block clicks on the highlighted button (no accidental create/open
        // mid-tour); clicking the dimmed overlay still dismisses.
        disableActiveInteraction: true,
        overlayColor: "rgba(0, 0, 0, 0.6)",
        popoverClass: "vetra-tour",
        steps: TOUR_STEPS.map((s) => ({
          element: sel(s.anchor),
          popover: {
            title: s.title,
            description: s.blurb,
            side: "right" as const,
            align: "start" as const,
          },
        })),
        // Custom hooks suppress auto-advance so we can navigate + wait first.
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
      const d = build();
      driverRef.current = d;
      const first = TOUR_STEPS[0];
      setSection(first.section);
      await waitForElement(sel(first.anchor));
      d.drive(0);
    }

    return { startTour };
  }, [setSection]);

  useEffect(() => () => driverRef.current?.destroy(), []);

  return api;
}
