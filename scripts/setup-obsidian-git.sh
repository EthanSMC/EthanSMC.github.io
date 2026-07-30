#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

mkdir -p content/drafts content/published content/assets
git config core.hooksPath .githooks
/usr/bin/python3 "$repo_root/scripts/setup-obsidian-vault.py" "$repo_root/content"

echo "Git content guard enabled at .githooks"
echo "Open this folder as the Obsidian vault: $repo_root/content"
echo "Write with normal filenames; moving a note to published/ assigns its timestamp automatically"
