# agentic-plugins

Development context for the agentic-plugins repo. This CLAUDE.md is project-level memory for when
you're editing the marketplace — it is NOT shipped as a plugin component. Plugin instructions go
into SKILL.md files and agent system prompts.

## Repo Structure

This repo is a Claude Code plugin **marketplace** at the root, hosting multiple plugins under
`plugins/` as sibling directories. Each plugin versions independently.

```text
.claude-plugin/
  marketplace.json       # Marketplace registry — lists every plugin
plugins/
  agentic-skills/        # Flagship plugin
    .claude-plugin/plugin.json
    .mcp.json            # Bundled MCP servers (context7, deepwiki, brave, tavily, exa, you, awsknowledge)
    skills/              # Skill reference files (the core content)
    agents/              # Agent definitions (if present)
  plugin-gardener/       # Catalog-hygiene plugin
    .claude-plugin/plugin.json
    skills/  references/  scripts/
tools/                   # Repo-wide dev tooling (validators, scaffolding)
```

## Harness tool names — do not confuse

Two separate tool families with similar names. Skills authored here must reference the correct one.

- **`Agent`** — spawns a subagent. Parameters: `subagent_type`, `prompt`, `description`, `model`,
  `run_in_background`, `isolation`. No `Stop`/`Output` siblings — backgrounded agents auto-notify on
  completion. Stuck-recovery pattern is "launch a fresh `Agent` with a skip-completed-sections
  prompt," not kill-and-resume.
- **`TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop`** — the todo-list tools. Track
  multi-step work, mark items in_progress / completed, wire `addBlockedBy` dependencies. Do NOT
  spawn subagents.

## No roadmap or migration commentary in skill files

SKILL.md, agent definitions, and everything under `references/` / `templates/` ship as prompt
content. Do NOT include forward-looking notes, migration history, authoring roadmap (TODO/FIXME), or
meta-commentary about the skill's own state. That belongs in the PR description or a CHANGELOG —
never in a file Claude reads as instructions. It costs tokens on every load and rots the moment the
referenced work lands or gets dropped.

## Skill Architecture: Two-Tier Pattern

Every skill follows a **two-tier** structure, enforced by convention and lint rules:

- **Tier 1 — `SKILL.md`**: the entry point. Frontmatter (`name` matching the directory +
  `description` with trigger phrases) plus when/why, core concepts, quick reference, anti-patterns.
  Target ~100–200 lines; under 300 is good; over 500 fails the size check.
- **Tier 2 — `references/` and `templates/`**: deep-dive material loaded on demand via
  `${CLAUDE_PLUGIN_ROOT}` paths. SKILL.md stays in context when triggered; reference files load only
  when needed. Keeping SKILL.md focused reduces token waste and improves routing.

## Quality Rules

- **Formatting — `dprint`**: line width, table alignment, trailing newlines for all markdown + JSON.
- **Linting — `markdownlint-cli2`**: code fences need a language; ATX headings; blank lines around
  blocks. Globs live in `.markdownlint-cli2.yaml` and cover `plugins/**/*.md`.
- **Validation — `tools/`**: frontmatter spec, SKILL.md size, reference integrity (no broken links
  or orphans), library freshness, and version sync between each plugin.json and its marketplace
  entry.

### Version management

Each plugin's version lives in two places that must stay in sync:

- `plugins/<plugin>/.claude-plugin/plugin.json` → `.version`
- `.claude-plugin/marketplace.json` → the matching `plugins[]` entry's `.version`

`marketplace.json` `.metadata.version` tracks the highest owned-plugin version. Use
`mise run bump -- <plugin> <major|minor|patch>` to update all of them atomically.
`tools/validate_versions.py` (run by `mise run validate`) catches drift from hand edits.

## Development

Requires [mise](https://mise.jdx.dev/) and [uv](https://docs.astral.sh/uv/).

```bash
mise install                  # node, markdownlint-cli2, dprint
mise run fmt                  # format all markdown and JSON
mise run lint                 # lint all markdown
mise run validate             # all validators
mise run build                # full gate: lint + fmt:check + validate
mise run bump -- <plugin> patch
mise run init:skill -- <plugin> <name> '<description>'
```

## Adding a new skill

1. `mise run init:skill -- <plugin> <skill-name> '<description with a "Use when" trigger>'`
2. Add `references/` for detailed docs, `templates/` for scaffolds.
3. `mise run build` to verify lint + format + validation.
4. `mise run bump -- <plugin> minor`.

## Adding a new plugin

1. Create `plugins/<plugin>/.claude-plugin/plugin.json` (`name`, `version`, `description`, `author`,
   `license`, `keywords`).
2. Add a matching entry to `.claude-plugin/marketplace.json` with a local `"source": "./plugins/<plugin>"`.
3. Add skills and agents under the plugin directory.
4. `mise run build`.
