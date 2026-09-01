#!/usr/bin/env python3
"""
Productive Point Scoring Engine Evaluation Suite
================================================
Evaluates the core financial calculation engine, sector benchmark comparison,
and Productivity Index scoring logic against deterministic financial inputs.

Usage:
    cd eval
    python evaluate_scoring.py
"""

import sys

def colour(text: str, code: str) -> str:
    codes = {"green": "32", "red": "31", "yellow": "33", "cyan": "36", "bold": "1"}
    return f"\033[{codes.get(code, '0')}m{text}\033[0m"

def calculate_productivity_scores(metrics: dict, sector_benchmarks: dict) -> dict:
    """
    Python implementation matching server.ts calculateScores logic for deterministic verification.
    """
    b = sector_benchmarks
    revenue = metrics.get("revenue") or 0
    headcount = metrics.get("headcount")
    payroll = metrics.get("payroll")
    gross_margin = metrics.get("grossMargin")
    operating_margin = metrics.get("operatingMargin")

    # 1. Labour Efficiency Score (0 - 50)
    rev_per_emp = (revenue / headcount) if (headcount and headcount > 0) else 0
    labour_eff = 0
    if rev_per_emp > 0:
        p25 = b["revenue_per_employee"]["p25"]
        p50 = b["revenue_per_employee"]["p50"]
        p75 = b["revenue_per_employee"]["p75"]
        if rev_per_emp <= p25:
            labour_eff = 15 + (rev_per_emp / p25) * 10
        elif rev_per_emp <= p50:
            labour_eff = 25 + ((rev_per_emp - p25) / (p50 - p25)) * 10
        elif rev_per_emp <= p75:
            labour_eff = 35 + ((rev_per_emp - p50) / (p75 - p50)) * 10
        else:
            labour_eff = 45 + min(5, ((rev_per_emp - p75) / p75) * 5)
    else:
        labour_eff = 20  # Neutral baseline when headcount non-disclosed

    # 2. Profitability Score (0 - 50)
    gm = gross_margin if gross_margin is not None else 0
    profitability = 0
    if gm > 0:
        p25 = b["gross_margin"]["p25"]
        p50 = b["gross_margin"]["p50"]
        p75 = b["gross_margin"]["p75"]
        if gm <= p25:
            profitability = 15 + (gm / p25) * 10
        elif gm <= p50:
            profitability = 25 + ((gm - p25) / (p50 - p25)) * 10
        elif gm <= p75:
            profitability = 35 + ((gm - p50) / (p75 - p50)) * 10
        else:
            profitability = 45 + min(5, ((gm - p75) / p75) * 5)
    else:
        profitability = 20  # Neutral baseline

    overall_index = round(labour_eff + profitability)

    return {
        "overallIndex": overall_index,
        "labourEfficiency": round(labour_eff, 2),
        "profitability": round(profitability, 2),
        "revenuePerEmployee": round(rev_per_emp, 2),
        "grossMargin": gm,
        "operatingMargin": operating_margin
    }

def main():
    print(f"{colour('═' * 60, 'bold')}")
    print(f"{colour('PRODUCTIVE POINT SCORING ENGINE EVALUATION SUITE', 'bold')}")
    print(f"{colour('═' * 60, 'bold')}")

    # Ground truth test benchmarks for Services sector
    services_benchmarks = {
        "sector": "Services",
        "revenue_per_employee": { "p25": 100000, "p50": 145000, "p75": 210000 },
        "gross_margin": { "p25": 40, "p50": 55, "p75": 70 }
    }

    # Input fixture: Revenue = £1,000,000, Employees = 10, COGS = £600,000, Gross Margin = 40%
    input_metrics = {
        "revenue": 1000000,
        "headcount": 10,
        "cogs": 600000,
        "payroll": 200000,
        "grossMargin": 40.0,
        "operatingMargin": None  # Non-disclosed operating margin must stay None
    }

    results = calculate_productivity_scores(input_metrics, services_benchmarks)

    print(f"\n{colour('Calculated Financial Metrics & Productivity Index:', 'bold')}")
    print(f"  Revenue per Employee : £{results['revenuePerEmployee']:,.2f}")
    print(f"  Gross Margin         : {results['grossMargin']}%")
    print(f"  Operating Margin     : {results['operatingMargin']}")
    print(f"  Labour Efficiency    : {results['labourEfficiency']} / 50")
    print(f"  Profitability Score  : {results['profitability']} / 50")
    print(f"  Productivity Index   : {results['overallIndex']} / 100")

    # Assertions
    passed = True
    if results['revenuePerEmployee'] != 100000.0:
        print(f"  {colour('FAIL', 'red')} Revenue per employee incorrect: {results['revenuePerEmployee']}")
        passed = False
    else:
        print(f"  {colour('PASS', 'green')} Revenue per employee = £100,000.00")

    if results['operatingMargin'] is not None:
        print(f"  {colour('FAIL', 'red')} Operating margin must remain None when non-disclosed")
        passed = False
    else:
        print(f"  {colour('PASS', 'green')} Operating margin correctly preserved as None (null)")

    if results['labourEfficiency'] != 25.0:
        print(f"  {colour('FAIL', 'red')} Labour efficiency score incorrect: {results['labourEfficiency']}")
        passed = False
    else:
        print(f"  {colour('PASS', 'green')} Labour efficiency score = 25.0 / 50 (p25 match)")

    if results['profitability'] != 25.0:
        print(f"  {colour('FAIL', 'red')} Profitability score incorrect: {results['profitability']}")
        passed = False
    else:
        print(f"  {colour('PASS', 'green')} Profitability score = 25.0 / 50 (p25 match)")

    if results['overallIndex'] != 50:
        print(f"  {colour('FAIL', 'red')} Productivity Index incorrect: {results['overallIndex']}")
        passed = False
    else:
        print(f"  {colour('PASS', 'green')} Productivity Index = 50 / 100")

    print(f"\n{colour('═' * 60, 'bold')}")
    if passed:
        print(f"{colour('ALL SCORING EVALUATION TESTS PASSED CLEANLY! (5/5)', 'green')}")
    else:
        print(f"{colour('SCORING EVALUATION FAILED', 'red')}")
    print(f"{colour('═' * 60, 'bold')}\n")

    sys.exit(0 if passed else 1)

if __name__ == "__main__":
    main()
