/**
 * The one-time arrival (spec §5.5): `Your product is live.` with the address,
 * `Copy link`, the access sentence and `Change who can use it`. Seen once per
 * Studio and version (localStorage); a later visit gets the compact
 * `Went live <n> min ago` line instead — never the full banner again.
 */
import { useEffect, useState } from "react";
import {
  ANYONE_WITH_THE_LINK,
  CHANGE_WHO_CAN_USE_IT,
  COPY_LINK,
  LINK_COPIED,
  YOUR_PRODUCT_IS_LIVE,
  liveHost,
  wentLiveAgo,
} from "./liveCopy.js";

const SEEN_PREFIX = "vetra-studio:live-seen:";

function seenKey(studioId: string, version: number): string {
  return `${SEEN_PREFIX}${studioId}:${version}`;
}

function seenBefore(studioId: string, version: number): boolean {
  try {
    return window.localStorage.getItem(seenKey(studioId, version)) === "1";
  } catch {
    // Blocked storage: the banner shows again rather than never showing.
    return false;
  }
}

function markSeen(studioId: string, version: number): void {
  try {
    window.localStorage.setItem(seenKey(studioId, version), "1");
  } catch {
    // Blocked storage: the banner lasts for this visit only.
  }
}

/** Copies the address; false when the browser refused. */
async function copyLiveLink(liveUrl: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(liveUrl);
    return true;
  } catch {
    // No clipboard API (or a refused write): the old selection trick.
    const area = document.createElement("textarea");
    area.value = liveUrl;
    area.setAttribute("aria-hidden", "true");
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export function LiveBanner({
  studioId,
  version,
  liveSince,
  liveUrl,
  now,
  onOpenAccess,
}: {
  /** The Studio (its drive): the banner is remembered per Studio + version. */
  studioId: string;
  version: number;
  liveSince: string | null;
  liveUrl: string;
  now: Date;
  /** Opens Settings on the access switch ("Change who can use it"). */
  onOpenAccess: () => void;
}) {
  // Read once at mount: the banner stays up for this visit, and the next
  // visit to this Studio + version gets the compact line.
  const [alreadySeen] = useState(() => seenBefore(studioId, version));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!alreadySeen) markSeen(studioId, version);
  }, [alreadySeen, studioId, version]);

  if (alreadySeen) {
    return (
      <p
        data-banner="went-live"
        className="shrink-0 px-4 pt-3 text-xs text-muted-foreground"
      >
        {wentLiveAgo(liveSince, now)}
      </p>
    );
  }

  return (
    <div
      data-banner="live"
      role="status"
      className="m-4 shrink-0 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm"
    >
      <p className="font-semibold text-foreground">{YOUR_PRODUCT_IS_LIVE}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-vetra-primary hover:underline"
        >
          {liveHost(liveUrl)} ↗
        </a>
        <button
          type="button"
          onClick={() => {
            void copyLiveLink(liveUrl).then((ok) => {
              if (ok) setCopied(true);
            });
          }}
          className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          {copied ? LINK_COPIED : COPY_LINK}
        </button>
        <span className="text-muted-foreground">{ANYONE_WITH_THE_LINK}</span>
        <button
          type="button"
          onClick={onOpenAccess}
          className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          {CHANGE_WHO_CAN_USE_IT}
        </button>
      </div>
    </div>
  );
}
