/** Sections a tour step can live in — mirrors VetraStudio's `Section` (minus the
 * ones the tour doesn't visit). Kept local so the tour module is self-contained. */
export type TourSection = "home" | "ideate" | "specify" | "build" | "deploy";

/** One tour stop: the `data-tour` anchor to highlight, the section it lives in
 * (drives navigation), and a very condensed "what it is / why it matters" blurb. */
export type TourStep = {
  anchor: string;
  section: TourSection;
  title: string;
  blurb: string;
};

/**
 * The product tour: a small map across phases that highlights the model/document
 * buttons the agent produces in each stage. Anchors are `data-tour` values set on
 * the real elements; a step whose anchor isn't mounted degrades to a centered
 * popover (see useProductTour), so the tour never wedges on an empty drive.
 */
export const TOUR_STEPS: TourStep[] = [
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
    anchor: "model-document-model",
    section: "specify",
    title: "Document Model",
    blurb:
      "The schema and operations behind your app's data: it defines what can be stored and how it changes. This is the backbone the editors and app are generated from.",
  },
];
