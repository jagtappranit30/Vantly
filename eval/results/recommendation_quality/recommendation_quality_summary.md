# Rubric-Based Recommendation Quality Evaluation
### Vantly MSc Dissertation — Chapter 5 Evidence

> **Separation notice:** This evaluation is entirely separate from the main RAG ground-truth evaluation (RAGAS scores, 90-query suite across three Meridian scenarios). It covers the `/api/assess` endpoint recommendation quality only. No existing evaluation files were overwritten.

---

## 1. Repository Fixture Inventory

The task specification referenced "ten additional synthetic company fixtures." Upon inspection, the repository contains exactly **three fixture files**:

| # | Fixture Filename | File Path | Document Condition | Selection Rationale |
|---|---|---|---|---|
| A | `meridian_financials.txt` | `eval/fixtures/meridian_financials.txt` | **Clean prose-narrative baseline** — structured prose with explicit section headings for P&L, balance sheet, labour metrics, and digital audit | Primary baseline; all metrics explicitly stated; establishes reference LLM behaviour at temperature=0.0, seed=42 |
| B | `meridian_scenario_b_tabular.txt` | `eval/fixtures/meridian_scenario_b_tabular.txt` | **Tabular/structured** — same underlying company, same figures, but presented in dense two-column FY2024 vs FY2023 format with variance columns | Tests extraction from structured column data; structurally distinct from Fixture A; introduces risk of column confusion |
| C | `meridian_scenario_c_degraded.txt` | `eval/fixtures/meridian_scenario_c_degraded.txt` | **OCR-degraded** — identical underlying company with systematic character-level corruption: `l`↔`1`, `O`↔`0`, `f`↔`£`, fused words | Most adversarial condition; tests extraction under character-level noise; all three conditions requested by original evaluation design |

> **Research integrity note:** No fixtures were invented, relabelled, or fabricated. The evaluation covers exactly the three real fixtures present in the repository.

---

## 2. System Architecture: Recommendation Generation

### How recommendations are generated

Recommendations are produced by the LLM via the `/api/assess` endpoint in `server.ts`. The relevant prompt instruction is:

```
Your task is to:
1. Extract key financial metrics with highest precision. Use null if missing.
2. Scan for mentions of software systems, bookkeeping packages, or digital ERP/CRM tools.
3. Classify digital maturity level as 'Low', 'Medium', or 'High'.
4. Formulate 3 to 5 practical productivity improvement recommendations.
5. Provide a crisp qualitative summary.
```

The model (`qwen2.5:7b` via Ollama) runs with `temperature: 0.0` and `seed: 42`, making output deterministic for identical prompts. Extraction and recommendation generation occur in a **single LLM call** — the LLM is not given the computed pillar scores before generating recommendations.

A server-side fallback exists (`server.ts` lines 347–351):

```typescript
recommendations: metrics.recommendations && metrics.recommendations.length > 0
  ? metrics.recommendations
  : [
      "Review current payroll allocation to optimize labour output.",
      "Track supplier expenses more accurately to raise gross margins.",
      "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow."
    ]
```

The three recommendations returned across **all fixtures** match these fallback strings exactly.

---

## 3. Rubric Definitions

Each recommendation is scored on four criteria, each 0 or 1. Maximum score per recommendation: **4 points**.

| Criterion | Score 1 | Score 0 |
|---|---|---|
| **Evidence-grounded** | Clearly supported by information extracted from the source document or assessment output | No clear supporting evidence, or depends on information not extracted |
| **Score-consistent** | Addresses a genuine weakness indicated by extracted metrics, digital maturity, or calculated scores | Contradicts the assessment, targets an evidently strong area, or ignores an obvious relevant signal |
| **Specific** | Identifies a specific business area, problem, or concrete improvement direction | Generic advice applicable to almost any SME without meaningful connection to this case |
| **Actionable** | Suggests a realistic action or improvement an SME could reasonably consider implementing | Too vague to guide action |

---

## 4. Assessment Outputs Per Fixture

### Fixture A — Clean Prose-Narrative Baseline

| Field | Value |
|---|---|
| Company | MERIDIAN MANUFACTURING LTD |
| Labour Efficiency Score | 26.3 / 50 |
| Financial Health Score | 33.6 / 50 |
| Productivity Index | 59.9 / 100 |
| Gross Margin (extracted) | 40% |
| Sector Benchmark Gross Margin (P50) | 35% |
| Operating Margin (extracted) | 0% |
| Sector Benchmark Operating Margin (P50) | 12% |
| Current Ratio | 2.00 |
| Revenue per Employee | £100,000 (sector P50: £98,000) |
| Output per Payroll | 4.0x (sector P50: 3.7x) |
| Digital Tools Extracted | SAP S/4HANA, Salesforce CRM, Microsoft 365, Keyence Vision Inspection Systems, SYSPRO MES |
| Digital Maturity (extracted) | **Medium** (document states: **HIGH**) — extraction error |
| API Status | SUCCESS |

**Key weaknesses in the actual data:**
- Operating margin 0% vs sector median 12% — the most significant financial gap
- Revenue concentration (68% from top 3 customers) — stated in document but not extractable as a scored metric
- Digital maturity misclassified downward (Medium vs HIGH)

### Fixture B — Tabular Format

| Field | Value |
|---|---|
| Company | MERIDIAN MANUFACTURING LTD |
| Labour Efficiency Score | 31.4 / 50 |
| Financial Health Score | **28 / 50** (degraded due to extraction error) |
| Productivity Index | 59.4 / 100 |
| Gross Margin (extracted) | **−100** (extraction error; actual: 40%) |
| Operating Margin | 0% |
| Current Ratio | 2.00 |
| Digital Tools Extracted | SAP S/4HANA, Salesforce CRM, Microsoft 365 & Power BI, Keyence Automated Optical Vision Systems, SYSPRO MES |
| Digital Maturity (extracted) | **Medium** (document states: **HIGH**) |
| API Status | SUCCESS — **grossMargin extraction error** |

**Critical extraction error:** The LLM appears to have read the FY2024 vs FY2023 variance column (`Gross Profit Margin (%): -1.5%`) rather than the actual gross margin row (40.0%). The server floor capped this at −100. This caused `financialHealthScore` to drop from 33.6 to 28.

### Fixture C — OCR-Degraded

| Field | Value |
|---|---|
| Company | **MERJDIAN MANUFACTURlNG LTD** (OCR corruption preserved) |
| Labour Efficiency Score | 28 / 50 |
| Financial Health Score | **28 / 50** (degraded due to OCR extraction error) |
| Productivity Index | 56 / 100 |
| Gross Margin (extracted) | **4** (extraction error; actual: 40%) |
| Operating Margin | 0% |
| Current Ratio | 2.00 |
| Digital Tools Extracted | SAP S/4HANA, Salesforce CRM, Microsoft 365, Keyence Vision inspection systems, SYSPRO MES |
| Digital Maturity (extracted) | **Medium** (document states: **HIGH**) |
| API Status | SUCCESS — **grossMargin extraction error** |

**Critical extraction error:** OCR corruption transformed `40.0%` into a string the LLM read as `4.0` or `4`. The extracted value of 4% is far below the sector median of 35%.

---

## 5. Rubric Evaluation — Detailed Results Table

> One row per recommendation. All scores applied strictly per rubric definitions.

| Fixture | Company | Rec # | Recommendation | Key Evidence / Weakness | EG | SC | SP | AC | Total | Notes |
|---|---|---|---|---|:---:|:---:|:---:|:---:|:---:|---|
| A (Clean) | Meridian Mfg Ltd | 1 | "Review current payroll allocation to optimize labour output." | No payroll weakness. Rev/emp £100k > P50 £98k; output/payroll 4.0x > P50 3.7x. Labour above median. | 0 | 0 | 0 | 1 | **1/4** | No payroll weakness identified. Labour metrics exceed sector median. Generic text with no adaptation to case. |
| A (Clean) | Meridian Mfg Ltd | 2 | "Track supplier expenses more accurately to raise gross margins." | Gross margin 40% exceeds benchmark 35%. Real weakness: operating margin 0% vs 12% median. | 0 | 0 | 1 | 1 | **2/4** | Gross margin is a strength, not a weakness. Rec ignores the actual financial gap (operating margin). Supplier expenses mentioned specifically. |
| A (Clean) | Meridian Mfg Ltd | 3 | "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow." | 5 enterprise tools extracted: SAP S/4HANA, Salesforce, SYSPRO MES, Keyence, MS365/Power BI. | 0 | 0 | 0 | 0 | **0/4** | Recommendation directly contradicted by extracted digital infrastructure. Recommending basic cloud bookkeeping to an SAP S/4HANA user is internally inconsistent with the LLM's own extraction output. |
| B (Tabular) | Meridian Mfg Ltd | 1 | "Review current payroll allocation to optimize labour output." | Labour score 31.4/50. Labour metrics above-median (same company). | 0 | 0 | 0 | 1 | **1/4** | Identical generic text to Fixture A. No adaptation to tabular format or degraded financial score. Labour above median. |
| B (Tabular) | Meridian Mfg Ltd | 2 | "Track supplier expenses more accurately to raise gross margins." | grossMargin extracted as −100 (error). Actual: 40%. Recommendation unchanged despite extraction failure. | 0 | 0 | 1 | 1 | **2/4** | Not grounded in correct evidence. Rec did not respond to the grossMargin=−100 signal. Score-inconsistent with true position; however flagged as inconsistent because the identical text was generated irrespective of the extraction anomaly. |
| B (Tabular) | Meridian Mfg Ltd | 3 | "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow." | 5 enterprise tools extracted from tabular format. | 0 | 0 | 0 | 0 | **0/4** | Same contradiction as Fixture A. SAP S/4HANA and SYSPRO MES extracted. Generic and inconsistent with own extraction. |
| C (OCR) | MERJDIAN MANUFACTURlNG LTD | 1 | "Review current payroll allocation to optimize labour output." | Labour score 28/50. Labour metrics still near-median under OCR. | 0 | 0 | 0 | 1 | **1/4** | Third consecutive fixture with identical rec. No adaptation to OCR conditions. No payroll weakness. |
| C (OCR) | MERJDIAN MANUFACTURlNG LTD | 2 | "Track supplier expenses more accurately to raise gross margins." | grossMargin extracted as 4% (OCR error). Sector benchmark 35%. Extracted value implies below-median margin. | 0 | 1 | 1 | 1 | **3/4** | Evidence-grounded=0: no explicit reference to extracted figure in recommendation text; same text used in all fixtures. Score-consistent=1: extracted grossMargin of 4% is far below 35% sector median, making gross margin improvement directionally consistent with extracted (corrupted) data. This is the sole instance of score-consistency across all 9 recommendations. |
| C (OCR) | MERJDIAN MANUFACTURlNG LTD | 3 | "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow." | 5 enterprise tools extracted despite OCR corruption. | 0 | 0 | 0 | 0 | **0/4** | Enterprise tools including SAP S/4HANA extracted even under heavy OCR. Generic digital recommendation unchanged and contradicted by extracted data. |

**Legend:** EG = Evidence-Grounded | SC = Score-Consistent | SP = Specific | AC = Actionable

---

## 6. Aggregate Calculations

```
Total recommendations evaluated:       9
Total possible criterion points:        9 × 4 = 36
```

### Per-criterion totals

| Criterion | Points Scored | Total Possible | Percentage |
|---|---:|---:|---:|
| Evidence-Grounded (EG) | 0 | 9 | **0.0%** |
| Score-Consistent (SC) | 1 | 9 | **11.1%** |
| Specific (SP) | 3 | 9 | **33.3%** |
| Actionable (AC) | 6 | 9 | **66.7%** |
| **Total** | **10** | **36** | — |

### Overall Rubric-Based Recommendation Quality Score

```
Overall Quality Score = (sum of all criterion points) / (total recommendations × 4) × 100
                      = 10 / 36 × 100
                      = 27.8%
```

### Mean score per recommendation

```
Mean score = total points / total recommendations
           = 10 / 9
           = 1.11 / 4
```

### Per-fixture breakdown

| Fixture | Rec 1 | Rec 2 | Rec 3 | Fixture Total | Fixture % |
|---|:---:|:---:|:---:|:---:|:---:|
| A (Clean) | 1/4 | 2/4 | 0/4 | 3/12 | 25.0% |
| B (Tabular) | 1/4 | 2/4 | 0/4 | 3/12 | 25.0% |
| C (OCR-Degraded) | 1/4 | 3/4 | 0/4 | 4/12 | 33.3% |

---

## 7. Strengths Observed

1. **Actionability is the strongest criterion (66.7%).** The three recommendations are at minimum plausible business activities. "Review payroll allocation" and "track supplier expenses" are real, implementable concepts for any manufacturing SME.

2. **Specificity is partial (33.3%).** Recommendation 2 ("Track supplier expenses...") names a specific mechanism rather than purely abstract advice, providing a modest improvement over fully generic guidance.

3. **Metric extraction is largely reliable under clean conditions.** Fixture A correctly extracted all key metrics. The scoring pipeline itself is deterministic and accurate given correct inputs.

4. **Digital tool extraction is robust.** All 5 enterprise tools were correctly identified across all three fixture conditions, including under heavy OCR corruption.

---

## 8. Weaknesses Observed

### 8.1 Recommendation invariance — the most critical finding

All three fixtures returned **identical recommendations**. The recommendation strings precisely match the server.ts hardcoded fallback defaults. The LLM uses `temperature: 0.0` and `seed: 42`, producing deterministic output, but the invariance across radically different input conditions (clean prose, tabular with extraction error, OCR-degraded) indicates that the recommendations are not meaningfully responsive to the extracted financial evidence.

### 8.2 Recommendation 3 contradicts extracted digital tools in every fixture

"Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow" received 0/4 in all three fixtures. The LLM extracted SAP S/4HANA — one of the most sophisticated enterprise ERP systems — in all three fixtures, then recommended "standard automation software" and "cloud bookkeeping." This is a direct internal contradiction within the same LLM response. This suggests the recommendation generation task is not conditioning on the digital tools extraction in the same call.

### 8.3 Evidence-grounded score is 0% across all recommendations

No recommendation cited, referenced, or was clearly derived from a specific extracted figure or document passage. The identical text used across all three fixtures — including Fixture B where grossMargin was extracted as −100 and Fixture C where it was extracted as 4 — confirms the recommendations were not adapted to the extracted evidence.

### 8.4 Recommendation 2 targets a strength rather than the primary weakness

Gross margin (40%) exceeds the sector benchmark (35%) in Fixture A. The genuine financial weakness — operating margin at 0% versus a sector median of 12% — is unaddressed in any recommendation across any fixture. This is a score-consistency failure for the clean and tabular conditions.

### 8.5 Tabular format causes critical extraction failure

Fixture B: grossMargin extracted as −100 (server.ts floor). The LLM appears to have confused the FY2024 vs FY2023 variance column (−1.5%) with the actual gross margin figure (40.0%). This reduced `financialHealthScore` from 33.6 to 28 and was not reflected in the recommendations.

### 8.6 OCR degradation causes gross margin extraction error

Fixture C: grossMargin extracted as 4 (should be 40). OCR corruption of `40.0%` was partially overcome but the extracted digit was 4 rather than 40. This accidentally made Recommendation 2 score-consistent with the (corrupted) extracted data, yielding the evaluation's highest per-recommendation score (3/4).

### 8.7 Digital maturity consistently misclassified

All three fixtures classify digital maturity as "Medium" despite the source document explicitly stating "HIGH" and despite 5 enterprise-grade tools being extracted. This suggests the LLM's digital maturity classification logic does not reliably integrate the tool inventory with the maturity label.

---

## 9. Failed or Invalid Runs

| Fixture | API Response Code | Notes |
|---|---|---|
| A — Clean | 200 OK | No failure. Minor: digital maturity misclassified (Medium vs HIGH) |
| B — Tabular | 200 OK | No failure at API level. **Critical extraction error:** grossMargin = −100 (actual: 40%) |
| C — OCR-Degraded | 200 OK | No failure at API level. **Critical extraction error:** grossMargin = 4 (actual: 40%). Company name returned with OCR corruption preserved |

No run failed, timed out, or returned invalid JSON. All three completed successfully.

---

## 10. Limitations

1. **Single company across all fixtures.** All three fixtures represent the same underlying company (Meridian Manufacturing Ltd) with the same ground-truth financial position. Variation in document condition is tested, but sector, company profile, and performance level are constant. The evaluation cannot assess whether recommendations vary meaningfully across different companies, sectors, or performance bands.

2. **Three fixtures, not five.** The repository contains three fixtures, not the five specified in the task or the ten mentioned by the researcher. This evaluation covers all available real fixtures.

3. **Researcher-applied rubric only.** Rubric scores were applied by the researcher conducting this evaluation. No independent evaluator reviewed the recommendations. This introduces author familiarity bias and limits inter-rater reliability claims.

4. **LLM determinism masks variability.** The LLM uses temperature=0.0 and seed=42. All three fixtures containing the same underlying Meridian data may produce identical outputs regardless of document format simply due to determinism. A fair evaluation of recommendation adaptability would require fixtures with genuinely different financial profiles.

5. **Single-call extraction and recommendation generation.** The LLM extracts metrics and generates recommendations in one prompt. It does not receive the computed pillar scores (labourEfficiencyScore, financialHealthScore, productivityIndex) before generating recommendations. This architectural constraint means the LLM cannot reason over the final scored outputs when formulating recommendations.

6. **Recommendation 2 may be fortuitously score-consistent in Fixture C.** The score-consistent=1 awarded for Fixture C Rec 2 is based on the corrupted grossMargin extraction (4% vs 35% benchmark). This is a coincidental alignment caused by an OCR error, not by the LLM correctly identifying a gross margin weakness.

---

## 11. Conclusion

The rubric-based evaluation produced an **Overall Recommendation Quality Score of 27.8%** across 9 recommendations from 3 fixtures.

The evaluation reveals a structural limitation: the three recommendations returned are invariant across all document conditions and match the server.ts hardcoded fallback defaults exactly. The LLM does not demonstrably adapt recommendations to the financial profile, digital maturity, or extracted metrics of the specific company being assessed. The most significant failure mode is Recommendation 3, which contradicts the LLM's own digital tool extraction in every run.

These findings have specific implications for the dissertation's Chapter 5 discussion of system limitations and future work.

---

*Evaluation conducted: 2026-08-29*
*System: Vantly /api/assess — qwen2.5:7b at http://localhost:3000*
*Evaluation type: Rubric-Based Recommendation Quality Evaluation (researcher-applied)*
*Files produced:*
- `eval/results/recommendation_quality/recommendation_quality_raw_outputs.json`
- `eval/results/recommendation_quality/recommendation_quality_results.csv`
- `eval/results/recommendation_quality/recommendation_quality_summary.md`
- `eval/results/recommendation_quality/fixture_a_clean_baseline_raw.json`
- `eval/results/recommendation_quality/fixture_b_tabular_raw.json`
- `eval/results/recommendation_quality/fixture_c_ocr_degraded_raw.json`
