#!/usr/bin/env python3
"""
Validate that manifest.json version matches the expected version (from git tag).

Usage:
    python3 scripts/validate-version.py <expected_version>

Example:
    python3 scripts/validate-version.py 1.0.1

Exit codes:
    0 - Versions match
    1 - Version mismatch or error
"""

import json
import sys
import os


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <expected_version>")
        print("Example: python3 scripts/validate-version.py 1.0.1")
        sys.exit(1)

    expected_version = sys.argv[1]

    # Find manifest.json relative to script or current directory
    manifest_paths = [
        "manifest.json",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "manifest.json"),
    ]

    manifest_path = None
    for path in manifest_paths:
        if os.path.exists(path):
            manifest_path = path
            break

    if not manifest_path:
        print("::error::manifest.json not found")
        sys.exit(1)

    try:
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
    except json.JSONDecodeError as e:
        print(f"::error::Failed to parse manifest.json: {e}")
        sys.exit(1)

    manifest_version = manifest.get("version")

    if not manifest_version:
        print("::error::No 'version' field found in manifest.json")
        sys.exit(1)

    if manifest_version != expected_version:
        print("::error::Version mismatch!")
        print(f"  Tag version:      {expected_version}")
        print(f"  Manifest version: {manifest_version}")
        print("")
        print("To fix: Update manifest.json version to match your tag,")
        print("        or create a tag that matches the manifest version.")
        sys.exit(1)

    print(f"✓ Version validated: {manifest_version}")
    sys.exit(0)


if __name__ == "__main__":
    main()
