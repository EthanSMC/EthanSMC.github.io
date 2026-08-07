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
assets_root = (root / "content" / "assets").resolve()
withdrawals_root = root / "content" / ".lifecycle" / "withdrawals"
referenced_assets: set[str] = set()
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
