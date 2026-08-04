const fs = require("node:fs");
const path = require("node:path");

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function loadEnvFile(root, filename = process.env.WECHAT_ENV_FILE || ".env.local") {
  const absolutePath = path.isAbsolute(filename) ? filename : path.resolve(root, filename);
  if (!fs.existsSync(absolutePath)) return { loaded: false, path: absolutePath };
  const values = parseEnv(fs.readFileSync(absolutePath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { loaded: true, path: absolutePath };
}

module.exports = { loadEnvFile, parseEnv };
