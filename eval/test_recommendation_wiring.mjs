#!/usr/bin/env node
/**
 * Vantly — Recommendation Wiring Unit Tests
 * ==========================================
 * Tests the validateLLMRecommendations logic in isolation.
 * Uses Node's built-in test runner (node:test), available in Node 18+.
 *
 * Run from project root:
 *   node eval/test_recommendation_wiring.mjs
 *
 * These tests cover the five cases specified in the bug-fix requirements:
 *   Test A: Valid LLM recommendations → source: "llm"
 *   Test B: Empty LLM array          → source: "fallback"
 *   Test C: Missing LLM field        → source: "fallback"
 *   Test D: Only blank strings        → source: "fallback"
 *   Test E: Whitespace trimming       → valid recs preserved after trim
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Inline the implementation being tested ────────────────────────────────────
// This mirrors validateLLMRecommendations in server.ts exactly.
// If the server.ts implementation changes, update this copy to match.

const FALLBACK_RECOMMENDATIONS = [
  "Review current payroll allocation to optimize labour output.",
  "Track supplier expenses more accurately to raise gross margins.",
  "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow.",
];

function validateLLMRecommendations(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return null;
  const valid = recs
    .filter((r) => typeof r === "string")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return valid.length > 0 ? valid : null;
}

function resolveRecommendations(llmRecommendations) {
  const validLLMRecs = validateLLMRecommendations(llmRecommendations);
  const recommendations = validLLMRecs ?? FALLBACK_RECOMMENDATIONS;
  const recommendationSource = validLLMRecs !== null ? "llm" : "fallback";
  return { recommendations, recommendationSource };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("Test A: Valid LLM recommendations are returned with source=llm", () => {
  const llmRecs = [
    "Reduce cost of goods sold by renegotiating supplier contracts.",
    "Implement zero-based budgeting for operational overhead.",
    "Invest in upskilling shop-floor staff to improve output per head.",
  ];
  const { recommendations, recommendationSource } = resolveRecommendations(llmRecs);

  assert.equal(recommendationSource, "llm", "Source must be 'llm'");
  assert.deepEqual(recommendations, llmRecs, "Recommendations must match LLM output exactly");
  assert.notDeepEqual(
    recommendations,
    FALLBACK_RECOMMENDATIONS,
    "Returned recommendations must differ from hardcoded fallback"
  );
  console.log("  PASS Test A — Valid LLM recs returned, source=llm");
});

test("Test B: Empty LLM recommendation array triggers fallback", () => {
  const { recommendations, recommendationSource } = resolveRecommendations([]);

  assert.equal(recommendationSource, "fallback", "Source must be 'fallback'");
  assert.deepEqual(recommendations, FALLBACK_RECOMMENDATIONS, "Must return fallback array");
  console.log("  PASS Test B — Empty array triggers fallback, source=fallback");
});

test("Test C: Missing (undefined) LLM recommendations triggers fallback", () => {
  const { recommendations, recommendationSource } = resolveRecommendations(undefined);

  assert.equal(recommendationSource, "fallback", "Source must be 'fallback'");
  assert.deepEqual(recommendations, FALLBACK_RECOMMENDATIONS, "Must return fallback array");
  console.log("  PASS Test C — Missing field triggers fallback, source=fallback");
});

test("Test C2: Null LLM recommendations triggers fallback", () => {
  const { recommendations, recommendationSource } = resolveRecommendations(null);

  assert.equal(recommendationSource, "fallback", "Source must be 'fallback'");
  assert.deepEqual(recommendations, FALLBACK_RECOMMENDATIONS, "Must return fallback array");
  console.log("  PASS Test C2 — Null field triggers fallback, source=fallback");
});

test("Test D: Array containing only empty or whitespace strings triggers fallback", () => {
  const { recommendations, recommendationSource } = resolveRecommendations(["", "   ", "\t", " \n "]);

  assert.equal(recommendationSource, "fallback", "Source must be 'fallback'");
  assert.deepEqual(recommendations, FALLBACK_RECOMMENDATIONS, "Must return fallback array");
  console.log("  PASS Test D — All-blank array triggers fallback, source=fallback");
});

test("Test E: Valid recommendations with leading/trailing whitespace are trimmed and preserved", () => {
  const llmRecs = [
    "  Automate invoice processing to reduce accounts payable cycle time.  ",
    "\tConduct quarterly workforce productivity benchmarking against sector peers.\t",
    "  Consolidate software subscriptions to eliminate duplicate tooling costs.",
  ];
  const expected = [
    "Automate invoice processing to reduce accounts payable cycle time.",
    "Conduct quarterly workforce productivity benchmarking against sector peers.",
    "Consolidate software subscriptions to eliminate duplicate tooling costs.",
  ];
  const { recommendations, recommendationSource } = resolveRecommendations(llmRecs);

  assert.equal(recommendationSource, "llm", "Source must be 'llm'");
  assert.deepEqual(recommendations, expected, "Whitespace must be trimmed; valid content preserved");
  console.log("  PASS Test E — Whitespace trimmed, valid recs preserved, source=llm");
});

test("Test E2: Mixed valid and blank strings — only valid ones returned", () => {
  const llmRecs = ["", "Review operating cost structure to improve EBIT margin.", "  ", null, 42];
  const expected = ["Review operating cost structure to improve EBIT margin."];
  const { recommendations, recommendationSource } = resolveRecommendations(llmRecs);

  assert.equal(recommendationSource, "llm", "Source must be 'llm' when at least one valid rec present");
  assert.deepEqual(recommendations, expected, "Only valid non-blank strings must be returned");
  console.log("  PASS Test E2 — Mixed array: blanks/non-strings filtered out, valid kept");
});

test("Test F: Non-array LLM field (e.g. string or number) triggers fallback", () => {
  for (const bad of ["a recommendation string", 42, { rec: "..." }, true]) {
    const { recommendations, recommendationSource } = resolveRecommendations(bad);
    assert.equal(recommendationSource, "fallback", `Non-array input ${JSON.stringify(bad)} must trigger fallback`);
    assert.deepEqual(recommendations, FALLBACK_RECOMMENDATIONS);
  }
  console.log("  PASS Test F — Non-array inputs all trigger fallback, source=fallback");
});
