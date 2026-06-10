# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Check SKILL.md line counts and flag oversized skills, across all plugins."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"

IDEAL_MAX = 200
GOOD_MAX = 300
WARNING_MAX = 500
CODE_BLOCK_THRESHOLD = 30  # lines — suggest extraction if a code block exceeds this

RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


FENCE_RE = re.compile(r"^(`{3,})")


def discover_skill_files() -> list[tuple[str, Path]]:
    """Return (plugin_name, SKILL.md path) for every skill across all plugins."""
    out: list[tuple[str, Path]] = []
    if not PLUGINS_DIR.is_dir():
        return out
    for plugin_dir in sorted(p for p in PLUGINS_DIR.iterdir() if p.is_dir()):
        skills_dir = plugin_dir / "skills"
        if not skills_dir.is_dir():
            continue
        for skill_dir in sorted(d for d in skills_dir.iterdir() if d.is_dir()):
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                out.append((plugin_dir.name, skill_md))
    return out


def find_extraction_candidates(text: str) -> list[str]:
    """Find code blocks over CODE_BLOCK_THRESHOLD lines as extraction candidates."""
    candidates: list[str] = []
    in_block = False
    block_start = 0
    block_lang = ""
    block_lines = 0
    fence_len = 0  # number of backticks in opening fence

    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        m = FENCE_RE.match(stripped)
        if m and not in_block:
            in_block = True
            fence_len = len(m.group(1))
            block_start = i
            block_lang = stripped[fence_len:].strip() or "unknown"
            block_lines = 0
        elif in_block and m and len(m.group(1)) >= fence_len and stripped == m.group(1):
            in_block = False
            if block_lines > CODE_BLOCK_THRESHOLD:
                candidates.append(f"Code block ({block_lang}) at line {block_start}: {block_lines} lines")
        elif in_block:
            block_lines += 1

    return candidates


def main() -> int:
    skill_files = discover_skill_files()

    if not skill_files:
        print(f"{YELLOW}No skills found under {PLUGINS_DIR}{RESET}")
        return 0

    has_errors = False
    results: list[tuple[str, int, int, str, Path]] = []  # (label, lines, tokens, level, path)

    for plugin_name, skill_md in skill_files:
        text = skill_md.read_text(encoding="utf-8")
        lines = len(text.splitlines())
        tokens = len(text) // 4  # rough estimate
        label = f"{plugin_name}/{skill_md.parent.name}"

        if lines > WARNING_MAX:
            level = "error"
            has_errors = True
        elif lines > GOOD_MAX:
            level = "warning"
        elif lines > IDEAL_MAX:
            level = "good"
        else:
            level = "ideal"

        results.append((label, lines, tokens, level, skill_md))

    # Sort by line count descending for readability
    results.sort(key=lambda r: r[1], reverse=True)

    print(f"{BOLD}SKILL.md Size Check{RESET}")
    print(f"Checking {len(results)} skills...\n")

    print(f"  {'Skill':<40} {'Lines':>6}  {'~Tokens':>8}  Status")
    print(f"  {'─' * 40} {'─' * 6}  {'─' * 8}  {'─' * 12}")

    for label, lines, tokens, level, _ in results:
        if level == "error":
            status = f"{RED}EXTRACT{RESET}"
            color = RED
        elif level == "warning":
            status = f"{YELLOW}REVIEW{RESET}"
            color = YELLOW
        elif level == "good":
            status = f"{DIM}good{RESET}"
            color = ""
        else:
            status = f"{GREEN}ideal{RESET}"
            color = ""

        line_str = f"{color}{lines:>6}{RESET}" if color else f"{lines:>6}"
        print(f"  {label:<40} {line_str}  {tokens:>8}  {status}")

    # Show extraction candidates for oversized skills
    oversized = [(label, path) for label, _, _, level, path in results if level in ("error", "warning")]
    if oversized:
        print(f"\n{BOLD}Extraction candidates:{RESET}")
        for label, path in oversized:
            text = path.read_text(encoding="utf-8")
            candidates = find_extraction_candidates(text)
            if candidates:
                print(f"\n  {YELLOW}{label}{RESET}:")
                for c in candidates:
                    print(f"    - {c}")

    error_count = sum(1 for _, _, _, level, _ in results if level == "error")
    warn_count = sum(1 for _, _, _, level, _ in results if level == "warning")
    print(f"\n{BOLD}Summary:{RESET} {len(results)} skills, {error_count} over 500 (error), {warn_count} over 300 (warning)")

    return 1 if has_errors else 0


if __name__ == "__main__":
    sys.exit(main())
