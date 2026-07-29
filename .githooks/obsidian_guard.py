#!/usr/bin/python3
"""Keep automatic Obsidian Git commits inside the public writing allowlist."""

from pathlib import Path
from urllib.parse import unquote
import re
import subprocess
import sys


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
assets_root = (root / "content" / "assets").resolve()
referenced_assets: set[str] = set()
errors: list[str] = []

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

disallowed: list[str] = []
publishable: list[str] = []
for staged_path in staged_paths:
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
