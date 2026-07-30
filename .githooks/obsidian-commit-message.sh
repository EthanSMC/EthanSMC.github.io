#!/bin/sh
set -eu

obsidian_marker=$(git rev-parse --git-path obsidian-git-commit)
guard_passed_marker=$(git rev-parse --git-path obsidian-git-guard-passed)
rm -f "$guard_passed_marker"
: > "$obsidian_marker"

printf 'blog: sync %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
