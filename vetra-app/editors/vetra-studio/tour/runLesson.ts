import { driver, type Driver } from "driver.js";
import { baseDriverConfig } from "./constants.js";
import type { Lesson } from "./lessons.js";
// driver.js base CSS + .vetra-tour theme live in style.css.

// The running lesson's driver. Its overlay lives on document.body (outside
// React), so it must be destroyed explicitly when the Studio unmounts.
let activeLesson: Driver | null = null;

/** Run a lesson as a sequence of driver.js popovers (centered unless a step has
 * a selector). Reuses the shared `vetra-tour` popover theme. */
export function runLesson(lesson: Lesson): void {
  activeLesson?.destroy();
  const d = driver({
    ...baseDriverConfig,
    steps: lesson.steps.map((s) => ({
      element: s.selector,
      popover: {
        title: s.title,
        description: s.blurb,
        side: "left" as const,
        align: "start" as const,
      },
    })),
    onDestroyed: () => {
      if (activeLesson === d) activeLesson = null;
    },
  });
  activeLesson = d;
  d.drive();
}

/** Tear down the running lesson (if any) — call on Studio unmount. */
export function stopLesson(): void {
  activeLesson?.destroy();
  activeLesson = null;
}
