/**
 * Contextual "learn while you wait" lessons, keyed by the documentType the agent
 * is actively working on. A lesson is a short sequence of centered popovers (we
 * don't control the external editors' DOM, so lessons are conceptual) that teach
 * the idea behind the document being built, closing with an Academy link.
 */
import { ACADEMY_LEARN_URL } from "./constants.js";

export type LessonStep = {
  title: string;
  blurb: string; // rendered as HTML
  /** Optional CSS selector to anchor on; omitted → centered popover. */
  selector?: string;
};

export type Lesson = {
  /** Short label for the affordance, e.g. the card heading. */
  label: string;
  /** One-line teaser shown on the floating card. */
  teaser: string;
  steps: LessonStep[];
};

/** documentType → lesson. Document Model only for now; more types to follow. */
export const LESSONS: Record<string, Lesson> = {
  "powerhouse/document-model": {
    label: "Document Models",
    teaser: "New to document models? Learn while the agent works.",
    steps: [
      {
        title: "What's a Document Model?",
        blurb:
          "A <b>Document Model</b> is the schema for one kind of data in your app — the fields it holds and the operations that can change it. The editors, the app, and the API are all generated from it.",
      },
      {
        title: "State is an operation log",
        blurb:
          "Powerhouse doesn't mutate data in place. Every change is an <b>operation</b> appended to a log, and a <b>reducer</b> applies it. That log is what makes history, undo, and real-time collaboration work.",
      },
      {
        title: "Schema + operations",
        blurb:
          "So a document model has two halves: the <b>state schema</b> (what can be stored) and the <b>operations</b> (how it changes). That's exactly what the agent is defining right now.",
      },
      {
        title: "Go deeper",
        blurb:
          "The Vetra Academy's <i>Learn the Powerhouse stack</i> track walks through document models, reducers, and editors — each chapter ends with a quiz. " +
          `<a href="${ACADEMY_LEARN_URL}" target="_blank" rel="noopener">Learn more</a>`,
      },
    ],
  },
};
