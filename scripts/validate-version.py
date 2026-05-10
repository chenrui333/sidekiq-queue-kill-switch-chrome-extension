#!/usr/bin/env python3
"""
Validate that manifest.json and package.json versions match the expected version
(from git tag).

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


def find_repo_file(filename):
    paths = [
        filename,
        os.path.join(os.path.dirname(os.path.dirname(__file__)), filename),
    ]
    for path in paths:
        if os.path.exists(path):
            return path
    return None


def load_json_file(filename):
    path = find_repo_file(filename)
    if not path:
        print(f"::error::{filename} not found")
        sys.exit(1)

    try:
        with open(path, "r") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"::error::Failed to parse {filename}: {e}")
        sys.exit(1)


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <expected_version>")
        print("Example: python3 scripts/validate-version.py 1.0.1")
        sys.exit(1)

    expected_version = sys.argv[1]

    manifest = load_json_file("manifest.json")
    package = load_json_file("package.json")
    manifest_version = manifest.get("version")
    package_version = package.get("version")

    if not manifest_version:
        print("::error::No 'version' field found in manifest.json")
        sys.exit(1)
    if not package_version:
        print("::error::No 'version' field found in package.json")
        sys.exit(1)

    if manifest_version != expected_version or package_version != expected_version:
        print("::error::Version mismatch!")
        print(f"  Tag version:      {expected_version}")
        print(f"  Manifest version: {manifest_version}")
        print(f"  Package version:  {package_version}")
        print("")
        print("To fix: Update manifest.json and package.json versions to match your tag,")
        print("        or create a tag that matches both versions.")
        sys.exit(1)

    print(f"✓ Version validated: {manifest_version}")
    sys.exit(0)


if __name__ == "__main__":
    main()
