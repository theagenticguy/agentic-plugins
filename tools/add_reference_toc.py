# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Add a '## Contents' table-of-contents to reference/template files over a line
threshold that lack one.

Anthropic's agent-skills best-practices recommend a TOC at the top of any
reference file longer than ~100 lines, so Claude sees the full scope of a file
even when it previews with a partial read.

This is a deterministic operation (extract the H2/H3 headings, emit a plain
bulleted list), so it is a script rather than an LLM edit: cheaper, consistent,
and verifiable. Plain-text bullets are used — NOT [anchor](#links) — because the
markdownlint MD051 rule rejects fragment links unless they resolve exactly.

Usage:
    uv run tools/add_reference_toc.py            # dry-run: list what would change
    uv run tools/add_reference_toc.py --apply    # write the TOCs
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"
# Every plugin's skills/ directory.
SEARCH_DIRS = (
    [p / "skills" for p in sorted(PLUGINS_DIR.iterdir()) if p.is_dir()]
    if PLUGINS_DIR.is_dir()
    else []
)
LINE_THRESHOLD = 100

# Skip non-shipped scratch and eval fixtures.
SKIP_SUBSTRINGS = ("-workspace/", "/evals/")

H2_RE = re.compile(r"^## (.+?)\s*$")
H3_RE = re.compile(r"^### (.+?)\s*$")
FENCE_RE = re.compile(r"^(```|~~~)")


def candidate_files() -> list[Path]:
    files: list[Path] = []
    for base in SEARCH_DIRS:
        if not base.is_dir():
            continue
        for f in base.rglob("*.md"):
            rel = str(f.relative_to(ROOT))
            if any(s in rel for s in SKIP_SUBSTRINGS):
                continue
            if "/references/" not in rel and "/templates/" not in rel:
                continue
            files.append(f)
    return sorted(files)


def has_toc(lines: list[str]) -> bool:
    # Scan the whole file, not just the head: some files carry a long preamble
    # before the first heading, so an existing "## Contents" can sit well below
    # the top. A head-only scan would miss it and insert a duplicate.
    return any(line.strip() == "## Contents" for line in lines)


def headings(lines: list[str]) -> list[tuple[int, str]]:
    """Return (level, text) for H2/H3 headings outside fenced code blocks.

    Skips the document title (first H1) and any heading literally named
    'Contents' or 'Protocol' (the latter is a write-protocol block that is not
    navigational content).
    """
    out: list[tuple[int, str]] = []
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m2 = H2_RE.match(line)
        if m2:
            out.append((2, m2.group(1).strip()))
            continue
        m3 = H3_RE.match(line)
        if m3:
            out.append((3, m3.group(1).strip()))
    return out


LEADING_ORDINAL_RE = re.compile(r"^\d+\.\s+")


def build_toc(heads: list[tuple[int, str]]) -> str:
    """Plain bulleted list. H2 flush-left, H3 indented two spaces. No anchor links.

    A heading whose text begins with an ordinal (e.g. '1. Redundant Pairs') would,
    as a bullet '- 1. Redundant Pairs', be parsed by markdownlint as a nested
    ordered-list item and trip MD029. Strip the leading ordinal in the TOC entry.
    """
    bullets: list[str] = []
    for level, text in heads:
        indent = "" if level == 2 else "  "
        clean = LEADING_ORDINAL_RE.sub("", text)
        bullets.append(f"{indent}- {clean}")
    return "## Contents\n\n" + "\n".join(bullets) + "\n"


def find_insertion_point(lines: list[str]) -> int | None:
    """Insert after the title block: the first H1 and its immediately following
    intro paragraph, before the first H2. Returns a line index, or None if the
    file has no H1 (then we insert before the first H2).
    """
    first_h2 = None
    for i, line in enumerate(lines):
        if H2_RE.match(line):
            first_h2 = i
            break
    if first_h2 is None:
        return None
    return first_h2


def process(path: Path, apply: bool) -> tuple[bool, str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if len(lines) <= LINE_THRESHOLD:
        return False, "under threshold"
    if has_toc(lines):
        return False, "already has TOC"

    heads = headings(lines)
    # Drop a leading 'Protocol' pseudo-heading and any 'Contents' that slipped in.
    heads = [(lvl, t) for (lvl, t) in heads if t.lower() not in ("contents",)]
    # Only H2 count toward "is this navigable" — need at least 3 H2 sections.
    h2_count = sum(1 for lvl, _ in heads if lvl == 2)
    if h2_count < 3:
        return False, f"only {h2_count} H2 sections — TOC not worth it"

    insert_at = find_insertion_point(lines)
    if insert_at is None:
        return False, "no H2 anchor found"

    toc = build_toc(heads)
    new_lines = lines[:insert_at] + [toc] + lines[insert_at:]
    new_text = "\n".join(new_lines) + ("\n" if text.endswith("\n") else "")

    if apply:
        path.write_text(new_text, encoding="utf-8")
    return True, f"{h2_count} H2 + {len(heads) - h2_count} H3"


def main() -> int:
    apply = "--apply" in sys.argv
    files = candidate_files()
    changed = 0
    skipped: dict[str, int] = {}
    for f in files:
        did, reason = process(f, apply)
        rel = f.relative_to(ROOT)
        if did:
            changed += 1
            print(f"{'WROTE' if apply else 'WOULD ADD'}  {rel}  ({reason})")
        else:
            skipped[reason] = skipped.get(reason, 0) + 1
    print()
    print(f"{'Applied' if apply else 'Dry-run'}: {changed} file(s) {'updated' if apply else 'would get a TOC'}")
    for reason, n in sorted(skipped.items(), key=lambda x: -x[1]):
        print(f"  skipped {n}: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
