#!/usr/bin/env bash
set -euo pipefail
if command -v cargo &>/dev/null; then
  echo "cargo found: $(cargo --version)"
  exit 0
else
  echo "cargo not found. Install Rust from https://rustup.rs/"
  echo "Run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi
