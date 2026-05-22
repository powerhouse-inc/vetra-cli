/* Lightweight "did you mean?" support — fuzzy matching against a known set of
 * names. Used wherever the CLI rejects an input value and can hint at the
 * intended one (spec names, document types, action names, project dirs). */

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Pick the closest matches for `query` from `candidates`, ranked by edit
 * distance. Substring hits bypass the distance threshold so partial typed
 * tokens (`editor` → `Workout Tracker Editor`) still surface. Subsequence
 * hits (dropped-chunk case like `SET_NAME` → `SET_SUBGRAPH_NAME`) are scored
 * by the length gap, weaker than substring.
 */
export function suggestNames(
  query: string,
  candidates: string[],
  max = 3,
): string[] {
  const q = query.toUpperCase();
  const scored = candidates.map((c) => {
    const u = c.toUpperCase();
    /* Containment in either direction is the strongest signal — substring is
     * contiguous (`editor` → `Workout Tracker Editor`), subsequence is the
     * dropped-chunk form (`SET_NAME` → `SET_SUBGRAPH_NAME`). Both bypass the
     * edit-distance threshold; pure Levenshtein hits below pay it. */
    if (u.includes(q) || q.includes(u)) {
      return { name: c, d: 0, strong: true as const };
    }
    const subseq =
      u.length >= q.length
        ? isSubsequence(q, u)
        : isSubsequence(u, q);
    if (subseq) {
      return { name: c, d: Math.abs(u.length - q.length), strong: true as const };
    }
    return { name: c, d: editDistance(q, u), strong: false as const };
  });
  const threshold = Math.max(3, Math.ceil(q.length * 0.6) + 3);
  const filtered = scored.filter((s) => s.strong || s.d <= threshold);
  filtered.sort((a, b) => a.d - b.d || a.name.localeCompare(b.name));
  return filtered.slice(0, max).map((s) => s.name);
}
