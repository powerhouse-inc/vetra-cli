import type { DocumentDriveDocument } from "@powerhousedao/shared/document-drive";
import type { StudioProductState } from "document-models/studio-product";
import { GithubStatusLine } from "../github/GithubStatusLine.js";
import { deployedAgo } from "../strip/stripModel.js";

/** Where the code is saved (spec §5.2, Task 4.5). */
export const LIVE_GITHUB_TEXT =
  "Keep a copy of your code in your own GitHub account. Every launch becomes a commit you can see.";

/**
 * Live step detail (spec §5.2): the live address, the last launch, the
 * versions and where the code is saved.
 */
export function LiveDetail({
  product,
  productId,
  drive,
  now,
}: {
  product: StudioProductState | null;
  productId?: string | null;
  drive?: DocumentDriveDocument;
  now: Date;
}) {
  const live =
    product?.liveVersion != null
      ? product.versions.find((v) => v.number === product.liveVersion)
      : undefined;

  if (!product || !live) {
    return (
      <section aria-label="Live" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Not live yet
        </h2>
        <p className="text-sm text-muted-foreground">
          Your product goes live by itself once its checks pass.
        </p>
      </section>
    );
  }

  const versions = [...product.versions].sort((a, b) => b.number - a.number);
  return (
    <section aria-label="Live" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {product.liveUrl ? (
          <a
            href={product.liveUrl}
            target="_blank"
            rel="noreferrer"
            className="text-base font-semibold text-vetra-primary hover:underline"
          >
            {product.liveUrl.replace(/^https?:\/\//, "")} ↗
          </a>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Version {live.number} · {deployedAgo(live.launchedAt ?? null, now)}
        </p>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">{LIVE_GITHUB_TEXT}</p>
        <p className="text-muted-foreground">
          <GithubStatusLine
            product={product}
            productId={productId ?? null}
            drive={drive}
          />
        </p>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Versions</h3>
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {versions.map((v) => (
            <li key={v.number}>
              <span aria-hidden>{v.number === live.number ? "● " : "  "}</span>
              Version {v.number} — {v.title}
              {v.number === live.number ? " · Live" : ""}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
