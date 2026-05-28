---
name: vetra-skill-authoring
description: Author or edit a vetra agent skill under `vetra-cli/prompts/skills-tpl/<skill>/` — `.preamble.md`, scenario refs, build pipeline, and the runtime `skill` / `skill_read` contract. Triggers on "edit skill", "the agent isn't reading <reference>", "skill preamble", "add a reference to <skill>", changes under `prompts/skills-tpl/`. NOT for Claude Code skills under `.claude/skills/` or generic prompt-engineering.
metadata:
  author: Powerhouse
  version: "0.2.0"
---

Vetra agent skills are loaded by Mastra at runtime through a
progressive-disclosure contract: the model gets the SKILL.md body plus a
**list of reference filenames** and must call `skill_read` to fetch any
reference content. A skill without a strong `.preamble.md` will be
treated as a bare TOC and the model will skip the references entirely.

## Layout

- `vetra-cli/prompts/skills-tpl/<skill>/` — editable source.
  - `.preamble.md` — becomes the SKILL.md body. **Optional but rarely should be omitted.**
  - `NN.<slug>.md` — scenario files. Become `references/NN.<slug>.md`. Numeric prefix controls TOC order.
  - `.result.md` — becomes `references/expected-outcome.md`.
  - `.cli-docs.md` — copied verbatim alongside SKILL.md (not surfaced to the agent as a reference).
- `vetra-cli/gen/skills/<skill>/` — generated. **Do not hand-edit.**
- `<project>/.ph/vetra/.mastra/skills/<skill>/` — installed copy inside each vetra workspace. Populated by `installSkills` (in `ph-clint/packages/ph-clint/src/core/init.ts`) at vetra workspace init, NOT on `reactor-project-init`. Refresh after a skill edit via `pnpm refresh:test-skills` (or re-create the workspace).

Builder: `.claude/ph-clint/packages/ph-clint-dev/src/skill-builder.ts`.
Mastra wiring: `.claude/ph-clint/packages/ph-clint/src/integrations/mastra/index.ts` (`createWorkspace` passes `skills: fullPaths.skillPaths` to `MastraWorkspace`) and `paths.ts` (resolves `.mastra/skills/<name>` + runtime `skills/**`). The `skill` / `skill_search` / `skill_read` tools themselves are provided by `@mastra/core` (`createSkillTools`) — third-party dep, no symlinked source in this workspace.

## Workflow

1. **Read the current state** before editing — both source and what the
   agent actually sees:

   ```bash
   ls vetra-cli/prompts/skills-tpl/<skill>/
   cat vetra-cli/prompts/skills-tpl/<skill>/.preamble.md 2>/dev/null || echo "(no preamble — SKILL.md will be a bare TOC)"
   cat vetra-cli/gen/skills/<skill>/SKILL.md
   ```

2. **Edit `.preamble.md` and the scenario refs.** Never patch the
   generated tree.

3. **Rebuild and diff:**

   ```bash
   cd vetra-cli && pnpm build:assets
   git diff gen/skills/<skill>/
   ```

4. **Refresh the installed copy** so the running reactor sees it.
   `pnpm refresh:test-skills` (defined in `vetra-cli/package.json`) does
   `pnpm build:assets` + clears + recopies `gen/skills/` into
   `vetra-test/.ph/vetra/.mastra/skills/`. Preserves session logs,
   reactor storage, and Mastra memory. Stop vetra first; the new copy
   is read on next start.

5. **Smoke-test in a fresh agent session.** Open a new VetraAgent thread
   and watch whether the model calls `skill_read` on the references your
   preamble names *before* the first `spec-*` tool call. The log is at
   `<project>/.ph/vetra/logs/VetraAgent/<timestamp>.md`.

## What the model sees

`skill { name }` returns this string:

```
<SKILL.md body — i.e. your .preamble.md content + auto "## Specific tasks" TOC>

## References
- references/00.<slug>.md
- references/01.<slug>.md
…
```

No reference *content* is included — just paths. The `## References`
bullet list is auto-appended; don't duplicate it inside your preamble.

`skill_read { skillName, path, startLine?, endLine? }` returns the file
content. `skill_search { query }` is BM25 across all skill content.

## Failure mode this skill exists to prevent

If `.preamble.md` is missing the SKILL.md body collapses to a bare
auto-generated "Specific tasks" TOC (≈15 lines). The model treats that
as the whole skill and proceeds straight to tool calls without drilling
in — then trips over schema details documented in the references it
never read (e.g. `SET_INITIAL_STATE` shape, `moduleId` vs `module`,
SCREAMING_SNAKE op names, `SET_OPERATION_REDUCER` vs `UPDATE_OPERATION`,
reducer **body** vs full `export const reducer = ...`, `state.workouts`
vs `state.global.workouts`, editor-status enum).

Seen end-to-end in
`vetra-test/.ph/vetra/logs/VetraAgent/20260527_1656_001.md`.

## Authoring rules

1. **Every skill needs a directive `.preamble.md`.** State imperatively
   *when* to call `skill_read` on which reference. Be specific.
   - Good: "Before any `spec-update` action, call `skill_read` on
     `references/04.spec-update-reference.md`. It is the only source of
     truth for action input shapes."
   - Bad: "See references for more detail."
2. **Front-load the highest-leverage reference.** If one short cheatsheet
   covers most schema footguns, name it explicitly in the preamble and
   require it before the first relevant tool call.
3. **Keep references self-contained.** The model fetches them one at a
   time; don't assume prior references are loaded into context.
4. **Don't repeat what tool errors already say.** `spec-update` errors
   echo the input schema; the reference should explain *which* action
   to pick and *when*, not re-state field lists.
5. **Numeric prefixes control reading order.** `00`, `01`, `02`… —
   pick an order that matches the workflow, since the TOC is
   alphabetical on filename.
6. **Mind the token budget.** The preamble is loaded every time the
   agent activates the skill. Keep it tight: imperative rules, no
   marketing prose, no restatement of the references.
7. **Trigger nouns in the skill `description`.** The agent's skill
   index is matched against the user request; descriptions need the
   product/tool/object nouns ("document model", "editor", "spec",
   "reducer") to surface at the right time.

## Auditing existing skills

Before editing, run the audit passes in [audit.md](audit.md): missing
`.preamble.md`, references not named by any preamble, TOC-like
preambles, overlong descriptions, scenario-ordering sanity, and budget
math (per-preamble byte → token estimates). Read that file when asked
to "review", "audit", or "tidy" the vetra skills.

## Inspecting an installed skill

```bash
PROJECT=/Users/acaldas/dev/powerhouse/vetra/vetra-test
ls -la "$PROJECT/.ph/vetra/.mastra/skills/<skill>/"
wc -l "$PROJECT/.ph/vetra/.mastra/skills/<skill>/SKILL.md" \
      "$PROJECT/.ph/vetra/.mastra/skills/<skill>/references/"*.md
```

Compare against a session log to see which references the model actually
called `skill_read` on:

```bash
grep -E "Tool Use: skill(_read)?" \
  "$PROJECT/.ph/vetra/logs/VetraAgent/<timestamp>.md"
```

## Output policy

- Suggest preamble/reference edits before applying. Show the diff.
- Edit `.preamble.md` and `NN.<slug>.md` sources only; never patch
  `gen/skills/` or `.mastra/skills/` output (next build clobbers it).
- Group commits per concern: preamble rewrite separately from reference
  reshuffles separately from new content.
- Don't delete a reference without checking it isn't named by another
  skill's preamble (`grep -r "references/<file>" prompts/skills-tpl`).

## Pre-ship checklist

- [ ] `.preamble.md` gives a concrete "read X before Y" rule, not a TOC restatement.
- [ ] Each reference is reachable from the preamble (named, not just implied).
- [ ] Filename ordering matches intended reading order.
- [ ] `pnpm build:assets` ran clean (no warnings under the skill's dir).
- [ ] Generated SKILL.md body matches the preamble after build.
- [ ] `pnpm refresh:test-skills` ran (vetra stopped first) — installed copy under `.ph/vetra/.mastra/skills/` reflects the new SKILL.md.
- [ ] Fresh agent session calls `skill_read` on the referenced files before the first relevant tool call.
