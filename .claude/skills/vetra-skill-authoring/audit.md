# Auditing vetra agent skills

Quick passes to run before/after editing skills under
`vetra-cli/prompts/skills-tpl/`. All commands assume cwd =
`vetra-cli/` and use plain POSIX tools so they survive shell churn.

## 1. Skills missing a `.preamble.md`

A skill without a preamble ships a bare auto-generated TOC as its
SKILL.md body — the model treats it as the whole skill and skips the
references. This is the most common cause of agents failing tool
schemas they could have looked up.

```bash
for d in prompts/skills-tpl/*/; do
  test -e "$d/.preamble.md" || echo "MISSING preamble: $d"
done
```

## 2. References not named in the preamble

A reference that isn't named in the preamble is dead weight: the
agent only learns it exists through the auto-appended `## References`
filename list, which it usually ignores. Either name it from the
preamble or delete it.

```bash
for d in prompts/skills-tpl/*/; do
  [ -e "$d/.preamble.md" ] || continue
  for f in "$d"[0-9]*.md; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    grep -q "$base" "$d/.preamble.md" \
      || echo "ORPHAN: $f (not referenced from $d/.preamble.md)"
  done
done
```

## 3. Preambles that are pure TOC restatements

A preamble that just lists the references duplicates the auto-appended
TOC and adds no directive value. Flag preambles where >70% of non-empty
lines start with `*`, `-`, or a bullet-list pattern.

```bash
for f in prompts/skills-tpl/*/.preamble.md; do
  total=$(grep -cve '^[[:space:]]*$' "$f")
  bullets=$(grep -cE '^[[:space:]]*[-*]' "$f")
  [ "$total" -gt 0 ] || continue
  ratio=$(( bullets * 100 / total ))
  [ "$ratio" -gt 70 ] && echo "TOC-LIKE ($ratio% bullets): $f"
done
```

## 4. Overlong skill descriptions

The `description` in `skill-builder.ts`'s `config.skillDescriptions`
(or the auto-generated fallback) is what the agent sees in its skill
index. Long descriptions waste budget and dilute trigger nouns. Aim for
≤200 chars.

```bash
node -e '
  const { skillDescriptions } = require("./prompts/skill-config.js");
  for (const [name, desc] of Object.entries(skillDescriptions || {})) {
    if (desc.length > 200) console.log(`LONG (${desc.length}): ${name} — ${desc}`);
  }
' 2>/dev/null || echo "(adjust path to skill-config; check ph-clint-dev docs)"
```

Fallback for inspecting installed skills directly:

```bash
for f in <project>/.ph/vetra/.mastra/skills/*/SKILL.md; do
  desc=$(awk '/^description:/{sub(/^description: */,""); gsub(/^"|"$/,""); print; exit}' "$f")
  len=${#desc}
  [ "$len" -gt 200 ] && echo "LONG ($len): $f"
done
```

## 5. Scenario ordering sanity

Filename order = TOC order = the order the agent will read them if it
follows the preamble's "read in order" suggestion. Make sure prefixes
don't collide and the numbering matches workflow phase.

```bash
for d in prompts/skills-tpl/*/; do
  echo "== $d"
  ls "$d" | grep -E '^[0-9]+\.' | sort
done
```

## Budget math

The SKILL.md body (your `.preamble.md`) is loaded into the agent's
context **every time** `skill` activates. Rough token cost:

```
tokens ≈ ceil(utf8_bytes / 4)
```

Reference targets (Vetra Agent runs on Anthropic models, ~200K context):

- Preamble: **≤2KB / ≤500 tokens.** Anything past that is usually
  prose that should be moved into a reference.
- A single reference fetched via `skill_read`: aim ≤8KB / ≤2K
  tokens. The 578-line `02.define-state-and-operations.md` is
  borderline — splitting it would help.
- Description (in the skill index): **≤200 chars / ~50 tokens.** Every
  skill description is loaded on every turn for matching, so this
  cost compounds across skills.

Check sizes:

```bash
wc -c prompts/skills-tpl/*/.preamble.md prompts/skills-tpl/*/[0-9]*.md \
  | awk '{ printf "%6d B (~%4d tok)  %s\n", $1, int(($1+3)/4), $2 }' \
  | sort -k1 -n
```

## Keep priority

There's no layered/override system for vetra skills today (single source
under `prompts/skills-tpl/`), so duplicate detection isn't relevant —
unlike the Codex/Claude-skills ecosystem. If layered sources are added
later (per-project overrides, plugin skills), add a keep-priority rule
here: project override > workspace default > vendored.
