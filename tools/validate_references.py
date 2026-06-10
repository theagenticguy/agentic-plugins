# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Detect orphaned references and broken links across skills, commands, and agents."""

import re
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"


def plugin_roots() -> list[Path]:
    """Every plugin directory under plugins/."""
    if not PLUGINS_DIR.is_dir():
        return []
    return sorted(p for p in PLUGINS_DIR.iterdir() if p.is_dir())


def find_plugin_root(source_file: Path) -> Path | None:
    """Find the plugin root (plugins/{plugin}/) that contains a source file."""
    resolved = source_file.resolve()
    try:
        rel = resolved.relative_to(PLUGINS_DIR.resolve())
    except ValueError:
        return None
    return (PLUGINS_DIR / rel.parts[0]).resolve()

# File extensions to track
EXT = r"md|py|ts|json|yaml|yml|toml|txt|tsx|jsx|docx|xlsx|pptx|drawio|sh|html|vue"
# Patterns for extracting file references from markdown
# Inline code paths: `references/foo.md`, `templates/bar.md`
INLINE_CODE_RE = re.compile(rf"`(?:\${{CLAUDE_PLUGIN_ROOT}}/)?([^`]+\.(?:{EXT}))`")
# Markdown links: [text](path.md)
MD_LINK_RE = re.compile(rf"\[(?:[^\]]*)\]\((?:\${{CLAUDE_PLUGIN_ROOT}}/)?([^)]+\.(?:{EXT}))\)")
# ${CLAUDE_PLUGIN_ROOT} prefix paths in plain text
PLUGIN_ROOT_RE = re.compile(rf"\${{CLAUDE_PLUGIN_ROOT}}/([^\s\"'`<>]+\.(?:{EXT}))")
# Directory references (trailing slash) — `references/jit-code/`, `templates/session/`
# Marks every file inside the directory as reachable.
INLINE_DIR_RE = re.compile(r"`(?:\${CLAUDE_PLUGIN_ROOT}/)?([^`\s]+/)`")
MD_LINK_DIR_RE = re.compile(r"\[(?:[^\]]*)\]\((?:\${CLAUDE_PLUGIN_ROOT}/)?([^)\s]+/)\)")

RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
BOLD = "\033[1m"
RESET = "\033[0m"


def extract_refs(text: str) -> set[str]:
    """Extract all file path references from markdown text."""
    refs: set[str] = set()
    for pattern in (INLINE_CODE_RE, MD_LINK_RE, PLUGIN_ROOT_RE):
        refs.update(pattern.findall(text))
    return refs


def extract_dir_refs(text: str) -> set[str]:
    """Extract directory references (paths ending in /) from markdown text.
    A directory reference implicitly marks every file under the directory as reachable.
    """
    refs: set[str] = set()
    for pattern in (INLINE_DIR_RE, MD_LINK_DIR_RE):
        refs.update(pattern.findall(text))
    return refs


def find_skill_root(source_file: Path) -> Path | None:
    """Find the skill root directory (plugins/{plugin}/skills/{name}/) for a source file."""
    plugin_root = find_plugin_root(source_file)
    if plugin_root is None:
        return None
    skills_dir = (plugin_root / "skills").resolve()
    resolved = source_file.resolve()
    try:
        rel = resolved.relative_to(skills_dir)
    except ValueError:
        return None
    # First component is the skill name
    return skills_dir / rel.parts[0]


def resolve_ref(ref: str, source_file: Path) -> list[Path]:
    """Resolve a reference path. Returns candidate paths to check (first match wins)."""
    # If the ref starts with a known plugin top-level dir — resolve from this
    # file's own plugin root.
    if ref.startswith(("skills/", "commands/", "agents/")):
        plugin_root = find_plugin_root(source_file)
        if plugin_root is not None:
            return [plugin_root / ref]

    candidates = []
    # Try relative to the source file's directory
    candidates.append(source_file.parent / ref)
    # Also try relative to the skill root (skills/{name}/)
    skill_root = find_skill_root(source_file)
    if skill_root:
        from_root = skill_root / ref
        if from_root not in candidates:
            candidates.append(from_root)
    # Also try relative to the plugin root — this is what ${CLAUDE_PLUGIN_ROOT}/
    # resolves to at runtime, so a plugin-level references/ (shared across skills)
    # is reachable via `${CLAUDE_PLUGIN_ROOT}/references/foo.md`.
    plugin_root = find_plugin_root(source_file)
    if plugin_root is not None:
        from_plugin = plugin_root / ref
        if from_plugin not in candidates:
            candidates.append(from_plugin)
    return candidates


def collect_all_resource_files() -> set[Path]:
    """Collect files under plugins/*/skills/*/references/ and .../templates/."""
    files: set[Path] = set()
    for plugin_root in plugin_roots():
        skills_dir = plugin_root / "skills"
        if not skills_dir.is_dir():
            continue
        for skill_dir in skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue
            for subdir_name in ("references", "templates"):
                subdir = skill_dir / subdir_name
                if subdir.is_dir():
                    for f in subdir.rglob("*"):
                        if f.is_file() and f.name != ".gitkeep":
                            files.add(f.resolve())
    return files


def collect_entry_points() -> list[Path]:
    """Collect all entry point files that can reference resources, across all plugins."""
    entries: list[Path] = []

    for plugin_root in plugin_roots():
        skills_dir = plugin_root / "skills"
        commands_dir = plugin_root / "commands"
        agents_dir = plugin_root / "agents"

        # All SKILL.md files
        if skills_dir.is_dir():
            for skill_dir in skills_dir.iterdir():
                if skill_dir.is_dir():
                    skill_md = skill_dir / "SKILL.md"
                    if skill_md.exists():
                        entries.append(skill_md)

        # All command files
        if commands_dir.is_dir():
            for f in commands_dir.iterdir():
                if f.is_file() and f.suffix == ".md":
                    entries.append(f)

        # All agent files
        if agents_dir.is_dir():
            for f in agents_dir.iterdir():
                if f.is_file() and f.suffix == ".md":
                    entries.append(f)

    return entries


def expand_dynamic_ref(ref_path: Path) -> list[Path]:
    """Expand dynamic references like {domain}.md to actual files."""
    path_str = str(ref_path)
    if "{" not in path_str:
        return [ref_path]

    # Replace {placeholder} with * for globbing
    glob_pattern = re.sub(r"\{[^}]+\}", "*", path_str)
    parent = Path("/")
    # Find the longest non-glob prefix
    parts = glob_pattern.split("/")
    glob_start = 0
    for i, part in enumerate(parts):
        if "*" in part:
            glob_start = i
            break
        parent = parent / part

    remaining = "/".join(parts[glob_start:])
    return list(parent.glob(remaining))


def main() -> int:
    all_resources = collect_all_resource_files()
    entry_points = collect_entry_points()

    if not entry_points:
        print(f"{YELLOW}No entry points found{RESET}")
        return 0

    # BFS: track which resource files are reachable
    reachable: set[Path] = set()
    broken_links: list[tuple[Path, str]] = []

    queue: deque[Path] = deque(entry_points)
    visited: set[Path] = set()

    while queue:
        current = queue.popleft()
        if current.resolve() in visited:
            continue
        visited.add(current.resolve())

        if not current.exists():
            continue

        text = current.read_text(encoding="utf-8")
        refs = extract_refs(text)
        dir_refs = extract_dir_refs(text)

        # Mark every file under each referenced directory as reachable.
        for dir_ref in dir_refs:
            # Skip URLs and absolute paths
            if dir_ref.startswith(("http://", "https://", "/")):
                continue
            # Resolve the directory like we resolve a file ref.
            candidates = resolve_ref(dir_ref.rstrip("/"), current)
            for candidate in candidates:
                if candidate.is_dir():
                    for f in candidate.rglob("*"):
                        if f.is_file() and f.name != ".gitkeep":
                            reachable.add(f.resolve())

        for ref in refs:
            # Skip URLs, mailto, fragment-only links, glob patterns
            if ref.startswith(("http://", "https://", "mailto:", "#")):
                continue
            if "*" in ref or "?" in ref:
                continue
            # Skip placeholder paths using angle-bracket syntax (e.g. skills/<name>/SKILL.md)
            if "<" in ref or ">" in ref:
                continue
            # Skip template placeholders (e.g. {{ slug }}/templates/index.html)
            if "{{" in ref or "}}" in ref:
                continue

            candidates = resolve_ref(ref, current)
            if not candidates:
                continue

            # Try expanding dynamic refs ({placeholder}) for each candidate
            all_expanded: list[Path] = []
            for candidate in candidates:
                all_expanded.extend(expand_dynamic_ref(candidate))

            found_any = any(p.exists() for p in all_expanded)

            if not found_any:
                # Only report broken links for paths that look like they should exist
                ref_lower = ref.lower()
                if any(kw in ref_lower for kw in ("references/", "templates/", "skills/")):
                    broken_links.append((current, ref))
                continue

            for path in all_expanded:
                if path.exists():
                    resolved_path = path.resolve()
                    reachable.add(resolved_path)
                    # If it's a markdown file under references/templates, crawl it too
                    if resolved_path not in visited and path.suffix == ".md":
                        queue.append(path)

    orphans = all_resources - reachable

    print(f"{BOLD}Reference Integrity Check{RESET}")
    print(f"Entry points: {len(entry_points)}, Resource files: {len(all_resources)}\n")

    if broken_links:
        print(f"{RED}Broken links ({len(broken_links)}):{RESET}")
        for source, ref in sorted(broken_links, key=lambda x: (str(x[0]), x[1])):
            rel_source = source.relative_to(ROOT)
            print(f"  {RED}BROKEN{RESET}  {rel_source} -> {ref}")
        print()

    if orphans:
        print(f"{YELLOW}Orphaned files ({len(orphans)}):{RESET}")
        for path in sorted(orphans):
            rel = path.relative_to(ROOT)
            print(f"  {YELLOW}ORPHAN{RESET}  {rel}")
        print()

    if not broken_links and not orphans:
        print(f"  {GREEN}All {len(all_resources)} resource files are reachable. No broken links found.{RESET}\n")

    reachable_count = len(all_resources) - len(orphans)
    print(f"{BOLD}Summary:{RESET} {reachable_count}/{len(all_resources)} reachable, {len(orphans)} orphaned, {len(broken_links)} broken links")

    return 1 if broken_links else 0


if __name__ == "__main__":
    sys.exit(main())
