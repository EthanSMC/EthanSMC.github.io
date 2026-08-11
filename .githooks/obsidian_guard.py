#!/usr/bin/python3
"""Keep automatic Obsidian Git commits inside the public writing allowlist."""

from pathlib import Path
from urllib.parse import unquote
from datetime import datetime, timedelta, timezone
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from typing import Optional


TIMESTAMP_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{6}\.md$")
MARKDOWN_ATTACHMENT = re.compile(
    r"!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))"
    r"(?:\s+[\"'][^\"']*[\"'])?\s*\)"
)


def git(*args: str, text: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=text,
    )


def reject(errors: list[str]) -> None:
    print("Obsidian Git commit rejected:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    print(
        "Fix the content issue, then let Obsidian Git retry.",
        file=sys.stderr,
    )
    raise SystemExit(1)


root = Path(git("rev-parse", "--show-toplevel").stdout.strip()).resolve()
published_root = (root / "content" / "published").resolve()
drafts_root = (root / "content" / "drafts").resolve()
assets_root = root / "content" / "assets"
withdrawals_root = root / "content" / ".lifecycle" / "withdrawals"
referenced_assets: set[str] = set()
validated_albums: set[str] = set()
errors: list[str] = []

published_ids = {
    path.stem
    for path in published_root.glob("*.md")
    if TIMESTAMP_NAME.fullmatch(path.name)
}
draft_ids = {
    path.stem
    for path in drafts_root.glob("*.md")
    if TIMESTAMP_NAME.fullmatch(path.name)
}
if published_ids & draft_ids:
    reject(["同一文章不能同时位于 published 和 drafts"])


def withdrawal_marker_path_is_safe(marker_path: Path) -> bool:
    """Require regular marker files beneath real repository directories."""
    try:
        relative = marker_path.relative_to(root)
    except ValueError:
        return False

    current = root
    for part in relative.parts[:-1]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(mode):
            return False

    try:
        marker_mode = marker_path.lstat().st_mode
    except FileNotFoundError:
        return True
    return stat.S_ISREG(marker_mode)


def write_marker_atomically(marker_path: Path, marker: dict[str, str]) -> None:
    contents = json.dumps(marker, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(
        dir=marker_path.parent,
        prefix=f".{marker_path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary_file:
            temporary_file.write(contents)
        os.replace(temporary_path, marker_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def frontmatter_scalar(
    raw_value: str,
    markdown_path: Path,
    key: str,
    source_label: str,
) -> Optional[str]:
    value = raw_value.strip()
    if not value:
        errors.append(f"{source_label} {key} must not be empty: {markdown_path.relative_to(root)}")
        return None
    if value.startswith('"'):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            errors.append(f"invalid {source_label} {key}: {markdown_path.relative_to(root)}")
            return None
        if not isinstance(parsed, str):
            errors.append(f"{source_label} {key} must be text: {markdown_path.relative_to(root)}")
            return None
        return parsed
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            errors.append(f"invalid {source_label} {key}: {markdown_path.relative_to(root)}")
            return None
        inner = value[1:-1]
        if "'" in inner.replace("''", ""):
            errors.append(f"invalid {source_label} {key}: {markdown_path.relative_to(root)}")
            return None
        return inner.replace("''", "'")
    return value


def album_metadata(
    source: str,
    markdown_path: Path,
    source_label: str = "Album Markdown",
) -> Optional[dict[str, Optional[str]]]:
    lines = source.splitlines()
    if not lines or lines[0].removesuffix("\r") != "---":
        errors.append(f"{source_label} must start with frontmatter: {markdown_path.relative_to(root)}")
        return None

    metadata: dict[str, Optional[str]] = {}
    closed = False
    for line in lines[1:]:
        line = line.removesuffix("\r")
        if line == "---":
            closed = True
            break
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)", line)
        if not match or match.group(1) not in {"kind", "cover"}:
            continue
        key, raw_value = match.groups()
        if key in metadata:
            errors.append(f"duplicate {source_label} {key}: {markdown_path.relative_to(root)}")
            return None
        metadata[key] = frontmatter_scalar(raw_value, markdown_path, key, source_label)

    if not closed:
        errors.append(f"{source_label} has unterminated frontmatter: {markdown_path.relative_to(root)}")
        return None
    if metadata.get("kind") != "album":
        errors.append(f"{source_label} must declare kind: album: {markdown_path.relative_to(root)}")
        return None
    return metadata


def validate_album_cover(reference: str, markdown_path: Path) -> Optional[str]:
    match = re.fullmatch(r"\[\[assets/([^\[\]|#]+)\]\]", reference)
    if not match:
        errors.append(
            f"album cover must be an exact [[assets/...]] wikilink: "
            f"{markdown_path.relative_to(root)}"
        )
        return None

    relative_text = match.group(1)
    parts = relative_text.split("/")
    if (
        relative_text.strip() != relative_text
        or "\\" in relative_text
        or any(not part or part in {".", ".."} for part in parts)
        or Path(relative_text).is_absolute()
        or Path(relative_text).as_posix() != relative_text
    ):
        errors.append(
            f"album cover must stay inside content/assets: {markdown_path.relative_to(root)}"
        )
        return None

    try:
        assets_mode = assets_root.lstat().st_mode
    except FileNotFoundError:
        errors.append(f"missing album cover: {markdown_path.relative_to(root)}")
        return None
    if not stat.S_ISDIR(assets_mode):
        errors.append(
            f"album cover must be a regular file inside content/assets: "
            f"{markdown_path.relative_to(root)}"
        )
        return None

    current = assets_root
    for index, part in enumerate(parts):
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            errors.append(
                f"missing album cover: {current.relative_to(root)} "
                f"referenced by {markdown_path.relative_to(root)}"
            )
            return None
        is_cover = index == len(parts) - 1
        if (is_cover and not stat.S_ISREG(mode)) or (not is_cover and not stat.S_ISDIR(mode)):
            errors.append(
                f"album cover must be a regular file inside content/assets: "
                f"{markdown_path.relative_to(root)}"
            )
            return None

    return (Path("content/assets") / Path(*parts)).as_posix()


album_index_raw = git(
    "ls-files",
    "--stage",
    "-z",
    "--",
    "content/albums",
    text=False,
).stdout
for entry in (value for value in album_index_raw.split(b"\0") if value):
    index_metadata, path_bytes = entry.split(b"\t", 1)
    mode_bytes, object_bytes, stage_bytes = index_metadata.split()
    album_relative = path_bytes.decode("utf-8", errors="surrogateescape")
    album_candidate = Path(album_relative)
    if album_candidate.parent != Path("content/albums") or album_candidate.suffix != ".md":
        continue
    markdown_path = root / album_candidate
    if mode_bytes not in {b"100644", b"100755"} or stage_bytes != b"0":
        errors.append(
            f"staged Album Markdown must be a regular file: {album_relative}"
        )
        continue
    source_bytes = git(
        "cat-file",
        "blob",
        object_bytes.decode("ascii"),
        text=False,
    ).stdout
    try:
        source = source_bytes.decode("utf-8")
    except UnicodeDecodeError:
        errors.append(f"staged Album Markdown must be UTF-8: {album_relative}")
        continue
    metadata = album_metadata(source, markdown_path, "staged Album Markdown")
    if metadata is None:
        continue
    validated_albums.add(album_relative)
    cover = metadata.get("cover")
    if cover:
        validated_cover = validate_album_cover(cover, markdown_path)
        if validated_cover:
            referenced_assets.add(validated_cover)


deleted_raw = git(
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=D",
    text=False,
).stdout
deleted_paths = {
    value.decode("utf-8", errors="surrogateescape")
    for value in deleted_raw.split(b"\0")
    if value
}

pending_withdrawal_markers: list[tuple[str, Path]] = []
for deleted_path in sorted(deleted_paths):
    candidate = Path(deleted_path)
    if (
        candidate.parent != Path("content/published")
        or not TIMESTAMP_NAME.fullmatch(candidate.name)
    ):
        continue
    if not (drafts_root / candidate.name).is_file():
        continue
    pending_withdrawal_markers.append(
        (candidate.stem, withdrawals_root / f"{candidate.stem}.json")
    )

if any(
    not withdrawal_marker_path_is_safe(marker_path)
    for _, marker_path in pending_withdrawal_markers
):
    reject(["withdrawal marker path must be a regular file inside the repository"])


def normalize_published_filenames() -> None:
    """Assign internal timestamp IDs when a normally named note is published."""
    if not published_root.exists():
        return

    candidates = [
        path
        for path in sorted(published_root.glob("*.md"))
        if not TIMESTAMP_NAME.fullmatch(path.name)
    ]
    if not candidates:
        return

    next_timestamp = datetime.now().astimezone().replace(microsecond=0)
    renamed: list[tuple[Path, Path]] = []
    for source in candidates:
        while True:
            destination = published_root / f"{next_timestamp:%Y-%m-%d-%H%M%S}.md"
            next_timestamp += timedelta(seconds=1)
            if not destination.exists():
                break
        source.rename(destination)
        renamed.append((source, destination))

    subprocess.run(
        ["git", "add", "-A", "--", "content/published"],
        cwd=root,
        check=True,
    )
    for source, destination in renamed:
        print(
            f"Obsidian Git assigned {source.name} -> {destination.name}",
            file=sys.stderr,
        )


normalize_published_filenames()

for markdown_path in sorted(published_root.glob("*.md")) if published_root.exists() else []:
    if not TIMESTAMP_NAME.fullmatch(markdown_path.name):
        errors.append(
            f"published filename must use YYYY-MM-DD-HHmmss.md: "
            f"{markdown_path.relative_to(root)}"
        )
        continue
    try:
        source = markdown_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        errors.append(f"published Markdown must be UTF-8: {markdown_path.relative_to(root)}")
        continue

    for match in MARKDOWN_ATTACHMENT.finditer(source):
        raw_target = unquote(match.group(1) or match.group(2)).split("#", 1)[0]
        if "://" in raw_target or raw_target.startswith(("data:", "mailto:")):
            continue
        target = (markdown_path.parent / raw_target).resolve()
        try:
            relative_asset = target.relative_to(assets_root)
        except ValueError:
            continue
        if not target.is_file():
            errors.append(f"missing published attachment: {target.relative_to(root)}")
            continue
        referenced_assets.add((Path("content/assets") / relative_asset).as_posix())

if errors:
    reject(errors)

if referenced_assets:
    subprocess.run(
        ["git", "add", "-f", "--", *sorted(referenced_assets)],
        cwd=root,
        check=True,
    )

for _, marker_path in pending_withdrawal_markers:
    marker_path.parent.mkdir(parents=True, exist_ok=True)

if any(
    not withdrawal_marker_path_is_safe(marker_path)
    for _, marker_path in pending_withdrawal_markers
):
    reject(["withdrawal marker path must be a regular file inside the repository"])

generated_withdrawal_markers: set[str] = set()
for post_id, marker_path in pending_withdrawal_markers:
    marker = {
        "postId": post_id,
        "requestedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    write_marker_atomically(marker_path, marker)
    marker_relative = marker_path.relative_to(root).as_posix()

    generated_withdrawal_markers.add(marker_relative)

if generated_withdrawal_markers:
    subprocess.run(
        ["git", "add", "--", *sorted(generated_withdrawal_markers)],
        cwd=root,
        check=True,
    )

staged_raw = git(
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACDMRTUXB",
    text=False,
).stdout
staged_paths = [
    value.decode("utf-8", errors="surrogateescape")
    for value in staged_raw.split(b"\0")
    if value
]

disallowed: list[str] = []
publishable: list[str] = []
for staged_path in staged_paths:
    if staged_path in generated_withdrawal_markers:
        publishable.append(staged_path)
        continue
    candidate = Path(staged_path)
    if candidate.parent == Path("content/albums") and candidate.suffix == ".md":
        if staged_path in validated_albums or staged_path in deleted_paths:
            publishable.append(staged_path)
        else:
            disallowed.append(staged_path)
        continue
    if candidate.parent == Path("content/published") and candidate.suffix == ".md":
        if not TIMESTAMP_NAME.fullmatch(candidate.name):
            disallowed.append(staged_path)
        else:
            publishable.append(staged_path)
        continue
    if staged_path.startswith("content/assets/"):
        if staged_path in referenced_assets or staged_path in deleted_paths:
            publishable.append(staged_path)
            continue
    disallowed.append(staged_path)

if disallowed:
    subprocess.run(
        ["git", "restore", "--staged", "--", *disallowed],
        cwd=root,
        check=True,
    )
    print(
        f"Obsidian Git left {len(disallowed)} website change(s) out of the publishing commit.",
        file=sys.stderr,
    )

if not publishable:
    reject(["automatic sync found no publishable content; website changes remain uncommitted"])
