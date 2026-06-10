# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "httpx",
#   "pyyaml",
# ]
# ///
"""Check library version freshness across all skills."""

import sys
from datetime import date, datetime
from pathlib import Path

import httpx
import yaml


def parse_frontmatter(path: Path) -> dict | None:
    """Extract YAML frontmatter from a markdown file."""
    text = path.read_text()
    if not text.startswith("---"):
        return None
    end = text.index("---", 3)
    return yaml.safe_load(text[3:end])


def get_pypi_version(client: httpx.Client, package: str) -> str | None:
    """Get latest version from PyPI."""
    try:
        resp = client.get(f"https://pypi.org/pypi/{package}/json", follow_redirects=True)
        if resp.status_code == 200:
            return resp.json()["info"]["version"]
    except Exception:
        pass
    return None


def get_npm_version(client: httpx.Client, package: str) -> str | None:
    """Get latest version from npm."""
    try:
        resp = client.get(f"https://registry.npmjs.org/{package}/latest", follow_redirects=True)
        if resp.status_code == 200:
            return resp.json().get("version")
    except Exception:
        pass
    return None


def version_matches(skill_ver: str, latest: str) -> bool:
    """Check if latest version matches the skill_version pattern.

    Patterns: "1.x" matches any 1.*, "1.0.x" matches any 1.0.*, "latest" always needs manual check.
    """
    if skill_ver == "latest":
        return True  # Can't compare, mark as "check"
    parts = skill_ver.rstrip(".x").split(".")
    latest_parts = latest.split(".")
    for i, p in enumerate(parts):
        if i >= len(latest_parts):
            return False
        if p != latest_parts[i]:
            return False
    return True


def discover_skill_files(plugins_dir: Path) -> list[Path]:
    """Return every SKILL.md across all plugins under plugins/*/skills/."""
    out: list[Path] = []
    if not plugins_dir.is_dir():
        return out
    for plugin_dir in sorted(p for p in plugins_dir.iterdir() if p.is_dir()):
        skills_dir = plugin_dir / "skills"
        if skills_dir.is_dir():
            out.extend(sorted(skills_dir.glob("*/SKILL.md")))
    return out


def main():
    plugins_dir = Path(__file__).parent.parent / "plugins"
    if not plugins_dir.exists():
        print("Error: plugins/ directory not found")
        sys.exit(1)

    rows: list[tuple[str, str, str, str, int, str]] = []
    today = date.today()

    with httpx.Client(timeout=10) as client:
        for skill_md in discover_skill_files(plugins_dir):
            fm = parse_frontmatter(skill_md)
            metadata = (fm or {}).get("metadata") or {}
            if not isinstance(metadata, dict) or "libraries" not in metadata:
                continue
            skill_name = skill_md.parent.name
            for lib in metadata["libraries"]:
                name = lib["name"]
                package = lib["package"]
                ecosystem = lib["ecosystem"]
                skill_ver = lib["skill_version"]
                verified = lib.get("verified", "unknown")

                # Calculate days since verified
                days = 0
                if verified != "unknown":
                    try:
                        verified_date = datetime.strptime(verified, "%Y-%m-%d").date()
                        days = (today - verified_date).days
                    except ValueError:
                        days = -1

                # Get latest version
                latest = None
                if ecosystem == "pypi":
                    latest = get_pypi_version(client, package)
                elif ecosystem == "npm":
                    latest = get_npm_version(client, package)

                if latest is None:
                    status = "error"
                elif skill_ver == "latest":
                    status = "check"
                elif version_matches(skill_ver, latest):
                    status = "ok"
                else:
                    status = "OUTDATED"

                rows.append((skill_name, name, skill_ver, latest or "???", days, status))

    # Print report
    if not rows:
        print("No libraries with version metadata found in any SKILL.md files.")
        print("Add 'metadata.libraries' to SKILL.md frontmatter to enable freshness tracking.")
        sys.exit(0)

    print(f"\nLibrary Freshness Report ({today})")
    print("=" * 85)
    print(f"{'Skill':<25} {'Library':<20} {'Skill Ver':<12} {'Latest':<12} {'Days':>5}  {'Status'}")
    print("-" * 85)

    outdated = 0
    checks = 0
    errors = 0
    ok = 0

    for skill, name, skill_ver, latest, days, status in rows:
        flag = ""
        if status == "OUTDATED":
            flag = " <<"
            outdated += 1
        elif status == "check":
            flag = " ?"
            checks += 1
        elif status == "error":
            flag = " !!"
            errors += 1
        else:
            ok += 1
        print(f"{skill:<25} {name:<20} {skill_ver:<12} {latest:<12} {days:>5}  {status}{flag}")

    print("-" * 85)
    print(f"Summary: {ok} ok, {outdated} outdated, {checks} check manually, {errors} errors")

    if outdated > 0:
        # Advisory, not a build failure. A pin lagging upstream is a signal to
        # re-look at the skill's durable guidance — not a blocker. Framework
        # skills route the volatile API surface to Context7 at write time, so a
        # stale pin does not make the skill wrong. Bump pins during a currency pass.
        print(
            f"\nADVISORY: {outdated} library pin(s) lag upstream. "
            "Re-look at the affected skills' durable guidance during the next "
            "currency pass; this does not fail the build."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
