#!/usr/bin/env python3
"""Compatibility entrypoint for normal-clock ingest smoke testing."""
import os, sys
from pathlib import Path
os.execv(sys.executable, [sys.executable, str(Path(__file__).with_name("spec-conformance.py")), "--wall-clock-smoke", *sys.argv[1:]])
