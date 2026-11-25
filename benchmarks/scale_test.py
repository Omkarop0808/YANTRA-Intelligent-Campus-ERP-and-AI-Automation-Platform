"""Real Multi-Instance Scaling Benchmark through Nginx Load Balancer.

Compares 1-instance vs 2-instance throughput and latencies using the live
Docker Compose topology (nginx on :80, 2x Express, 2x FastAPI, Mongo, Redis).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import time
from typing import Any, Callable

import httpx

from benchmarks.load_test import (
    BenchmarkMetric,
    SystemMetadata,
    collect_system_metadata,
    execute_scenario_run,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NGINX_DIR = os.path.join(BASE_DIR, "nginx")
NGINX_CONF = os.path.join(NGINX_DIR, "nginx.conf")
NGINX_1INST = os.path.join(NGINX_DIR, "nginx-1inst.conf")
NGINX_2INST = os.path.join(NGINX_DIR, "nginx-2inst.conf")

EXPRESS_BASE = "http://localhost/api"
FASTAPI_BASE = "http://localhost/python-app"


def switch_nginx(config_path: str):
    """Update nginx.conf and reload Nginx container."""
    shutil.copy(config_path, NGINX_CONF)
    res = subprocess.run(
        ["docker", "exec", "yantra-nginx", "nginx", "-s", "reload"],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print(f"Warning: nginx reload returned code {res.returncode}: {res.stderr}")
    time.sleep(1)


async def main():
    print("=" * 80)
    print(" 🚀 REAL DOCKER MULTI-INSTANCE SCALING BENCHMARK (NGINX :80)")
    print("=" * 80)

    # 1. Acquire auth tokens through Nginx
    async with httpx.AsyncClient(timeout=10.0) as auth_client:
        tr = await auth_client.post(
            f"{EXPRESS_BASE}/auth/login",
            json={"email": "prof.adrian@university.edu", "password": "Teacher123"},
        )
        teacher_token = tr.json().get("token", "")

        sr = await auth_client.post(
            f"{EXPRESS_BASE}/auth/login",
            json={"email": "aarav.sharma@university.edu", "password": "Student123"},
        )
        student_token = sr.json().get("token", "")

        div_id = "6b01630d9ab7d605a3ae4ff4"
        try:
            div_r = await auth_client.get(
                f"{EXPRESS_BASE}/academic/divisions",
                headers={"Authorization": f"Bearer {teacher_token}"},
            )
            if div_r.status_code == 200 and div_r.json():
                div_id = div_r.json()[0]["_id"]
        except Exception:
            pass

    scenarios = [
        (
            "Express Health Gateway",
            lambda: ("GET", f"{EXPRESS_BASE}/health", {}, None),
            50,
            200,
            5.0,
        ),
        (
            "FastAPI Tools Registry",
            lambda: (
                "GET",
                f"{FASTAPI_BASE}/tools",
                {"Authorization": f"Bearer {teacher_token}"},
                None,
            ),
            50,
            200,
            5.0,
        ),
        (
            "Student Quizzes (Mongo Read)",
            lambda: (
                "GET",
                f"{EXPRESS_BASE}/student/quizzes",
                {"Authorization": f"Bearer {student_token}"},
                None,
            ),
            50,
            200,
            5.0,
        ),
        (
            "Attendance Stats Pipeline",
            lambda: (
                "GET",
                f"{EXPRESS_BASE}/divisions/{div_id}/attendance/stats",
                {"Authorization": f"Bearer {teacher_token}"},
                None,
            ),
            50,
            200,
            5.0,
        ),
        (
            "Express Auth Login (Bcrypt)",
            lambda: (
                "POST",
                f"{EXPRESS_BASE}/auth/login",
                {},
                {"email": "prof.adrian@university.edu", "password": "Teacher123"},
            ),
            25,
            50,
            5.0,
        ),
    ]

    # --- Phase 1: 1 Instance Run ---
    print("\n▶ Setting Nginx to 1-INSTANCE mode (1x Express, 1x FastAPI)...")
    switch_nginx(NGINX_1INST)

    metrics_1inst: dict[str, BenchmarkMetric] = {}
    limits = httpx.Limits(max_keepalive_connections=100, max_connections=200)
    async with httpx.AsyncClient(timeout=10.0, limits=limits) as client:
        for name, req_builder, conc, min_reqs, min_dur in scenarios:
            print(f"  Measuring 1-instance: {name} (C={conc})...", end="", flush=True)
            m = await execute_scenario_run(client, req_builder, conc, min_reqs, min_dur)
            m.scenario = name
            metrics_1inst[name] = m
            print(f" {m.rps:.1f} RPS | p95: {m.p95_ms:.1f}ms | err: {m.error_rate_pct}%")

    # --- Phase 2: 2 Instances Run ---
    print("\n▶ Setting Nginx to 2-INSTANCE mode (2x Express, 2x FastAPI)...")
    switch_nginx(NGINX_2INST)

    metrics_2inst: dict[str, BenchmarkMetric] = {}
    async with httpx.AsyncClient(timeout=10.0, limits=limits) as client:
        for name, req_builder, conc, min_reqs, min_dur in scenarios:
            print(f"  Measuring 2-instances: {name} (C={conc})...", end="", flush=True)
            m = await execute_scenario_run(client, req_builder, conc, min_reqs, min_dur)
            m.scenario = name
            metrics_2inst[name] = m
            print(f" {m.rps:.1f} RPS | p95: {m.p95_ms:.1f}ms | err: {m.error_rate_pct}%")

    # --- Comparison Table ---
    print("\n" + "=" * 90)
    print(" 📊 REAL MEASURED SCALING RESULTS (1 INSTANCE vs 2 INSTANCES)")
    print("=" * 90)
    print(
        f"{'Scenario':<30} | {'Conc':<4} | {'1-Inst RPS':<10} | {'2-Inst RPS':<10} | {'Scale Factor':<12} | {'1-Inst p95':<10} | {'2-Inst p95':<10}"
    )
    print("-" * 90)

    comparison_results = []
    for name, _, conc, _, _ in scenarios:
        m1 = metrics_1inst[name]
        m2 = metrics_2inst[name]
        factor = round(m2.rps / m1.rps, 2) if m1.rps > 0 else 0.0
        print(
            f"{name:<30} | {conc:<4} | {m1.rps:<10.1f} | {m2.rps:<10.1f} | {factor:<12.2f}x | {m1.p95_ms:<10.1f} | {m2.p95_ms:<10.1f}"
        )
        comparison_results.append({
            "scenario": name,
            "concurrency": conc,
            "one_instance_rps": m1.rps,
            "two_instance_rps": m2.rps,
            "scaling_factor": factor,
            "one_instance_p50_ms": m1.p50_ms,
            "two_instance_p50_ms": m2.p50_ms,
            "one_instance_p95_ms": m1.p95_ms,
            "two_instance_p95_ms": m2.p95_ms,
            "one_instance_err_pct": m1.error_rate_pct,
            "two_instance_err_pct": m2.error_rate_pct,
        })

    # Save to benchmark_results.json
    results_path = os.path.join(BASE_DIR, "benchmark_results.json")
    try:
        with open(results_path) as f:
            full_data = json.load(f)
    except Exception:
        full_data = {}

    full_data["container_scaling_comparison"] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "topology": "Nginx on port 80 -> [express-1:3000, express-2:3000] & [fastapi-1:8000, fastapi-2:8000]",
        "database": "MongoDB 7.0 container (yantra-mongo)",
        "results": comparison_results,
    }

    with open(results_path, "w") as f:
        json.dump(full_data, f, indent=2)
    print(f"\n✅ Raw scaling data written to {results_path}")

    # Update BENCHMARKS.md Phase 4 section
    update_benchmarks_markdown(comparison_results)
    print("✅ BENCHMARKS.md updated with real scaling results.")


def update_benchmarks_markdown(results: list[dict[str, Any]]):
    bench_path = os.path.join(BASE_DIR, "BENCHMARKS.md")
    with open(bench_path) as f:
        content = f.read()

    lines = [
        "## 📈 Phase 4 Horizontal Scaling Telemetry: 1 Instance vs 2 Instances (via Nginx Load Balancer)",
        "",
        "Measured directly through real containerized topology (`Nginx :80` $\\to$ `2x Express`, `2x FastAPI`, `MongoDB 7.0`):",
        "",
        "| Scenario | Concurrency | 1 Instance Throughput | 2 Instances Throughput | Scaling Factor | Saturation p95 (1 Inst) | Saturation p95 (2 Inst) | Notes / Honest Bottleneck |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    notes_map = {
        "Express Health Gateway": "Multi-process Node cluster scaling through Nginx round-robin.",
        "FastAPI Tools Registry": "Multi-process ASGI workers bypass Python single-thread lock.",
        "Student Quizzes (Mongo Read)": "Scales reads until MongoDB connection pool/lock limits.",
        "Attendance Stats Pipeline": "Accelerated by compound indexes; CPU-bounded aggregation pipeline.",
        "Express Auth Login (Bcrypt)": "CPU core scaling on libuv threadpool. Password hash computation (~60ms) bounds single-core throughput.",
    }

    for r in results:
        name = r["scenario"]
        note = notes_map.get(name, "Measured through live Nginx reverse proxy.")
        lines.append(
            f"| **{name}** | `{r['concurrency']}` | {r['one_instance_rps']:.1f} RPS | **{r['two_instance_rps']:.1f} RPS** | **{r['scaling_factor']:.2f}x** | {r['one_instance_p95_ms']:.2f} ms | {r['two_instance_p95_ms']:.2f} ms | {note} |"
        )

    lines.append("")

    marker = "## 📈 Phase 4 Horizontal Scaling Telemetry: 1 Instance vs 2 Instances (via Nginx Load Balancer)"
    end_marker = "### 🔍 MongoDB Query Optimization: `explain()` Before & After"

    if marker in content and end_marker in content:
        start_idx = content.find(marker)
        end_idx = content.find(end_marker)
        new_content = content[:start_idx] + "\n".join(lines) + content[end_idx:]
    else:
        new_content = content + "\n\n" + "\n".join(lines)

    with open(bench_path, "w") as f:
        f.write(new_content)


if __name__ == "__main__":
    asyncio.run(main())
