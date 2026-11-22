#!/usr/bin/env python3
"""Delegate to the single build-context implementation in pinned Model build support."""
from pathlib import Path
import json
import os
import subprocess
import sys

metadata = json.loads(subprocess.check_output([
    "cargo", "metadata", "--format-version", "1", "--offline", "--locked"
]))
packages = [p for p in metadata["packages"] if p["name"] == "intersect-build-support" and
            p.get("source", "").startswith("git+https://github.com/mercurio-labs/intersect-model.git?")]
if len(packages) != 1:
    raise SystemExit("Expected one immutable paired Model build-support package")
implementation = Path(packages[0]["manifest_path"]).parent.parent.parent / "tools/compiler_build.py"
raise SystemExit(subprocess.call([sys.executable, "-B", str(implementation), *sys.argv[1:]], env=os.environ))
