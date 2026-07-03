import { useEffect, useState } from "react";
import { GraduationCap, X } from "lucide-react";
import { LESSONS } from "./tour/lessons.js";
import { runLesson, stopLesson } from "./tour/runLesson.js";

/**
 * A dismissible floating card that turns agent wait-time into learning: when the
 * agent is actively working on a document type with a {@link LESSONS} entry, it
 * offers that lesson. Non-blocking (agent progress stays visible behind it) and
 * dismissible per document type for the session — dismissing "Document Models"
 * won't re-offer it, but a different type still can.
 */
export function LearnWhileYouWait({
  activeDocumentType,
}: {
  activeDocumentType: string | null;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // The lesson overlay lives on document.body, outside React — tear it down
  // when the Studio unmounts so it can't be left blocking the app.
  useEffect(() => () => stopLesson(), []);

  const lesson = activeDocumentType ? LESSONS[activeDocumentType] : undefined;
  if (!activeDocumentType || !lesson || dismissed.has(activeDocumentType)) {
    return null;
  }

  const dismiss = () =>
    setDismissed((prev) => new Set(prev).add(activeDocumentType));
  const start = () => {
    runLesson(lesson);
    dismiss();
  };

  return (
    <div className="absolute bottom-4 right-4 z-20 w-72 rounded-xl border border-border bg-card p-4 shadow-lg">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X size={14} />
      </button>
      <div className="flex items-start gap-2.5">
        <GraduationCap size={18} className="mt-0.5 shrink-0 text-vetra-primary" />
        <div className="flex flex-col items-start gap-2 pr-2">
          <p className="text-sm text-foreground">{lesson.teaser}</p>
          <button
            type="button"
            onClick={start}
            className="rounded-md bg-vetra-primary px-2.5 py-1 text-xs font-medium text-vetra-primary-fg transition-opacity hover:opacity-90"
          >
            Learn about {lesson.label}
          </button>
        </div>
      </div>
    </div>
  );
}
