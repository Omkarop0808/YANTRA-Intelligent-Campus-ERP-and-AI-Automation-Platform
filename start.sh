#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

echo "=================================================="
echo " Starting Yantra ERP Full Stack Services"
echo "=================================================="

# Kill all child background processes on exit (Ctrl+C)
trap 'kill 0' SIGINT SIGTERM EXIT

echo "[1/3] Launching Express Backend (http://localhost:3000)..."
(cd "$DIR/express-backend" && npm run dev) &

echo "[2/3] Launching Python AI Backend (http://localhost:8000)..."
(cd "$DIR/python-backend" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --reload) &

echo "[3/3] Launching Frontend (http://localhost:5173)..."
(cd "$DIR/frontend" && npm run dev -- --host) &

echo "=================================================="
echo " All services started! Press Ctrl+C to terminate."
echo "=================================================="

wait

