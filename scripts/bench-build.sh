#!/bin/bash
#
# Build performance benchmark for Sidekiq Queue Kill Switch
#
# Usage:
#   ./scripts/bench-build.sh baseline   # Measure pre-migration (zip only)
#   ./scripts/bench-build.sh vite       # Measure post-migration (vite + zip)
#
# Output:
#   - dist/perf/{baseline,vite}.json with timing data
#   - Summary table to stdout
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

MODE="${1:-baseline}"
COLD_RUNS=1
WARM_RUNS=5
PERF_DIR="$PROJECT_ROOT/dist/perf"

cd "$PROJECT_ROOT"

# Create perf output directory
mkdir -p "$PERF_DIR"

# Python helper for timing and JSON output
run_benchmark() {
    local mode="$1"
    local output_file="$2"

    python3 << EOF
import subprocess
import time
import json
import os
import statistics
import platform
import shutil

mode = "$mode"
output_file = "$output_file"
project_root = "$PROJECT_ROOT"
cold_runs = $COLD_RUNS
warm_runs = $WARM_RUNS

def get_environment_info():
    """Gather environment metadata."""
    info = {
        "os": platform.system(),
        "os_version": platform.release(),
        "platform": platform.platform(),
        "processor": platform.processor() or "unknown",
        "machine": platform.machine(),
        "python_version": platform.python_version(),
    }

    # Get Bun version if available
    try:
        result = subprocess.run(["bun", "--version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            info["bun_version"] = result.stdout.strip()
    except:
        info["bun_version"] = "not installed"

    # Get Vite version if available (from node_modules)
    try:
        result = subprocess.run(["bun", "run", "vite", "--version"], capture_output=True, text=True, timeout=10, cwd=project_root)
        if result.returncode == 0:
            info["vite_version"] = result.stdout.strip()
    except:
        info["vite_version"] = "not installed"

    return info

def clean_build():
    """Clean build artifacts."""
    dist_dir = os.path.join(project_root, "dist")

    # Preserve perf directory
    perf_backup = None
    perf_dir = os.path.join(dist_dir, "perf")
    if os.path.exists(perf_dir):
        perf_backup = os.path.join(project_root, ".perf_backup")
        if os.path.exists(perf_backup):
            shutil.rmtree(perf_backup)
        shutil.copytree(perf_dir, perf_backup)

    # Clean dist (excluding backup)
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)

    # Restore perf directory
    os.makedirs(dist_dir, exist_ok=True)
    if perf_backup and os.path.exists(perf_backup):
        shutil.copytree(perf_backup, perf_dir)
        shutil.rmtree(perf_backup)

    # For vite mode, also clean bun cache (repo-local only)
    if mode == "vite":
        node_modules_cache = os.path.join(project_root, "node_modules", ".vite")
        if os.path.exists(node_modules_cache):
            shutil.rmtree(node_modules_cache)

def run_build():
    """Run the build command and return elapsed time in ms."""
    start = time.perf_counter()
    result = subprocess.run(
        ["make", "package"],
        cwd=project_root,
        capture_output=True,
        text=True
    )
    elapsed = (time.perf_counter() - start) * 1000

    if result.returncode != 0:
        print(f"Build failed: {result.stderr}")
        return None, result.stderr

    return elapsed, None

def get_file_sizes():
    """Get sizes of produced JS/CSS files."""
    sizes = {}

    if mode == "baseline":
        # Check source files for baseline
        js_path = os.path.join(project_root, "src", "contentScript.js")
        css_path = os.path.join(project_root, "src", "contentScript.css")
    else:
        # Check built files for vite
        js_path = os.path.join(project_root, "dist", "extension", "assets", "contentScript.js")
        css_path = os.path.join(project_root, "dist", "extension", "assets", "contentScript.css")

    if os.path.exists(js_path):
        sizes["js_bytes"] = os.path.getsize(js_path)

    if os.path.exists(css_path):
        sizes["css_bytes"] = os.path.getsize(css_path)

    # ZIP size
    zip_path = os.path.join(project_root, "dist", "sidekiq-queue-kill-switch.zip")
    if os.path.exists(zip_path):
        sizes["zip_bytes"] = os.path.getsize(zip_path)

    return sizes

def calculate_stats(timings):
    """Calculate summary statistics."""
    if not timings:
        return {}

    sorted_timings = sorted(timings)
    n = len(sorted_timings)

    return {
        "min": round(sorted_timings[0], 2),
        "max": round(sorted_timings[-1], 2),
        "mean": round(statistics.mean(sorted_timings), 2),
        "median": round(statistics.median(sorted_timings), 2),
        "p95": round(sorted_timings[int(n * 0.95)] if n > 1 else sorted_timings[0], 2),
    }

# Main benchmark
print(f"\n{'='*60}")
print(f"Build Benchmark: {mode.upper()} mode")
print(f"{'='*60}\n")

env_info = get_environment_info()
results = {
    "mode": mode,
    "environment": env_info,
    "cold_runs": [],
    "warm_runs": [],
    "file_sizes": {},
    "stats": {},
    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
}

# Cold run(s)
print(f"Cold run (after clean)...")
for i in range(cold_runs):
    clean_build()
    elapsed, error = run_build()
    if elapsed is None:
        print(f"  Cold run {i+1}: FAILED - {error}")
        continue
    results["cold_runs"].append(round(elapsed, 2))
    print(f"  Cold run {i+1}: {elapsed:.2f} ms")

# Warm runs
print(f"\nWarm runs (no clean)...")
for i in range(warm_runs):
    elapsed, error = run_build()
    if elapsed is None:
        print(f"  Warm run {i+1}: FAILED - {error}")
        continue
    results["warm_runs"].append(round(elapsed, 2))
    print(f"  Warm run {i+1}: {elapsed:.2f} ms")

# File sizes
results["file_sizes"] = get_file_sizes()

# Calculate stats
results["stats"]["cold"] = calculate_stats(results["cold_runs"])
results["stats"]["warm"] = calculate_stats(results["warm_runs"])

# Summary table
print(f"\n{'='*60}")
print(f"SUMMARY ({mode.upper()})")
print(f"{'='*60}")
print(f"\nTiming Statistics:")
print(f"  Cold build:  {results['stats']['cold'].get('median', 'N/A')} ms (median)")
print(f"  Warm build:  {results['stats']['warm'].get('median', 'N/A')} ms (median)")
print(f"  Warm p95:    {results['stats']['warm'].get('p95', 'N/A')} ms")

print(f"\nFile Sizes:")
for key, value in results["file_sizes"].items():
    if "bytes" in key:
        kb = value / 1024
        print(f"  {key.replace('_bytes', '')}: {kb:.2f} KB ({value} bytes)")

# Write JSON output
with open(output_file, "w") as f:
    json.dump(results, f, indent=2)

print(f"\nResults saved to: {output_file}")
EOF
}

case "$MODE" in
    baseline)
        echo "Running baseline benchmark (pre-migration)..."
        run_benchmark "baseline" "$PERF_DIR/baseline.json"
        ;;
    vite)
        echo "Running Vite benchmark (post-migration)..."
        # Ensure dependencies are installed
        if [ -f "$PROJECT_ROOT/package.json" ] && [ ! -d "$PROJECT_ROOT/node_modules" ]; then
            echo "Installing dependencies with bun..."
            bun install
        fi
        run_benchmark "vite" "$PERF_DIR/vite.json"
        ;;
    compare)
        echo "Comparing baseline vs vite..."
        export PROJECT_ROOT="$PROJECT_ROOT"
        python3 << EOF
import json
import os

project_root = "$PROJECT_ROOT"
perf_dir = os.path.join(project_root, "dist", "perf")

baseline_path = os.path.join(perf_dir, "baseline.json")
vite_path = os.path.join(perf_dir, "vite.json")

if not os.path.exists(baseline_path):
    print("Error: baseline.json not found. Run './scripts/bench-build.sh baseline' first.")
    exit(1)

if not os.path.exists(vite_path):
    print("Error: vite.json not found. Run './scripts/bench-build.sh vite' first.")
    exit(1)

with open(baseline_path) as f:
    baseline = json.load(f)

with open(vite_path) as f:
    vite = json.load(f)

print("\n" + "="*60)
print("COMPARISON: Baseline vs Vite")
print("="*60)

print("\nCold Build:")
b_cold = baseline["stats"]["cold"].get("median", 0)
v_cold = vite["stats"]["cold"].get("median", 0)
diff_cold = v_cold - b_cold
print(f"  Baseline: {b_cold:.2f} ms")
print(f"  Vite:     {v_cold:.2f} ms")
print(f"  Diff:     {diff_cold:+.2f} ms ({diff_cold/b_cold*100:+.1f}%)" if b_cold else "  Diff: N/A")

print("\nWarm Build:")
b_warm = baseline["stats"]["warm"].get("median", 0)
v_warm = vite["stats"]["warm"].get("median", 0)
diff_warm = v_warm - b_warm
print(f"  Baseline: {b_warm:.2f} ms")
print(f"  Vite:     {v_warm:.2f} ms")
print(f"  Diff:     {diff_warm:+.2f} ms ({diff_warm/b_warm*100:+.1f}%)" if b_warm else "  Diff: N/A")

print("\nP95 Build:")
b_p95 = baseline["stats"]["warm"].get("p95", 0)
v_p95 = vite["stats"]["warm"].get("p95", 0)
diff_p95 = v_p95 - b_p95
print(f"  Baseline: {b_p95:.2f} ms")
print(f"  Vite:     {v_p95:.2f} ms")
print(f"  Diff:     {diff_p95:+.2f} ms ({diff_p95/b_p95*100:+.1f}%)" if b_p95 else "  Diff: N/A")

print("\nFile Sizes:")
for key in ["js_bytes", "css_bytes", "zip_bytes"]:
    b_size = baseline["file_sizes"].get(key, 0)
    v_size = vite["file_sizes"].get(key, 0)
    diff_size = v_size - b_size
    name = key.replace("_bytes", "")
    print(f"  {name}:")
    print(f"    Baseline: {b_size/1024:.2f} KB")
    print(f"    Vite:     {v_size/1024:.2f} KB")
    print(f"    Diff:     {diff_size/1024:+.2f} KB ({diff_size/b_size*100:+.1f}%)" if b_size else "    Diff: N/A")

print()
EOF
        ;;
    *)
        echo "Usage: $0 {baseline|vite|compare}"
        echo ""
        echo "  baseline  - Measure pre-migration build (zip only)"
        echo "  vite      - Measure post-migration build (vite + zip)"
        echo "  compare   - Compare baseline vs vite results"
        exit 1
        ;;
esac
