#!/usr/bin/env bash
# Pattern scanner to ensure no real secrets exist in tracked files or documentation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Running secret pattern scanner across git-tracked files ==="

ERRORS=0

# Patterns that indicate leaked credentials or real secrets in repo
SUSPICIOUS_PATTERNS=(
  "EHTUm7alnPTK8O3cJgstFv8sb8c"
  "877172522699452"
  "draadaft3"
  "yantra-erp-super-secret-jwt-key"
  "-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----"
  "AKIA[0-9A-Z]{16}"
  "AIzaSy[0-9A-Za-z_-]{33}"
)

# Check tracked files only
TRACKED_FILES=$(git ls-files)

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  # Exclude this script and AUDIT.md from flagging itself
  MATCHES=$(git grep -E -n "$pattern" -- $TRACKED_FILES 2>/dev/null | grep -v "scripts/check-secrets.sh" | grep -v "AUDIT.md" || true)
  if [ -n "$MATCHES" ]; then
    echo "❌ High-risk secret pattern detected: $pattern"
    echo "$MATCHES" | while read -r line; do
      FILE=$(echo "$line" | cut -d: -f1)
      LNUM=$(echo "$line" | cut -d: -f2)
      echo "   at $FILE:$LNUM [REDACTED SECRET]"
    done
    ERRORS=$((ERRORS + 1))
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo "FAILED: $ERRORS secret violations found in tracked files. Sanitize before committing."
  exit 1
else
  echo "✅ All tracked files passed secret scan. No plain secrets found."
  exit 0
fi
