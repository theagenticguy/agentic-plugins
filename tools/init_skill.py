# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Scaffold a new skill directory with correct SKILL.md template.

Usage: uv run tools/init_skill.py <plugin> <skill-name> <description>
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"
NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$")

SKILL_TEMPLATE = """\
---
name: {name}
description: >
  {description}
---

# {title}

## When to Use

[FILL: Describe the specific scenarios and contexts where this skill applies.]

## Core Concepts

[FILL: Key concepts, terminology, and mental models.]

## Quick Reference

[FILL: The most commonly needed patterns, commands, or code snippets.]

## Anti-Patterns

[FILL: Common mistakes and what to do instead.]

## References

- `references/` — [FILL: Describe what detailed reference material is available.]
"""


def main() -> int:
    if len(sys.argv) < 4:
        print(f"Usage: uv run {sys.argv[0]} <plugin> <skill-name> <description>")
        print(f"Example: uv run {sys.argv[0]} agentic-skills my-skill 'Brief description. Use when the user asks to...'")
        return 1

    plugin = sys.argv[1]
    name = sys.argv[2]
    description = sys.argv[3]

    # Validate plugin exists
    plugin_dir = PLUGINS_DIR / plugin
    if not plugin_dir.is_dir():
        existing = sorted(p.name for p in PLUGINS_DIR.iterdir() if p.is_dir()) if PLUGINS_DIR.is_dir() else []
        print(f"Error: plugin '{plugin}' not found under plugins/")
        print(f"Existing plugins: {', '.join(existing) or '(none)'}")
        return 1

    # Validate name
    if not NAME_RE.match(name):
        print(f"Error: '{name}' is not a valid skill name")
        print("Must be lowercase + hyphens, max 64 chars, no --, no leading/trailing -")
        return 1

    if "--" in name:
        print(f"Error: '{name}' contains consecutive hyphens")
        return 1

    skills_dir = plugin_dir / "skills"

    # Check for existing skill
    skill_dir = skills_dir / name
    if skill_dir.exists():
        print(f"Error: skill '{name}' already exists at {skill_dir}")
        return 1

    # Ensure trigger phrase
    if "Use when" not in description and "Use this" not in description:
        print("Warning: description should contain 'Use when' or 'Use this' trigger phrase")

    # Create structure
    title = name.replace("-", " ").title()
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        SKILL_TEMPLATE.format(name=name, description=description, title=title),
        encoding="utf-8",
    )
    refs_dir = skill_dir / "references"
    refs_dir.mkdir()
    (refs_dir / ".gitkeep").touch()

    rel = f"plugins/{plugin}/skills/{name}"
    print(f"Created skill '{name}' in plugin '{plugin}'")
    print(f"  {rel}/SKILL.md")
    print(f"  {rel}/references/.gitkeep")
    print("\nNext steps:")
    print(f"  1. Edit {rel}/SKILL.md — fill in the [FILL] sections")
    print(f"  2. Add reference files to {rel}/references/")
    print("  3. Run: mise run validate")

    return 0


if __name__ == "__main__":
    sys.exit(main())
