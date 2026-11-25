#!/usr/bin/env python3
"""
benchmark_scalability.py
Runs a controlled concurrent load test against Yantra ERP backend services:
1. FastAPI Agent Service (/python-app/health, /python-app/tools, /python-app/chat)
2. Express Node API (/api/auth/login, /api/health)
Calculates real throughput (RPS), mean/min/p50/p90/p95/p99/max latency.
"""

import time
import statistics
import concurrent.futures
import requests
import json

EXPRESS_BASE = "http://localhost:3000/api"
FASTAPI_BASE = "http://localhost:8000/python-app"

def get_auth_token():
    resp = requests.post(
        f"{EXPRESS_BASE}/auth/login",
        json={"email": "prof.adrian@university.edu", "password": "Teacher123"},
        timeout=5
    )
    resp.raise_for_status()
    return resp.json()["token"]

def benchmark_endpoint(name, url, method="GET", headers=None, payload=None, n_requests=50, concurrency=10):
    print(f"--> Benchmarking {name}: {n_requests} requests (concurrency={concurrency})...")
    latencies = []
    errors = 0

    def single_req():
        start = time.perf_counter()
        try:
            if method == "GET":
                r = requests.get(url, headers=headers, timeout=10)
            else:
                r = requests.post(url, headers=headers, json=payload, timeout=15)
            duration_ms = (time.perf_counter() - start) * 1000.0
            if r.status_code < 400:
                return duration_ms, True
            else:
                return duration_ms, False
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000.0
            return duration_ms, False

    start_wall = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(single_req) for _ in range(n_requests)]
        for f in concurrent.futures.as_completed(futures):
            dur, ok = f.result()
            if ok:
                latencies.append(dur)
            else:
                errors += 1
    total_wall_sec = time.perf_counter() - start_wall

    latencies.sort()
    rps = n_requests / total_wall_sec if total_wall_sec > 0 else 0
    p50 = statistics.median(latencies) if latencies else 0
    p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
    mean_lat = statistics.mean(latencies) if latencies else 0
    min_lat = min(latencies) if latencies else 0
    max_lat = max(latencies) if latencies else 0

    return {
        "name": name,
        "requests": n_requests,
        "concurrency": concurrency,
        "successful": len(latencies),
        "errors": errors,
        "error_rate_pct": (errors / n_requests) * 100,
        "total_time_sec": round(total_wall_sec, 3),
        "throughput_rps": round(rps, 1),
        "min_ms": round(min_lat, 2),
        "mean_ms": round(mean_lat, 2),
        "p50_ms": round(p50, 2),
        "p90_ms": round(p90, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "max_ms": round(max_lat, 2),
    }

def main():
    token = get_auth_token()
    auth_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    results = []

    # 1. FastAPI Uvicorn async I/O baseline
    res_health = benchmark_endpoint(
        "FastAPI Async Event Loop (/health)",
        f"{FASTAPI_BASE}/health",
        n_requests=100,
        concurrency=10
    )
    results.append(res_health)

    # 2. FastAPI Authenticated Tools Registry
    res_tools = benchmark_endpoint(
        "AI Agent Tools Registry (/tools - Auth HS256 JWT)",
        f"{FASTAPI_BASE}/tools",
        headers=auth_headers,
        n_requests=60,
        concurrency=10
    )
    results.append(res_tools)

    # 3. Express Node REST API
    res_express = benchmark_endpoint(
        "Express REST Health & Gateway (/api/health)",
        f"{EXPRESS_BASE}/health",
        n_requests=100,
        concurrency=10
    )
    results.append(res_express)

    # 4. Express Authentication & Bcrypt Verification
    res_auth = benchmark_endpoint(
        "Express Auth Login (Bcrypt Hash + JWT Sign)",
        f"{EXPRESS_BASE}/auth/login",
        method="POST",
        payload={"email": "prof.adrian@university.edu", "password": "Teacher123"},
        n_requests=30,
        concurrency=5
    )
    results.append(res_auth)

    print("\n" + "=" * 80)
    print(" EMPIRICAL LOAD TEST RESULTS (FOR SLIDE 10 SCALABILITY BENCHMARKS)")
    print("=" * 80)
    print(f"{'Endpoint / Workload':<42} | {'RPS':<8} | {'P50 (ms)':<9} | {'P95 (ms)':<9} | {'P99 (ms)':<9} | {'Err %':<6}")
    print("-" * 80)
    for r in results:
        print(f"{r['name']:<42} | {r['throughput_rps']:<8} | {r['p50_ms']:<9} | {r['p95_ms']:<9} | {r['p99_ms']:<9} | {r['error_rate_pct']:<6}%")
    print("=" * 80)

    with open("benchmark_results.json", "w") as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    main()

