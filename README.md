# agentic-plugins

A public [Claude Code](https://code.claude.com) plugin marketplace — installable skills and agents
for AI coding agents.

## Install

Add the marketplace, then install a plugin:

```bash
/plugin marketplace add theagenticguy/agentic-plugins
/plugin install agentic-skills@agentic-plugins
/plugin install plugin-gardener@agentic-plugins
```

## Plugins

### agentic-skills

Flagship skills for AI coding agents.

| Skill               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench-builder` | Builds disposable localhost workbenches — Flask + `sqlite3` + htmx + Server-Sent Events apps that give an agentic coding/eval/PR/data session a live UI with no build step, no `npm install`, and no deploy. The signature move is a **two-way human↔agent loop** over one SQLite file: the human acts in the browser (htmx `POST` → SQLite → fragment + SSE invalidation), the agent acts from the terminal (`httpx` → SQLite → SSE), both seeing the same state update live with no reload. Ships recipes for eval viewers, PR review rooms, document-redline surfaces, trace replays, and refactor cockpits. |

**Bundled MCP servers** (`plugins/agentic-skills/.mcp.json`) — research and documentation tools that
back the skills. Each reads its key from an environment variable; the marketplace entry is
`strict: false`, so a missing key never blocks install — the server is simply skipped.

| Server       | Purpose                     | Env var            |
| ------------ | --------------------------- | ------------------ |
| context7     | Up-to-date library/API docs | `CONTEXT7_API_KEY` |
| deepwiki     | GitHub repo Q&A             | *(none)*           |
| brave-search | Web search                  | `BRAVE_API_KEY`    |
| tavily       | Web search + extraction     | `TAVILY_API_KEY`   |
| exa          | Neural web search           | `EXA_API_KEY`      |
| you          | You.com search + research   | `YDC_API_KEY`      |
| awsknowledge | AWS documentation           | *(none)*           |

### plugin-gardener

Catalog hygiene for Claude Code skill/agent plugins. Runs audits — inventory, per-skill scoring,
embedding-based collision detection, and HDBSCAN taxonomy checks — and proposes PR-style
resolutions without auto-applying.

## Repository layout

```text
.claude-plugin/marketplace.json   # marketplace registry — lists every plugin
plugins/
  agentic-skills/                 # flagship plugin
    .claude-plugin/plugin.json
    .mcp.json                     # bundled MCP servers
    skills/
  plugin-gardener/                # catalog-hygiene plugin
    .claude-plugin/plugin.json
    skills/  references/  scripts/
tools/                            # repo-wide validators and scaffolding
```

## Development

Requires [mise](https://mise.jdx.dev/) and [uv](https://docs.astral.sh/uv/).

```bash
mise install                  # node, markdownlint-cli2, dprint
mise run fmt                  # format all markdown and JSON
mise run fmt:check            # check formatting (CI-friendly)
mise run lint                 # lint all markdown
mise run lint:md:fix          # lint with auto-fix
mise run validate             # frontmatter + size + refs + freshness + versions
mise run build                # full gate: lint + fmt:check + validate
mise run bump -- <plugin> patch          # bump one plugin's version
mise run init:skill -- <plugin> <name> 'Description. Use when...'   # scaffold a skill
```

CI runs `mise run build` on every push and pull request.

## License

[MIT](LICENSE)
