import type { StudioProductState } from "document-models/studio-product";
import { deployedAgo, githubText } from "../strip/stripModel.js";

/**
 * Live step detail (spec §5.2): the live address, the last launch, the
 * versions and where the code is saved.
 */
export function LiveDetail({
  product,
  now,
}: {
  product: StudioProductState | null;
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
          Version {live.number} · {deployedAgo(live.launchedAt ?? null, now)} ·{" "}
          {githubText(product.github.status)}
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
