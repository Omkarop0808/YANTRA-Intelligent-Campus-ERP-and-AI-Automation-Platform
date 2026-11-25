#!/usr/bin/env bash
# Generates 2048-bit RSA key pair for RS256 JWT asymmetric signing/verification
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS_DIR="$ROOT_DIR/keys"

mkdir -p "$KEYS_DIR"

PRIVATE_KEY="$KEYS_DIR/jwtRS256.key"
PUBLIC_KEY="$KEYS_DIR/jwtRS256.key.pub"

if [ -f "$PRIVATE_KEY" ] && [ -f "$PUBLIC_KEY" ]; then
  echo "RSA key pair already exists in $KEYS_DIR."
  exit 0
fi

echo "Generating 2048-bit RSA private key..."
openssl genrsa -out "$PRIVATE_KEY" 2048

echo "Extracting RSA public key..."
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"

chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

echo "✅ Generated RS256 key pair:"
echo "   Private Key: $PRIVATE_KEY (Express signing only)"
echo "   Public Key:  $PUBLIC_KEY (Python/FastAPI verification only)"
