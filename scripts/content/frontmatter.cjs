const RESERVED_KEYS = new Set([
  "kind", "album", "track", "wechat", "cast", "slug", "status",
  "featured", "order", "cover", "cover_alt", "cover_cast", "description",
]);

const RESERVED_TYPES = new Map([
  ["kind", "string"],
  ["album", "string"],
  ["track", "integer"],
  ["wechat", "boolean"],
  ["cast", "string"],
  ["slug", "string"],
  ["status", "string"],
  ["featured", "boolean"],
  ["order", "integer"],
  ["cover", "string"],
  ["cover_alt", "string"],
  ["cover_cast", "string"],
  ["description", "string"],
]);

function invalidFrontmatter(filename, message) {
  throw new Error(`Invalid frontmatter in ${filename}: ${message}`);
}

function splitFlatArray(source, filename, key) {
  const values = [];
  let value = "";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      value += character;
      if (quote === '"' && character === "\\") {
        index += 1;
        if (index >= source.length) invalidFrontmatter(filename, `invalid array for ${key}`);
        value += source[index];
      } else if (character === quote) {
        if (quote === "'" && source[index + 1] === "'") {
          value += source[++index];
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      value += character;
    } else if (character === ",") {
      if (!value.trim()) invalidFrontmatter(filename, `invalid array for ${key}`);
      values.push(value.trim());
      value = "";
    } else if (["[", "]", "{", "}"].includes(character)) {
      invalidFrontmatter(filename, `nested values are not supported for ${key}`);
    } else {
      value += character;
    }
  }

  if (quote || !value.trim()) invalidFrontmatter(filename, `invalid array for ${key}`);
  values.push(value.trim());
  return values;
}

function parseQuotedString(value, filename, key) {
  const quote = value[0];
  if (value.at(-1) !== quote || value.length < 2) {
    invalidFrontmatter(filename, `unterminated quoted value for ${key}`);
  }
  if (quote === '"') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch {
      invalidFrontmatter(filename, `invalid quoted value for ${key}`);
    }
  }

  const inner = value.slice(1, -1);
  if (inner.replaceAll("''", "").includes("'")) {
    invalidFrontmatter(filename, `invalid quoted value for ${key}`);
  }
  return inner.replaceAll("''", "'");
}

function parseValue(rawValue, filename, key, allowArray = true) {
  const value = rawValue.trim();
  if (!value) invalidFrontmatter(filename, `missing value for ${key}`);
  if (value === "|" || value === ">" || value.startsWith("|-") || value.startsWith(">-")) {
    invalidFrontmatter(filename, `multiline values are not supported for ${key}`);
  }
  if (value.startsWith("{") || value.endsWith("}")) {
    invalidFrontmatter(filename, `nested mappings are not supported for ${key}`);
  }
  if (/^\[\[[^\r\n]*\]\]$/.test(value)) return value;
  if (value.startsWith("[") || value.endsWith("]")) {
    if (!allowArray || !value.startsWith("[") || !value.endsWith("]")) {
      invalidFrontmatter(filename, `invalid array for ${key}`);
    }
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlatArray(inner, filename, key)
      .map((item) => parseValue(item, filename, key, false));
  }
  if (value.startsWith('"') || value.startsWith("'") || value.endsWith('"') || value.endsWith("'")) {
    if (!['"', "'"].includes(value[0])) {
      invalidFrontmatter(filename, `invalid quoted value for ${key}`);
    }
    return parseQuotedString(value, filename, key);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) {
    const integer = Number(value);
    if (!Number.isSafeInteger(integer)) invalidFrontmatter(filename, `integer is out of range for ${key}`);
    return integer;
  }
  return value;
}

function assertReservedType(key, value, filename) {
  if (!RESERVED_KEYS.has(key)) return;
  const expected = RESERVED_TYPES.get(key);
  const valid = expected === "integer"
    ? Number.isInteger(value)
    : typeof value === expected;
  if (!valid) {
    invalidFrontmatter(filename, `${key} must be a ${expected}`);
  }
}

function parseFrontmatter(source, filename = "unknown Markdown file") {
  const firstNewline = source.indexOf("\n");
  const firstLine = (firstNewline < 0 ? source : source.slice(0, firstNewline)).replace(/\r$/, "");
  if (firstLine !== "---") {
    return { attributes: {}, bodySource: source, hasFrontmatter: false };
  }
  if (firstNewline < 0) invalidFrontmatter(filename, "unterminated delimiter");

  const frontmatterLines = [];
  let cursor = firstNewline + 1;
  let bodyStart = null;
  while (cursor <= source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const end = lineEnd < 0 ? source.length : lineEnd;
    const line = source.slice(cursor, end).replace(/\r$/, "");
    if (line === "---") {
      bodyStart = lineEnd < 0 ? source.length : lineEnd + 1;
      break;
    }
    frontmatterLines.push(line);
    if (lineEnd < 0) break;
    cursor = lineEnd + 1;
  }
  if (bodyStart === null) invalidFrontmatter(filename, "unterminated delimiter");

  const attributes = {};
  for (const line of frontmatterLines) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) || /^-\s/.test(line)) {
      invalidFrontmatter(filename, "nested mappings and multiline YAML are not supported");
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/);
    if (!match) invalidFrontmatter(filename, `malformed line: ${line}`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(attributes, key)) invalidFrontmatter(filename, `duplicate key: ${key}`);
    const value = parseValue(rawValue, filename, key);
    assertReservedType(key, value, filename);
    attributes[key] = value;
  }

  return {
    attributes,
    bodySource: source.slice(bodyStart),
    hasFrontmatter: true,
  };
}

module.exports = { parseFrontmatter };
