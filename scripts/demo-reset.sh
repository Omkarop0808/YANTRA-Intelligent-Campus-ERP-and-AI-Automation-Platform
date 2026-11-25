#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)"

echo "=================================================="
echo " [Yantra ERP] Resetting Demo State & Reseeding..."
echo "=================================================="

# Check Express health
if ! curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "⚠️ Warning: Express backend not reachable at http://localhost:3000."
  echo "   Make sure services are started with ./start.sh or docker compose up."
fi

# Run seed all
echo "[1/3] Running database seeds..."
(
  cd "$DIR/express-backend"
  npm run seed:admin
  npm run seed:demo
  npm run seed:quizzes
  npm run seed:announcements
  npm run seed:grade-batch
  npm run seed:attendance
  npm run seed:student-data
)

echo "[2/3] Verifying backend health checks..."
curl -s http://localhost:3000/api/health | jq .
curl -s http://localhost:8000/python-app/health | jq .

echo "=================================================="
echo " Demo reset complete! Verified credentials:"
echo " - Admin:   admin@university.edu / AdminPassword123!"
echo " - Teacher: prof.adrian@university.edu / Teacher123"
echo " - Student: aarav.sharma@university.edu / Student123"
echo " - Parent:  parent.sharma@university.edu / Parent123!"
echo "=================================================="
