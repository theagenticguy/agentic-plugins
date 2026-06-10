#!/usr/bin/env node
/**
 * Bump a single plugin's version across its plugin.json and the marketplace entry.
 *
 * Usage: node tools/bump-version.cjs <plugin> <major|minor|patch>
 *   or:  mise run bump -- <plugin> <patch>
 *
 * Each plugin in this marketplace versions independently. The marketplace's own
 * metadata.version tracks the highest plugin version so the registry has a
 * monotonic stamp, but individual plugins release on their own cadence.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const MARKETPLACE_JSON = path.join(ROOT, ".claude-plugin", "marketplace.json");

const pluginName = process.argv[2];
const level = process.argv[3];

if (!pluginName || !["major", "minor", "patch"].includes(level)) {
  console.error("Usage: node tools/bump-version.cjs <plugin> <major|minor|patch>");
  const existing = fs.existsSync(PLUGINS_DIR)
    ? fs.readdirSync(PLUGINS_DIR).filter((d) => fs.statSync(path.join(PLUGINS_DIR, d)).isDirectory())
    : [];
  console.error(`Plugins: ${existing.join(", ") || "(none)"}`);
  process.exit(1);
}

const PLUGIN_JSON = path.join(PLUGINS_DIR, pluginName, ".claude-plugin", "plugin.json");
if (!fs.existsSync(PLUGIN_JSON)) {
  console.error(`Error: ${path.relative(ROOT, PLUGIN_JSON)} not found`);
  process.exit(1);
}

// Read current version from plugin.json (source of truth for this plugin)
const plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8"));
const oldVersion = plugin.version;
const [major, minor, patch] = oldVersion.split(".").map(Number);

let newVersion;
switch (level) {
  case "major":
    newVersion = `${major + 1}.0.0`;
    break;
  case "minor":
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case "patch":
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

// Update this plugin's plugin.json
plugin.version = newVersion;
fs.writeFileSync(PLUGIN_JSON, JSON.stringify(plugin, null, 2) + "\n", "utf8");

// Update the matching marketplace entry, and roll metadata.version up to the
// highest owned-plugin version.
const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_JSON, "utf8"));
let found = false;
for (const p of marketplace.plugins) {
  if (p.name === pluginName) {
    p.version = newVersion;
    found = true;
  }
}
if (!found) {
  console.error(`Warning: no marketplace.json entry named '${pluginName}'`);
}

const cmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};
const owned = marketplace.plugins
  .filter((p) => typeof p.source === "string" && p.source.startsWith("./") && p.version)
  .map((p) => p.version);
marketplace.metadata.version = owned.reduce((hi, v) => (cmp(v, hi) > 0 ? v : hi), "0.0.0");

fs.writeFileSync(MARKETPLACE_JSON, JSON.stringify(marketplace, null, 2) + "\n", "utf8");

console.log(`${pluginName}: ${oldVersion} → ${newVersion}`);
console.log(`marketplace.metadata.version → ${marketplace.metadata.version}`);
