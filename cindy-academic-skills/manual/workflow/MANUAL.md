# Academic Research Skills (ARS-Codex) Workflow Manual

> **Core Philosophy:** AI is your co-pilot, not the captain. This system never writes papers in a vacuum. It automates rigorous literature verification, integrity auditing, argument consistency checks, and multi-perspective review so human scholars can focus on deep intellectual synthesis.

---

## 1. Ten-Stage Research Lifecycle

The ARS pipeline enforces a disciplined 10-stage state machine with human-in-the-loop checkpoints:

```
[Stage 1: RESEARCH]  ──> (Confirm) ──> [Stage 2: WRITE] ──> (Confirm) ──> [Stage 2.5: INTEGRITY GATE]
                                                                                │
                                                                           PASS │ (Fail: fix <=3 rounds)
                                                                                ▼
[Stage 4: REVISE]    <── (Major/Minor) ── [Stage 3: PEER REVIEW (5 Perspectives)]
       │
       ▼ (Confirm)
[Stage 3': RE-REVIEW] ──> (Accept/Minor) ──> [Stage 4.5: FINAL INTEGRITY GATE] (Zero regression)
       │ (Major)                                     │
       ▼                                             ▼ PASS
[Stage 4': RE-REVISE] ────────────────────────> [Stage 5: FINALIZE] (LaTeX / APA 7.0 / PDF)
                                                     │
                                                     ▼
                                                [Stage 6: PROCESS SUMMARY & RECORD]
```

### Stage Details
1. **Stage 1 (RESEARCH):** Socratic dialogue for research question (RQ) formulation, hypothesis delineation, and PRISMA systematic literature discovery via Crossref.
2. **Stage 2 (WRITE):** Structure blueprinting, Claim-Evidence-Reasoning (CER) chain construction, and native-voice drafting.
3. **Stage 2.5 (INTEGRITY GATE):** Pre-review gate scanning for fabricated citations, statistical errors, and ungrounded claims.
4. **Stage 3 (REVIEW):** Multi-perspective peer review by Editor-in-Chief, 3 domain/methodology reviewers, and a dedicated Devil's Advocate.
5. **Stage 4 (REVISE):** Rebuttal matrix coach and point-by-point response to reviewer critique.
6. **Stage 3' (RE-REVIEW):** Verification review confirming that author revisions faithfully resolve all major concerns without introducing regressions.
7. **Stage 4' (RE-REVISE):** Focused second-pass revision for remaining edge-case disputes.
8. **Stage 4.5 (FINAL INTEGRITY):** Strict 100% citation anchor and claim-faithfulness verification.
9. **Stage 5 (FINALIZE):** Standards-compliant packaging (APA 7.0, LaTeX compilation, CRediT author statement, AI-assistance disclosure).
10. **Stage 6 (PROCESS SUMMARY):** Generates reproducible process provenance documenting the human-AI co-creation audit trail.

---

## 2. Seven Academic Integrity Failure Modes

Every integrity audit scans against the 7 structural failure modes identified in autonomous AI research systems (Lu et al., *Nature* 2026):

1. **Fabricated / Hallucinated Citations:** Citing non-existent DOIs, papers, or attributing real papers to wrong authors or nonexistent findings.
2. **Cherry-Picked Baseline Comparisons:** Selecting underpowered, outdated, or misconfigured baselines to artificially inflate empirical advantage.
3. **Bugs / Implementation Errors Masked as Discoveries:** Treating unintended code artifacts, data leakage, or evaluation loopholes as novel scientific findings.
4. **Missing Negative Controls & Equivalence Checks:** Omitting baseline randomization, confounder controls, or null-hypothesis checks.
5. **Overclaimed Empirical Generalizability:** Extrapolating narrow synthetic benchmark results into broad real-world or theoretical claims.
6. **Methodological Inconsistency & p-Hacking:** Tweaking exclusion criteria, test forms, or hyperparameters post hoc to achieve nominal statistical significance.
7. **Contaminated / Non-Reproducible Provenance:** Relying on unverified, non-public, or undocumented external experiment scripts.

---

## 3. Claim-Faithfulness (L3 Citation Anchor Protocol)

A paper must not cite a genuine publication to support a claim that the cited paper never made (Zhao et al., 2026).
- **Direct Anchor:** Specific quotation, table number, or theorem identifier from the source paper.
- **Synthesized Anchor:** Contextual summary verified against the cited paper's core findings.
- **Verification Rule:** If a cited DOI does not support the exact propositional claim in the referencing sentence, flag as `CLAIM_NOT_SUPPORTED` and block publication.

---

## 4. Multi-Perspective Peer Review Rubric (0-100 Score)

- **Editor-in-Chief:** Decides overall acceptability (Reject / Major / Minor / Accept), scope fit, and ethical compliance.
- **Reviewer 1 (Methodologist):** Evaluates mathematical derivations, statistical power, confounder controls, and baseline validity.
- **Reviewer 2 (Domain Specialist):** Assesses novelty, alignment with prior literature, and domain impact.
- **Reviewer 3 (Reproducibility Auditor):** Checks code/data availability, parameter disclosures, and execution fidelity.
- **Devil's Advocate:** Uncompromisingly challenges the foundational premise, alternative explanations, and potential fatal flaws.

---

## 5. Style Calibration & De-AI-ification

To preserve the authentic scholarly voice:
- Eliminate hollow filler adverbs and buzzwords (`delve`, `testament to`, `in the fast-paced landscape of`, `pivotal role`, `beacon of`).
- Replace vague quantifiers (`various`, `numerous`, `countless`) with specific counts, percentages, or bounded sets.
- Ensure all assertive claims (`clearly demonstrates`, `undoubtedly proves`) are tempered to match empirical uncertainty (`the evidence indicates`, `within our evaluated sample`).
