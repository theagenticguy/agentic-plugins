# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Verify each owned plugin's version matches its marketplace.json entry.

`bump-version.cjs` updates a plugin's plugin.json and its marketplace entry
atomically. A hand edit to one file produces silent drift — this validator
catches it. Each plugin versions independently; we check every owned plugin
(marketplace entries whose `source` is a local "./..." string).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_DIR = ROOT / "plugins"
MARKETPLACE_JSON = ROOT / ".claude-plugin" / "marketplace.json"

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"


def main() -> int:
    print(f"{BOLD}Version Sync Check{RESET}")

    if not MARKETPLACE_JSON.exists():
        print(f"  {RED}FAIL{RESET}  {MARKETPLACE_JSON.relative_to(ROOT)} not found")
        return 1

    marketplace = json.loads(MARKETPLACE_JSON.read_text(encoding="utf-8"))
    entries = marketplace.get("plugins", [])

    errors = 0
    checked = 0

    for entry in entries:
        # Only owned plugins have a local "./..." source string; external sources are objects.
        source = entry.get("source")
        if not isinstance(source, str) or not source.startswith("./"):
            continue

        name = entry.get("name")
        entry_version = entry.get("version")
        plugin_json = PLUGINS_DIR / name / ".claude-plugin" / "plugin.json"

        if not plugin_json.exists():
            print(f"  {RED}FAIL{RESET}  {name}: {plugin_json.relative_to(ROOT)} not found")
            errors += 1
            continue

        plugin = json.loads(plugin_json.read_text(encoding="utf-8"))
        plugin_version = plugin.get("version")
        checked += 1

        if plugin_version == entry_version and plugin_version is not None:
            print(f"  {GREEN}OK{RESET}    {name} @ {plugin_version}")
        else:
            print(
                f"  {RED}FAIL{RESET}  {name}: plugin.json={plugin_version!r} "
                f"!= marketplace entry={entry_version!r}"
            )
            errors += 1

    if checked == 0:
        print(f"  {YELLOW}WARN{RESET}  no owned plugins found in marketplace.json")

    return 1 if errors > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
