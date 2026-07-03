import { ACADEMY_LEARN_URL } from "./constants.js";

/** Sections a tour step can live in — mirrors VetraStudio's `Section` (minus the
 * ones the tour doesn't visit). Kept local so the tour module is self-contained. */
export type TourSection = "home" | "ideate" | "specify" | "build" | "deploy";

/**
 * One tour stop. The target is a `data-tour` anchor or a raw `selector`
 * (`selector` wins); a step with neither is a centered popover. `section` and
 * `session` are staged before the step is highlighted — `section` navigates the
 * main pane, `session` sets the left pane (show the sessions list / open a fresh
 * session so the chat input exists). `blurb` is rendered as HTML.
 */
export type TourStep = {
  anchor?: string;
  selector?: string;
  section?: TourSection;
  session?: "none" | "new";
  title: string;
  blurb: string;
};

/**
 * The product tour: opens with how to start (new chat → describe it → example),
 * walks the model/document outputs of each stage, then Build and Deploy, and
 * closes by pointing at the Academy. Anchors that aren't mounted degrade to a
 * centered popover (see useProductTour), so the tour never wedges.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    anchor: "new-session",
    section: "home",
    session: "none",
    title: "Start a new product",
    blurb:
      "Every product starts with a chat. Hit <b>+ New</b> to open a fresh session, then tell the agent what you want to build.",
  },
  {
    selector: '[data-tour="chat-pane"] textarea',
    session: "new",
    title: "Describe what you want",
    blurb:
      "Describe your product in plain language right here. The agent turns your request into documents — and eventually a running app.",
  },
  {
    anchor: "example-prompt",
    section: "home",
    title: "Not sure where to start?",
    blurb:
      "Try an example like this — paste it in and the agent takes it from there.",
  },
  {
    anchor: "flow",
    section: "home",
    title: "How Vetra builds your product",
    blurb:
      "Vetra works in four stages — Ideate, Specify, Build, Deploy. Each stage produces documents the next builds on; this quick tour shows the key ones.",
  },
  {
    anchor: "model-brand-sheet",
    section: "ideate",
    title: "Brand Sheet",
    blurb:
      "Captures your product's identity — name, tone, and positioning — so everything the agent generates stays on-brand.",
  },
  {
    anchor: "model-problem-sheet",
    section: "ideate",
    title: "Problem Sheet",
    blurb:
      "States the problem you're solving and why it matters, keeping the build anchored to a real user need.",
  },
  {
    anchor: "model-audience-sheet",
    section: "ideate",
    title: "Audience Sheet",
    blurb:
      "Describes who you're building for, so features and language fit the people who'll actually use it.",
  },
  {
    anchor: "model-wbs",
    section: "ideate",
    title: "Work Breakdown Structure",
    blurb:
      "Turns features into a table-ready breakdown of work — the checklist the agent implements against.",
  },
  {
    anchor: "specify",
    section: "specify",
    title: "Document Models",
    blurb:
      "This is the Specify stage. Your app's <b>Document Models</b> take shape here — each defines the schema and operations behind your data, the backbone the editors and app are generated from. They'll appear in this panel as the agent builds them.",
  },
  {
    anchor: "build-preview",
    section: "build",
    title: "Build — watch it come alive",
    blurb:
      "Build is where your specs become software: the agent generates each document model's editor and the drive-app, runs it, and shows you a live preview of the working product right here.",
  },
  {
    anchor: "deploy-projects",
    section: "deploy",
    title: "Deploy — ship it",
    blurb:
      "When it's ready, publish your package to the cloud and run it in your environments — your product becomes a live, shareable app for you and your team.",
  },
  {
    section: "home",
    title: "Keep learning",
    blurb:
      "Want to see how it all works under the hood? The Vetra Academy's <i>Learn the Powerhouse stack</i> track has eight short chapters, each ending with a quiz. " +
      `<a href="${ACADEMY_LEARN_URL}" target="_blank" rel="noopener">Start learning</a>`,
  },
];
