# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml"]
# ///
"""Validate SKILL.md frontmatter against the plugin spec, across all plugins."""

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"
NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$")
# Agent Skills open standard + Claude Code skill frontmatter fields.
# See https://code.claude.com/docs/en/skills#frontmatter-reference
ALLOWED_PROPERTIES = {
    "name", "description", "license", "compatibility", "metadata", "user_facing",
    "when_to_use", "argument-hint", "arguments", "disable-model-invocation",
    "user-invocable", "allowed-tools", "disallowed-tools", "model", "effort",
    "context", "agent", "hooks", "paths", "shell",
}
MAX_DESCRIPTION_LENGTH = 1024
# Claude Code truncates the combined description + when_to_use text in the skill
# listing at 1,536 chars. Keep the pair under that so no trigger keywords are lost.
MAX_LISTING_LENGTH = 1536
TRIGGER_PHRASES = ("Use when", "Use this")

RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
BOLD = "\033[1m"
RESET = "\033[0m"


def parse_frontmatter(path: Path) -> dict | None:
    """Extract YAML frontmatter from a markdown file."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    return yaml.safe_load(text[4:end])


def discover_skill_dirs() -> list[tuple[str, Path]]:
    """Return (plugin_name, skill_dir) for every skill across all plugins."""
    out: list[tuple[str, Path]] = []
    if not PLUGINS_DIR.is_dir():
        return out
    for plugin_dir in sorted(p for p in PLUGINS_DIR.iterdir() if p.is_dir()):
        skills_dir = plugin_dir / "skills"
        if not skills_dir.is_dir():
            continue
        for skill_dir in sorted(d for d in skills_dir.iterdir() if d.is_dir()):
            if (skill_dir / "SKILL.md").exists():
                out.append((plugin_dir.name, skill_dir))
    return out


def validate_skill(skill_dir: Path) -> tuple[list[str], list[str]]:
    """Validate a single skill's frontmatter. Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    skill_md = skill_dir / "SKILL.md"

    if not skill_md.exists():
        errors.append("SKILL.md not found")
        return errors, warnings

    fm = parse_frontmatter(skill_md)
    if fm is None:
        errors.append("No valid YAML frontmatter (must start with ---)")
        return errors, warnings

    # name: required
    name = fm.get("name")
    if not name:
        errors.append("Missing required field: name")
    else:
        # name: matches directory
        if name != skill_dir.name:
            errors.append(f"name '{name}' does not match directory '{skill_dir.name}'")
        # name: format
        if not NAME_RE.match(name):
            errors.append(f"name '{name}' invalid (lowercase + hyphens, max 64 chars, no --, no leading/trailing -)")
        if "--" in str(name):
            errors.append(f"name '{name}' contains consecutive hyphens")

    # description: required
    desc = fm.get("description")
    if not desc:
        errors.append("Missing required field: description")
    else:
        desc_str = str(desc).strip()
        # description: max length
        if len(desc_str) > MAX_DESCRIPTION_LENGTH:
            errors.append(f"description is {len(desc_str)} chars (max {MAX_DESCRIPTION_LENGTH})")
        # description: trigger phrase
        if not any(phrase in desc_str for phrase in TRIGGER_PHRASES):
            warnings.append("description missing trigger phrase ('Use when' or 'Use this')")
        # description + when_to_use: combined listing cap
        when = fm.get("when_to_use")
        if when:
            combined = len(desc_str) + len(str(when).strip())
            if combined > MAX_LISTING_LENGTH:
                errors.append(
                    f"description + when_to_use is {combined} chars "
                    f"(max {MAX_LISTING_LENGTH} in the skill listing)"
                )

    # allowed properties (Agent Skills spec)
    for key in fm:
        if key not in ALLOWED_PROPERTIES:
            errors.append(f"non-spec frontmatter property: '{key}' (allowed: {', '.join(sorted(ALLOWED_PROPERTIES))})")

    return errors, warnings


def main() -> int:
    skills = discover_skill_dirs()

    if not skills:
        print(f"{YELLOW}No skills found under {PLUGINS_DIR}{RESET}")
        return 0

    total_errors = 0
    total_warnings = 0

    print(f"{BOLD}Frontmatter Validation{RESET}")
    print(f"Checking {len(skills)} skills across {len({p for p, _ in skills})} plugins...\n")

    for plugin_name, skill_dir in skills:
        errors, warnings = validate_skill(skill_dir)
        total_errors += len(errors)
        total_warnings += len(warnings)
        label = f"{plugin_name}/{skill_dir.name}"

        if errors:
            print(f"  {RED}FAIL{RESET}  {label}")
            for e in errors:
                print(f"         {RED}{e}{RESET}")
        elif warnings:
            print(f"  {YELLOW}WARN{RESET}  {label}")
        else:
            print(f"  {GREEN}OK{RESET}    {label}")

        for w in warnings:
            print(f"         {YELLOW}{w}{RESET}")

    print(f"\n{BOLD}Summary:{RESET} {len(skills)} skills, {total_errors} errors, {total_warnings} warnings")

    return 1 if total_errors > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
