#!/usr/bin/env python3
"""Extract a single version's release notes from CHANGELOG.md."""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract release notes for VERSION from CHANGELOG.md."
    )
    parser.add_argument("version", help="Release version, with or without a leading v.")
    parser.add_argument(
        "output",
        nargs="?",
        help="Optional output file. Defaults to stdout.",
    )
    parser.add_argument(
        "--changelog",
        default="CHANGELOG.md",
        help="Path to the changelog file. Defaults to CHANGELOG.md.",
    )
    return parser.parse_args()


def extract_release_notes(changelog: str, version: str) -> str:
    normalized_version = version.removeprefix("v")
    header_pattern = re.compile(
        rf"^## \[{re.escape(normalized_version)}\](?:\s+-\s+[^\n]+)?\s*$",
        re.MULTILINE,
    )
    match = header_pattern.search(changelog)
    if not match:
        raise ValueError(f"Could not find CHANGELOG.md section for {normalized_version}")

    next_header = re.search(r"^## \[[^\]]+\].*$", changelog[match.end() :], re.MULTILINE)
    end = match.end() + next_header.start() if next_header else len(changelog)
    notes = changelog[match.end() : end].strip()
    if not notes:
        raise ValueError(f"CHANGELOG.md section for {normalized_version} is empty")

    return notes + "\n"


def main() -> int:
    args = parse_args()
    changelog_path = pathlib.Path(args.changelog)
    changelog = changelog_path.read_text(encoding="utf-8")

    try:
        notes = extract_release_notes(changelog, args.version)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.output:
        output_path = pathlib.Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(notes, encoding="utf-8")
    else:
        print(notes, end="")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
