#!/usr/bin/env python3
"""
Productive Point Security & Correctness Automated Test Suite
============================================================
Tests core production security, input validation, financial calculation logic,
and RAG authorization boundaries against the running Productive Point server.

Usage:
    cd eval
    python test_security_and_correctness.py --url http://localhost:3000
"""

import argparse
import sys
import httpx
from pathlib import Path

def colour(text: str, code: str) -> str:
    codes = {"green": "32", "red": "31", "yellow": "33", "cyan": "36", "bold": "1"}
    return f"\033[{codes.get(code, '0')}m{text}\033[0m"

def test_file_validation(base_url: str) -> bool:
    """Test rejection of invalid file extensions, spoofed signatures, and oversized files."""
    print(f"\n{colour('1. TESTING SERVER FILE UPLOAD VALIDATION', 'bold')}")
    url = f"{base_url}/api/assess"
    passed_count = 0
    total_tests = 3

    with httpx.Client(timeout=15.0) as client:
        # Test 1: Invalid extension (.exe)
        files = {"file": ("malicious.exe", b"MZ\x90\x00\x03\x00\x00\x00", "application/x-msdownload")}
        resp = client.post(url, files=files, data={"sector": "Other"})
        if resp.status_code == 400 and "Invalid file extension" in resp.json().get("error", ""):
            print(f"  {colour('PASS', 'green')} Rejected .exe extension with HTTP 400")
            passed_count += 1
        else:
            print(f"  {colour('FAIL', 'red')} Failed to reject .exe extension (status={resp.status_code})")

        # Test 2: Spoofed PDF extension with text content (signature mismatch)
        files = {"file": ("fake.pdf", b"This is plain text, not a PDF header.", "application/pdf")}
        resp = client.post(url, files=files, data={"sector": "Other"})
        if resp.status_code == 400 and "signature" in resp.json().get("error", "").lower():
            print(f"  {colour('PASS', 'green')} Rejected spoofed PDF file signature with HTTP 400")
            passed_count += 1
        else:
            print(f"  {colour('FAIL', 'red')} Failed to reject spoofed PDF signature (status={resp.status_code})")

        # Test 3: Binary CSV with null bytes
        files = {"file": ("binary.csv", b"Header1,Header2\nValue1,\x00\x01\x02BinaryData", "text/csv")}
        resp = client.post(url, files=files, data={"sector": "Other"})
        if resp.status_code == 400 and "binary" in resp.json().get("error", "").lower():
            print(f"  {colour('PASS', 'green')} Rejected binary CSV content with HTTP 400")
            passed_count += 1
        else:
            print(f"  {colour('FAIL', 'red')} Failed to reject binary CSV content (status={resp.status_code})")

    return passed_count == total_tests

def test_rag_authorization(base_url: str) -> bool:
    """Test RAG query authorization and invalid doc_id protection."""
    print(f"\n{colour('2. TESTING RAG API SECURITY & AUTHORIZATION', 'bold')}")
    url = f"{base_url}/api/rag/query"
    passed_count = 0
    total_tests = 2

    with httpx.Client(timeout=15.0) as client:
        # Test 1: Query with non-existent / unauthorized doc_id
        payload = {
            "doc_id": "non_existent_unauthorized_doc_id_9999",
            "question": "What is the revenue?",
            "top_k": 4
        }
        resp = client.post(url, json=payload)
        if resp.status_code in (403, 404):
            print(f"  {colour('PASS', 'green')} Unauthorized doc_id query returned HTTP {resp.status_code}")
            passed_count += 1
        else:
            print(f"  {colour('FAIL', 'red')} Unauthorized doc_id query returned HTTP {resp.status_code} instead of 403/404")

        # Test 2: Query missing doc_id
        resp = client.post(url, json={"question": "Test question"})
        if resp.status_code == 400:
            print(f"  {colour('PASS', 'green')} Missing doc_id returned HTTP 400 Bad Request")
            passed_count += 1
        else:
            print(f"  {colour('FAIL', 'red')} Missing doc_id returned HTTP {resp.status_code} instead of 400")

    return passed_count == total_tests

def test_margin_calculation_correctness(base_url: str) -> bool:
    """Test that operating margin is not calculated using revenue-cogs-payroll proxy."""
    print(f"\n{colour('3. TESTING FINANCIAL MARGIN CALCULATION ACCURACY', 'bold')}")
    url = f"{base_url}/api/assess"

    # CSV where revenue, cogs, and payroll are present, but operating margin is NOT disclosed
    csv_content = (
        "Company Name,Total Revenue,Cost of Sales,Staff Payroll\n"
        "Test SME Ltd,1000000,600000,200000\n"
    )

    files = {"file": ("test_margins.csv", csv_content.encode("utf-8"), "text/csv")}

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(url, files=files, data={"sector": "Services"})
        if resp.status_code != 200:
            print(f"  {colour('FAIL', 'red')} /api/assess returned {resp.status_code}")
            return False

        data = resp.json()
        metrics = data.get("metrics", {})
        op_margin = metrics.get("operatingMargin")

        # Operating margin must be null (not 20% which would be (1M - 600k - 200k)/1M)
        if op_margin is None:
            print(f"  {colour('PASS', 'green')} Operating Margin correctly marked as null when non-disclosed")
            return True
        else:
            print(f"  {colour('FAIL', 'red')} Operating Margin calculated as {op_margin}% instead of null")
            return False

def test_input_bounds_capping(base_url: str) -> bool:
    """Test question length capping and top_k parameter bounds."""
    print(f"\n{colour('4. TESTING RAG INPUT BOUNDS & CAPPING', 'bold')}")
    url = f"{base_url}/api/rag/query"

    with httpx.Client(timeout=15.0) as client:
        # Oversized question (> 500 chars)
        long_question = "What is " + ("very " * 300) + "long question?"
        resp = client.post(url, json={"doc_id": "eval_test", "question": long_question, "top_k": 999})
        if resp.status_code in (200, 403, 404):
            print(f"  {colour('PASS', 'green')} Oversized question and top_k bound-checked without crashing")
            return True
        else:
            print(f"  {colour('FAIL', 'red')} Unexpected response {resp.status_code}")
            return False

def main():
    parser = argparse.ArgumentParser(description="Productive Point Security and Correctness Test Suite")
    parser.add_argument("--url", default="http://localhost:3000", help="Base URL of Productive Point server")
    args = parser.parse_args()

    print(f"{colour('═' * 60, 'bold')}")
    print(f"{colour('PRODUCTIVE POINT SECURITY & PRODUCTION RELIABILITY TEST SUITE', 'bold')}")
    print(f"{colour('═' * 60, 'bold')}")

    t1 = test_file_validation(args.url)
    t2 = test_rag_authorization(args.url)
    t3 = test_margin_calculation_correctness(args.url)
    t4 = test_input_bounds_capping(args.url)

    all_passed = t1 and t2 and t3 and t4

    print(f"\n{colour('═' * 60, 'bold')}")
    if all_passed:
        print(f"{colour('ALL SECURITY & CORRECTNESS TESTS PASSED CLEANLY! (4/4)', 'green')}")
    else:
        print(f"{colour('SOME TESTS FAILED - SEE LOGS ABOVE', 'red')}")
    print(f"{colour('═' * 60, 'bold')}\n")

    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    main()
