import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { baseSaveToFile } from "document-model/node";
import { z } from "zod";
import { defineCommand } from "../../framework.js";
import { projectInputSchema, resolveReactorProjectPath } from "../../helpers/project.js";
import { getEmbeddedDrive } from "../../helpers/embedded-drive.js";
import { applyFsChangesToReactor } from "../../helpers/spec-drive-sync.js";
import { phBuildNodeOptions } from "../../helpers/node-memory.js";
import { loadSpecDocument } from "./registry.js";
import { slugify } from "./_helpers.js";

const typeSchema = z
  .enum(["all", "document-model", "editor", "app", "processor", "subgraph"])
  .default("all")
  .describe(
    'Which modules to extract. "all" (default) covers every type; or pick one.',
  );

// `ph generate <subcommand> --extract` writes a spec for each existing module
// into specs/ and logs `Wrote <path>` per file.
function extractCommand(type: z.infer<typeof typeSchema>): string {
  return type === "all"
    ? "ph generate all --extract"
    : `ph generate ${type} --extract`;
}

// Pull the `Wrote <path>` lines the extract subprocess prints.
function parseWritten(output: string): string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^Wrote\s+(.+)$/);
    if (m) paths.push(m[1].trim());
  }
  return paths;
}

// `ph generate --extract` doesn't seed header.slug; restore the slug invariant
// spec-create establishes, rewriting the file in place (same path).
async function backfillSlug(filePath: string): Promise<void> {
  const doc = await loadSpecDocument(filePath);
  if (doc.header.slug || !doc.header.name) return;
  doc.header.slug = slugify(doc.header.name);
  const parts = basename(filePath).split("."); // <name>.<ext>.phd
  if (parts.length < 3) return;
  await baseSaveToFile(doc, dirname(filePath), parts.at(-2)!, parts.slice(0, -2).join("."));
}

export const specExtract = defineCommand({
  id: "spec-extract",
  description: "Extract specs by reverse-engineering existing package source.",
  inputSchema: z.object({
    project: projectInputSchema,
    type: typeSchema,
  }),
  execute: async (input, context) => {
    const { workdir, runProcess } = context;
    const base = await resolveReactorProjectPath(workdir, input.project);

    const command = extractCommand(input.type);
    const { success, output } = await runProcess(command, {
      label: "ph-generate-extract",
      timeout: 120_000,
      cwd: base,
      env: { FORCE_COLOR: "1", NODE_OPTIONS: phBuildNodeOptions() },
    });

    // Sync what was written before surfacing a failure, so a partial extract
    // isn't lost from the drive.
    const written = parseWritten(output);
    for (const filePath of written) await backfillSlug(filePath);

    // realpath workdir: the subprocess emits realpath-resolved paths, which a
    // lexical workdir would drop to the drive root in projectForPath.
    const drive = await getEmbeddedDrive(context);
    if (drive && written.length > 0) {
      await applyFsChangesToReactor(
        written,
        await realpath(workdir),
        drive.reactor,
        drive.driveId,
        context.log,
      );
    }

    if (!success) {
      throw new Error(output);
    }

    return {
      text:
        written.length === 0
          ? "(no specs extracted)"
          : `Wrote ${written.length} spec(s):\n${written.join("\n")}`,
    };
  },
});
