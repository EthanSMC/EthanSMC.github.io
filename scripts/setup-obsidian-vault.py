#!/usr/bin/python3
"""Prepare the ignored local Obsidian settings for the writing vault."""

from pathlib import Path
import json
import os
import shutil
import sys


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if len(sys.argv) != 2:
    raise SystemExit("Usage: setup-obsidian-vault.py <vault-path>")

vault = Path(sys.argv[1]).expanduser().resolve()
config = vault / ".obsidian"
plugin_target = config / "plugins" / "obsidian-git"

source_candidates = []
if os.environ.get("OBSIDIAN_GIT_PLUGIN_SOURCE"):
    source_candidates.append(Path(os.environ["OBSIDIAN_GIT_PLUGIN_SOURCE"]).expanduser())
source_candidates.append(
    Path.home() / "Documents" / "Obsidian_vault" / ".obsidian" / "plugins" / "obsidian-git"
)
source_candidates.extend(
    Path.home().glob("Documents/*/.obsidian/plugins/obsidian-git")
)

plugin_source = next(
    (
        candidate
        for candidate in source_candidates
        if (candidate / "manifest.json").is_file() and candidate.resolve() != plugin_target
    ),
    None,
)
if plugin_source:
    plugin_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(plugin_source, plugin_target, dirs_exist_ok=True)

app_path = config / "app.json"
app_settings = read_json(app_path, {})
app_settings.update(
    {
        "useMarkdownLinks": True,
        "newLinkFormat": "relative",
        "newFileLocation": "folder",
        "newFileFolderPath": "drafts",
        "attachmentFolderPath": "assets",
    }
)
write_json(app_path, app_settings)

if plugin_target.is_dir():
    enabled_path = config / "community-plugins.json"
    enabled_plugins = read_json(enabled_path, [])
    if "obsidian-git" not in enabled_plugins:
        enabled_plugins.append("obsidian-git")
    write_json(enabled_path, enabled_plugins)

    git_settings_path = plugin_target / "data.json"
    git_settings = read_json(git_settings_path, {})
    git_settings.update(
        {
            "commitMessage": "blog: sync {{date}}",
            "autoCommitMessage": "blog: sync {{date}}",
            "commitMessageScript": ".githooks/obsidian-commit-message.sh",
            "commitDateFormat": "YYYY-MM-DD HH:mm:ss",
            "autoSaveInterval": 2,
            "autoPushInterval": 0,
            "autoPullInterval": 0,
            "autoPullOnBoot": True,
            "autoCommitOnlyStaged": False,
            "disablePush": False,
            "pullBeforePush": True,
            "disablePopups": False,
            "showErrorNotices": True,
            "showStatusBar": True,
            "autoBackupAfterFileChange": True,
            "differentIntervalCommitAndPush": False,
        }
    )
    write_json(git_settings_path, git_settings)
    version = read_json(plugin_target / "manifest.json", {}).get("version", "unknown")
    print(f"Obsidian Git {version}: copied and configured locally")
else:
    print("Obsidian Git plugin files not found; install the Git community plugin in this vault")

print("Vault defaults: drafts/, assets/, relative Markdown links")
