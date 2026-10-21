import fs from "node:fs";
import path from "node:path";

const ROOTS = ["editors", "apps"];

function sources(dir: string): string {
  let out = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out += sources(abs);
    else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) {
      out += fs.readFileSync(abs, "utf8") + "\n";
    }
  }
  return out;
}

/**
 * Editor/app root files whose module has no `data-vetra-component` marker
 * (drive apps also need `data-vetra-app`). Markers may sit in any component
 * file of the editor's folder, since an app's `editor.tsx` only wraps its UI.
 */
export function missingMarkers(projectPath: string): string[] {
  const missing: string[] = [];
  for (const root of ROOTS) {
    const base = path.join(projectPath, root);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(base, entry.name);
      const rootFile = path.join(dir, "editor.tsx");
      if (!fs.existsSync(rootFile)) continue;
      const rootSrc = fs.readFileSync(rootFile, "utf8");
      const all = sources(dir);
      const isApp = rootSrc.includes("useSetPHAppConfig");
      if (!all.includes("data-vetra-component") || (isApp && !all.includes("data-vetra-app"))) {
        missing.push(`${root}/${entry.name}/editor.tsx`);
      }
    }
  }
  return missing.sort();
}
