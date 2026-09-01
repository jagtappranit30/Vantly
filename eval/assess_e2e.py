#!/usr/bin/env python3
"""
Productive Point End-to-End Assessment Evaluation
=================================================
Tests the full /api/assess pipeline by uploading the Meridian fixture
document and validating the extracted metrics, scoring, and recommendations
against known ground-truth values.

Usage:
    cd eval
    python assess_e2e.py --url http://localhost:3000
"""

import argparse
import json
import sys
import os
from pathlib import Path

import httpx

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

EVAL_DIR = Path(__file__).parent
FIXTURE_PATH = EVAL_DIR / "fixtures" / "meridian_financials.txt"

# Ground truth values from the Meridian Manufacturing fixture
GROUND_TRUTH_METRICS = {
    "revenue": 4_200_000,
    "headcount": 42,
    "cogs": 2_520_000,
    "payroll": 1_050_000,
    "grossMargin": 40.0,
    "operatingMargin": None,
    "currentAssets": 890_000,
    "currentLiabilities": 445_000,
}

# Derived scoring expectations (approximate)
EXPECTED_SCORING = {
    "productivityIndex_min": 20,
    "productivityIndex_max": 100,
    "labourEfficiencyScore_min": 10,
    "labourEfficiencyScore_max": 50,
    "financialHealthScore_min": 10,
    "financialHealthScore_max": 50,
}


def colour(text: str, code: str) -> str:
    """ANSI colour wrapper."""
    codes = {"green": "32", "red": "31", "yellow": "33", "cyan": "36", "bold": "1"}
    return f"\033[{codes.get(code, '0')}m{text}\033[0m"


def check_metric(name: str, actual, expected, tolerance_pct: float = 5.0) -> bool:
    """Check if an extracted metric matches ground truth within tolerance."""
    if expected is None:
        if actual is None or actual == 0.0:
            print(f"  {colour('PASS', 'green')} {name}: {actual} (non-disclosed / null)")
            return True
        else:
            print(f"  {colour('FAIL', 'red')} {name}: got {actual}, expected None (non-disclosed)")
            return False

    if actual is None and expected is not None:
        print(f"  {colour('FAIL', 'red')} {name}: got None, expected {expected}")
        return False

    if expected == 0:
        if actual is None or abs(actual) <= 1.0:
            print(f"  {colour('PASS', 'green')} {name}: {actual} ≈ {expected}")
            return True
        else:
            print(f"  {colour('FAIL', 'red')} {name}: {actual} != {expected}")
            return False

    pct_diff = abs(actual - expected) / abs(expected) * 100
    passed = pct_diff <= tolerance_pct
    status = colour("PASS", "green") if passed else colour("FAIL", "red")
    print(f"  {status} {name}: {actual} (expected {expected}, diff {pct_diff:.1f}%)")
# ANSI Colours
COLOURS = {
    "green": "\033[92m",
    "red": "\033[91m",
    "yellow": "\033[93m",
    "blue": "\033[94m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "reset": "\033[0m",
}


def colour(text: str, c: str) -> str:
    return f"{COLOURS.get(c, '')}{text}{COLOURS['reset']}"


def run_assessment(url: str, fixture_path: Path, sector: str) -> dict:
    """Uploads fixture to /api/assess and returns the parsed JSON response."""
    print(f"\n{colour('--- 1. Uploading Fixture ---', 'bold')}")
    print(f"  URL:     {url}/api/assess")
    print(f"  Fixture: {fixture_path.name} ({fixture_path.stat().st_size:,} bytes)")
    print(f"  Sector:  {sector}")

    with open(fixture_path, "rb") as f:
        files = {"file": (fixture_path.name, f, "text/plain")}
        data = {
            "sector": sector,
            "companyName": "Meridian Manufacturing Ltd",
        }
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(f"{url}/api/assess", files=files, data=data)

    if resp.status_code != 200:
        print(f"  {colour('ERROR', 'red')}: /api/assess returned {resp.status_code}")
        print(resp.text[:500])
        sys.exit(1)

    return resp.json()


def evaluate(result: dict) -> dict:
    """Validate metrics and scores against ground truth."""
    metrics = result.get("metrics", {})
    scores = result.get("scores", {})
    summary = {"total": 0, "passed": 0, "failed": 0}

    # ── Metric Extraction Accuracy ────────────────────
    print(f"\n{'=' * 60}")
    print(f"{colour('METRIC EXTRACTION ACCURACY', 'bold')}")
    print(f"{'=' * 60}")

    for metric_name, expected_val in GROUND_TRUTH_METRICS.items():
        actual_val = metrics.get(metric_name)
        summary["total"] += 1
        if check_metric(metric_name, actual_val, expected_val, tolerance_pct=5.0):
            summary["passed"] += 1
        else:
            summary["failed"] += 1

    # ── Company Name ──────────────────────────────────
    print(f"\n{colour('COMPANY NAME DETECTION', 'bold')}")
    company = metrics.get("companyName", "") or result.get("companyName", "")
    summary["total"] += 1
    if company and "meridian" in company.lower():
        print(f"  {colour('PASS', 'green')} companyName: '{company}' (contains 'Meridian')")
        summary["passed"] += 1
    else:
        print(f"  {colour('FAIL', 'red')} companyName: '{company}' (expected to contain 'Meridian')")
        summary["failed"] += 1

    # ── Scoring Validity ──────────────────────────────
    print(f"\n{colour('SCORING PIPELINE VALIDATION', 'bold')}")

    summary["total"] += 1
    if check_range(
        "productivityIndex",
        scores.get("productivityIndex"),
        EXPECTED_SCORING["productivityIndex_min"],
        EXPECTED_SCORING["productivityIndex_max"],
    ):
        summary["passed"] += 1
    else:
        summary["failed"] += 1

    summary["total"] += 1
    if check_range(
        "labourEfficiencyScore",
        scores.get("labourEfficiencyScore"),
        EXPECTED_SCORING["labourEfficiencyScore_min"],
        EXPECTED_SCORING["labourEfficiencyScore_max"],
    ):
        summary["passed"] += 1
    else:
        summary["failed"] += 1

    summary["total"] += 1
    if check_range(
        "financialHealthScore",
        scores.get("financialHealthScore"),
        EXPECTED_SCORING["financialHealthScore_min"],
        EXPECTED_SCORING["financialHealthScore_max"],
    ):
        summary["passed"] += 1
    else:
        summary["failed"] += 1

    # ── Recommendations ───────────────────────────────
    print(f"\n{colour('RECOMMENDATIONS CHECK', 'bold')}")
    recs = scores.get("recommendations", [])
    summary["total"] += 1
    if isinstance(recs, list) and len(recs) >= 2:
        print(f"  {colour('PASS', 'green')} recommendations: {len(recs)} items returned")
        summary["passed"] += 1
    else:
        print(f"  {colour('FAIL', 'red')} recommendations: expected >= 2, got {len(recs) if isinstance(recs, list) else 'non-list'}")
        summary["failed"] += 1

    # ── Labour Details ────────────────────────────────
    print(f"\n{colour('LABOUR DETAILS CHECK', 'bold')}")
    labour = scores.get("labourDetails", {})

    summary["total"] += 1
    rev_per_emp = labour.get("revenuePerEmployee")
    if check_metric("revenuePerEmployee", rev_per_emp, 100_000, tolerance_pct=5.0):
        summary["passed"] += 1
    else:
        summary["failed"] += 1

    summary["total"] += 1
    out_per_pay = labour.get("outputPerPayroll")
    if check_metric("outputPerPayroll", out_per_pay, 4.0, tolerance_pct=5.0):
        summary["passed"] += 1
    else:
        summary["failed"] += 1

    return summary


def main():
    parser = argparse.ArgumentParser(description="End-to-end assessment evaluation for Productive Point")
    parser.add_argument("--url", default="http://localhost:3000", help="Base URL of the Productive Point server")
    parser.add_argument("--fixture", default=str(FIXTURE_PATH), help="Path to fixture file")
    parser.add_argument("--sector", default="Manufacturing", help="Sector for assessment")
    parser.add_argument("--output", default=None, help="Path to save raw JSON response")
    args = parser.parse_args()

    fixture = Path(args.fixture)
    if not fixture.exists():
        print(f"{colour('ERROR', 'red')}: Fixture not found at {fixture}")
        sys.exit(1)

    # Run assessment
    result = run_assessment(args.url, fixture, args.sector)

    # Save raw output if requested
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nRaw response saved to: {output_path}")

    # Evaluate
    summary = evaluate(result)

    # Final summary
    print(f"\n{'=' * 60}")
    total = summary["total"]
    passed = summary["passed"]
    failed = summary["failed"]
    pass_rate = (passed / total * 100) if total > 0 else 0

    status_colour = "green" if failed == 0 else ("yellow" if pass_rate >= 70 else "red")
    print(f"{colour(f'RESULTS: {passed}/{total} passed ({pass_rate:.0f}%)', status_colour)}")

    if failed > 0:
        print(f"{colour(f'  {failed} check(s) failed', 'red')}")

    print(f"{'=' * 60}\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
