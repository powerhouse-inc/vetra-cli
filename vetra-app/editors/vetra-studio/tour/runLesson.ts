import { driver } from "driver.js";
import { baseDriverConfig } from "./constants.js";
import type { Lesson } from "./lessons.js";
// driver.js base CSS + .vetra-tour theme live in style.css.

/** Run a lesson as a sequence of driver.js popovers (centered unless a step has
 * a selector). Reuses the shared `vetra-tour` popover theme. */
export function runLesson(lesson: Lesson): void {
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
  });
  d.drive();
}
