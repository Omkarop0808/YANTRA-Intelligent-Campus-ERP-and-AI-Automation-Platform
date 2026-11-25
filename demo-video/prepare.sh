#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DB="yantra_demo"
DEMO_URI="mongodb://127.0.0.1:27017/${DEMO_DB}"

# Load recording overrides (no secrets)
set -a
source "$SCRIPT_DIR/.env.recording"
set +a

echo "============================================================"
echo " Yantra Demo Video Environment Setup (DB: ${DEMO_DB})"
echo "============================================================"

# 1. Stop any running Express (:3000) or FastAPI (:8000) so we restart cleanly against yantra_demo
echo "[1/6] Stopping any existing processes on ports 3000 and 8000..."
for p in 3000 8000; do
  pids=$(lsof -tiTCP:${p} -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
  fi
done

# 2. Drop yantra_demo and seed minimum base data
echo "[2/6] Dropping and recreating ${DEMO_DB}..."
(cd "$ROOT_DIR/express-backend" && MONGODB_URI="$DEMO_URI" node -e '
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  console.log("Dropped database:", mongoose.connection.db.databaseName);
  await mongoose.disconnect();
})();
')

echo "[3/6] Seeding base data (admin, demo students/teachers/parent, quizzes, grades, attendance)..."
(cd "$ROOT_DIR/express-backend" && \
  MONGODB_URI="$DEMO_URI" ADMIN_EMAIL="admin@university.edu" ADMIN_PASSWORD="AdminPassword123!" npm run seed:admin && \
  MONGODB_URI="$DEMO_URI" npm run seed:demo && \
  MONGODB_URI="$DEMO_URI" npm run seed:quizzes && \
  MONGODB_URI="$DEMO_URI" npm run seed:announcements && \
  MONGODB_URI="$DEMO_URI" npm run seed:grade-batch && \
  MONGODB_URI="$DEMO_URI" npm run seed:attendance && \
  MONGODB_URI="$DEMO_URI" npm run seed:student-data)

# 3. Remove "Third Year C" (TE-C) so Scene 2 creates it from scratch, and verify with a real query
echo "[4/6] Removing Third Year C (TE-C) so Scene 2 starts clean & verifying..."
(cd "$ROOT_DIR/express-backend" && MONGODB_URI="$DEMO_URI" node -e '
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const teC = await db.collection("divisions").findOne({ $or: [{ name: "Third Year C" }, { code: "TE-C" }] });
  if (teC) {
    await db.collection("schedules").deleteMany({ division: teC._id });
    await db.collection("lectures").deleteMany({ division: teC._id });
    await db.collection("attendances").deleteMany({ division: teC._id });
    await db.collection("quizzes").deleteMany({ division: teC._id });
    await db.collection("resources").deleteMany({ division: teC._id });
    await db.collection("notifications").deleteMany({ division: teC._id });
    await db.collection("users").updateMany(
      {},
      { $pull: { divisionRefs: teC._id, assignedDivisions: { $in: ["TE-C", "Third Year C"] } } }
    );
    await db.collection("divisions").deleteOne({ _id: teC._id });
  }
  const verify = await db.collection("divisions").findOne({ $or: [{ name: "Third Year C" }, { code: "TE-C" }] });
  const validDivIds = new Set((await db.collection("divisions").find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
  const countOrphans = async (col, field) => {
    const docs = await db.collection(col).find({ [field]: { $exists: true, $ne: null } }, { projection: { [field]: 1 } }).toArray();
    return docs.filter(d => Array.isArray(d[field]) ? d[field].some(v => !validDivIds.has(String(v))) : !validDivIds.has(String(d[field]))).length;
  };
  const orphans = {
    users_divisionRef: await countOrphans("users", "divisionRef"),
    users_divisionRefs: await countOrphans("users", "divisionRefs"),
    subjects: await countOrphans("subjects", "division"),
    schedules: await countOrphans("schedules", "division"),
    lectures: await countOrphans("lectures", "division"),
    attendances: await countOrphans("attendances", "division"),
    quizzes: await countOrphans("quizzes", "division"),
    resources: await countOrphans("resources", "division"),
  };
  const divisions = await db.collection("divisions").find({}, { projection: { code: 1, name: 1, _id: 0 } }).toArray();
  const userCount = await db.collection("users").countDocuments();
  console.log("VERIFICATION -> Third Year C exists:", verify !== null);
  console.log("VERIFICATION -> Existing divisions:", JSON.stringify(divisions));
  console.log("VERIFICATION -> Base users count:", userCount);
  console.log("VERIFICATION -> Orphan counts:", JSON.stringify(orphans));
  if (verify !== null || Object.values(orphans).some(n => n > 0)) {
    console.error("ERROR: Third Year C or orphaned references still exist!");
    process.exit(1);
  }
  await mongoose.disconnect();
})();
')

# 4. Start read-only mongo-express on 127.0.0.1:8081 pointing at yantra_demo
echo "[5/6] Starting read-only mongo-express (127.0.0.1:8081 -> ${DEMO_DB})..."
(cd "$ROOT_DIR" && docker compose --profile demo up -d mongo-express)

# 5. Start Express (:3000) and FastAPI (:8000) against yantra_demo with recording env overrides
echo "[6/6] Starting Express (:3000) and FastAPI (:8000) against ${DEMO_DB}..."
mkdir -p "$SCRIPT_DIR/logs"

python3 - "$ROOT_DIR" "$SCRIPT_DIR" "$DEMO_URI" <<'PYEOF'
import os, subprocess, sys
root_dir, script_dir, demo_uri = sys.argv[1], sys.argv[2], sys.argv[3]

express_env = os.environ.copy()
express_env["MONGODB_URI"] = demo_uri
with open(os.path.join(script_dir, "logs", "express.log"), "wb") as out:
    subprocess.Popen(
        ["node", "dist/index.js"],
        cwd=os.path.join(root_dir, "express-backend"),
        env=express_env,
        stdin=subprocess.DEVNULL,
        stdout=out,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

fastapi_env = os.environ.copy()
fastapi_env["MONGODB_URI"] = demo_uri
with open(os.path.join(script_dir, "logs", "fastapi.log"), "wb") as out:
    subprocess.Popen(
        ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"],
        cwd=os.path.join(root_dir, "python-backend"),
        env=fastapi_env,
        stdin=subprocess.DEVNULL,
        stdout=out,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
PYEOF

# Ensure Vite frontend is listening on :5173
if ! lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  (cd "$ROOT_DIR/frontend" && nohup npm run dev -- --host > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &)
fi

# Wait for health checks
wait_for() {
  local name="$1"
  local url="$2"
  for i in $(seq 1 30); do
    code=$(curl -sS -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      echo "  ✅ ${name} healthy (${url} -> HTTP 200)"
      return 0
    fi
    sleep 1
  done
  echo "  ❌ ${name} failed health check (${url} -> last HTTP ${code})"
  return 1
}

wait_for "Express API" "http://127.0.0.1:3000/api/health"
wait_for "FastAPI AI" "http://127.0.0.1:8000/python-app/health"
wait_for "Frontend Vite" "http://127.0.0.1:5173/"
wait_for "mongo-express (RO)" "http://127.0.0.1:8081/"

echo "============================================================"
echo " Demo environment ready! Database: ${DEMO_DB}"
echo "============================================================"
