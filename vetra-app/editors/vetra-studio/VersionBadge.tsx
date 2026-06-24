// Subtle info button in the studio header; click reveals vetra-cli + ph
// versions. Fetched once from /version; button absent until resolved.
import { useEffect, useRef, useState } from "react";
import {
  fetchVersion,
  type VersionInfo,
} from "./hooks/preview-server-client.js";

export function VersionBadge() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchVersion(controller.signal)
      .then(setInfo)
      .catch(() => {
        // Daemon unreachable or aborted on unmount — leave the button absent.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!info) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Version info"
        aria-label="Version info"
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100"
      >
        <InfoIcon />
      </button>
      {open ? (
        <div className="absolute left-0 top-7 z-10 whitespace-nowrap rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-md">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">vetra-cli</span>
            <span className="font-mono text-foreground">{info.vetraCli}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">ph</span>
            <span className="font-mono text-foreground">{info.ph}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 7.25v3.25M8 5.25v.01"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
