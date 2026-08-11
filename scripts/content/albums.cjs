const fs = require("node:fs");
const path = require("node:path");

const { parseFrontmatter } = require("./frontmatter.cjs");

const ALLOWED_KINDS = new Set(["album", "article", "note"]);
const ALLOWED_CASTS = new Set(["auto", "mochi", "molly", "none"]);

function contentError(filename, message) {
  throw new Error(`${message}: ${filename}`);
}

function publicAssetUrl(relativePath) {
  return `/blog/assets/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function albumCoverRecord(reference, filename, assetsDir) {
  if (reference === undefined) {
    return { cover: null, coverAsset: null, coverReference: null };
  }
  const match = typeof reference === "string"
    ? reference.match(/^\[\[assets\/([^\[\]|#]+)\]\]$/)
    : null;
  if (!match) {
    contentError(filename, "Album cover must be an exact [[assets/...]] wikilink");
  }

  const relativePath = match[1];
  const segments = relativePath.split("/");
  if (
    relativePath.trim() !== relativePath
    || relativePath.includes("\\")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || path.posix.normalize(relativePath) !== relativePath
  ) {
    contentError(filename, "Album cover must stay inside content/assets");
  }

  let current = assetsDir;
  try {
    const assetsStats = fs.lstatSync(current);
    if (!assetsStats.isDirectory() || assetsStats.isSymbolicLink()) {
      contentError(filename, "Album cover must be a regular file inside content/assets");
    }
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      const stats = fs.lstatSync(current);
      const isCover = index === segments.length - 1;
      if (stats.isSymbolicLink() || (isCover ? !stats.isFile() : !stats.isDirectory())) {
        contentError(filename, "Album cover must be a regular file inside content/assets");
      }
    }
  } catch (error) {
    if (error?.code === "ENOENT") contentError(filename, "Missing album cover");
    throw error;
  }

  return {
    cover: publicAssetUrl(relativePath),
    coverAsset: relativePath,
    coverReference: reference,
  };
}

function resolveAlbumReference(reference, albums, filename = "unknown article") {
  const match = typeof reference === "string"
    ? reference.match(/^\[\[([^\[\]|#]+)\]\]$/)
    : null;
  const basename = match?.[1];
  if (!basename || basename.trim() !== basename) {
    contentError(filename, "Album reference must be an exact [[Album basename]] wikilink");
  }
  const album = albums instanceof Map
    ? albums.get(basename)
    : albums.find((candidate) => candidate.basename === basename);
  if (!album) contentError(filename, `Album reference ${reference} not found`);
  return album;
}

function albumRecord(filename, source, assetsDir) {
  const basename = path.basename(filename, path.extname(filename));
  const { attributes, bodySource, hasFrontmatter } = parseFrontmatter(source, filename);
  if (!hasFrontmatter || attributes.kind !== "album") {
    contentError(filename, "Album file must declare kind: album");
  }
  if (!ALLOWED_KINDS.has(attributes.kind)) contentError(filename, "Unsupported album kind");
  if (typeof attributes.slug !== "string" || !attributes.slug.trim()) {
    contentError(filename, "Album slug must not be empty");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attributes.slug)) {
    contentError(filename, "Album slug must be a safe URL segment");
  }
  if (Object.hasOwn(attributes, "cover_cast") && !ALLOWED_CASTS.has(attributes.cover_cast)) {
    contentError(filename, `Unsupported album cover_cast ${attributes.cover_cast}`);
  }
  const cover = albumCoverRecord(attributes.cover, filename, assetsDir);
  return {
    ...attributes,
    ...cover,
    basename,
    filename,
    bodySource,
    order: attributes.order ?? null,
    featured: attributes.featured ?? false,
    coverAlt: attributes.cover_alt ?? null,
    coverCast: attributes.cover_cast ?? "auto",
    description: attributes.description ?? "",
    url: `/blog/albums/${attributes.slug}/`,
    outputPath: `blog/albums/${attributes.slug}/index.html`,
    tracks: [],
  };
}

function loadAlbums({ albumsDir, assetsDir = path.join(path.dirname(albumsDir), "assets"), posts = [] }) {
  const filenames = fs.existsSync(albumsDir)
    ? fs.readdirSync(albumsDir).filter((filename) => filename.endsWith(".md")).sort()
    : [];
  const albums = filenames.map((filename) => albumRecord(
    filename,
    fs.readFileSync(path.join(albumsDir, filename), "utf8"),
    assetsDir,
  ));

  const basenameOwners = new Map();
  const slugOwners = new Map();
  const orderOwners = new Map();
  let featured = null;
  for (const album of albums) {
    const normalizedBasename = album.basename.normalize("NFC");
    if (basenameOwners.has(normalizedBasename)) {
      contentError(album.filename, `Duplicate album basename ${album.basename}`);
    }
    basenameOwners.set(normalizedBasename, album.filename);

    if (slugOwners.has(album.slug)) contentError(album.filename, `Duplicate album slug ${album.slug}`);
    slugOwners.set(album.slug, album.filename);
    if (album.order !== null) {
      if (orderOwners.has(album.order)) contentError(album.filename, `Duplicate album order ${album.order}`);
      orderOwners.set(album.order, album.filename);
    }
    if (album.featured) {
      if (featured) contentError(album.filename, "Multiple featured albums are not allowed");
      featured = album;
    }
  }

  const albumsByBasename = new Map(albums.map((album) => [album.basename, album]));
  const tracksByAlbum = new Map(albums.map((album) => [album.slug, new Map()]));
  for (const post of posts) {
    if (post.albumReference === null) continue;
    const album = resolveAlbumReference(post.albumReference, albumsByBasename, post.filename);
    const tracks = tracksByAlbum.get(album.slug);
    if (tracks.has(post.track)) {
      contentError(post.filename, `Duplicate track ${post.track} in album ${album.slug}`);
    }
    tracks.set(post.track, post.filename);
    post.albumSlug = album.slug;
    album.tracks.push(post);
  }
  for (const album of albums) album.tracks.sort((left, right) => left.track - right.track);

  return albums.sort((left, right) => {
    if (left.order === null && right.order !== null) return 1;
    if (left.order !== null && right.order === null) return -1;
    if (left.order !== right.order) return left.order - right.order;
    return left.basename.localeCompare(right.basename, "zh-CN");
  });
}

module.exports = {
  ALLOWED_CASTS,
  ALLOWED_KINDS,
  loadAlbums,
  resolveAlbumReference,
};
