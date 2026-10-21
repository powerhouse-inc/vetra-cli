/**
 * "Bring in your rows" (spec §5.6): once a sheet's import file exists and the
 * product is live, the card offers the customer's real rows with the mapping
 * the agent wrote. It shows progress and can be put off for this visit.
 */
import { useState } from "react";
import type { ImportOffer } from "../hooks/workshop-client.js";
import { useT } from "../i18n/useT.js";

function hiddenKey(file: string): string {
  return `vetra-studio:row-import-hidden:${file}`;
}

export function RowImportCard({
  offer,
  onRun,
}: {
  offer: ImportOffer;
  onRun: (file: string) => Promise<{ imported: number; failed: number }>;
}) {
  const { t } = useT();
  const [hidden, setHidden] = useState(() => {
    try {
      return window.sessionStorage.getItem(hiddenKey(offer.file)) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(offer.done);
  const [failed, setFailed] = useState(false);

  if (hidden || offer.rows === 0) return null;

  async function run(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      const result = await onRun(offer.file);
      setDone(result.imported);
      setFailed(result.failed > 0);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function later(): void {
    try {
      window.sessionStorage.setItem(hiddenKey(offer.file), "1");
    } catch {
      // Blocked storage: it comes back on the next visit.
    }
    setHidden(true);
  }

  return (
    <section
      aria-label={t("rowImport.title", {
        rows: offer.rows,
        sheet: offer.sheet,
      })}
      className="mx-4 mb-3 shrink-0 rounded-xl border border-border bg-card p-4 text-foreground shadow-sm"
    >
      <h2 className="text-sm font-semibold">
        {offer.rows === 1
          ? t("rowImport.titleOne", { sheet: offer.sheet })
          : t("rowImport.title", {
              rows: offer.rows,
              sheet: offer.sheet,
            })}
      </h2>
      <table className="mt-2 text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-0.5 text-left font-medium">
              {t("rowImport.column")}
            </th>
            <th className="px-2 py-0.5 text-left font-medium">
              {t("rowImport.field")}
            </th>
          </tr>
        </thead>
        <tbody>
          {offer.mapping.map((m, i) => (
            <tr key={`${m.column}-${m.field}-${i}`}>
              <td className="px-2 py-0.5">{m.column}</td>
              <td className="px-2 py-0.5">{m.field}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="rounded-full border border-vetra-primary bg-vetra-primary/10 px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {t("rowImport.run")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={later}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          {t("rowImport.later")}
        </button>
        {done > 0 && done < offer.rows ? (
          <span className="text-xs text-muted-foreground">
            {t("rowImport.progress", { done, rows: offer.rows })}
          </span>
        ) : null}
        {failed ? (
          <span className="text-xs text-destructive">
            {t("rowImport.failed")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
