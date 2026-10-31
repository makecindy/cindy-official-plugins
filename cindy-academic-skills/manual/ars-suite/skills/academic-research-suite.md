---
name: academic-research-suite
description: >
  Master router and execution policy for the Academic Research Suite (ARS).
  Routes scholar requests across five research pillars: topic discovery,
  empirical data analysis, scientific figure design, manuscript drafting,
  and peer review evaluation.
metadata:
  version: "1.4.0"
  suite: "academic-research-suite"
---

# Academic Research Suite (ARS) — Master Router Specification

This document defines the routing, execution contract, and reference resolution rules for the Academic Research Suite in Cindy.

## 1. Scope & Core Architecture

The suite is organized into five interconnected pillars across the 10-stage scientific lifecycle:

1. **Stage 1 (Literature Exploration & Socratic Mentoring):**
   - References: `references/deep-research-socratic.md`
   - Skill Specification: `skills/deep-research.md`
   - Tools: `socratic_research_guide`, `verify_doi`, `search_crossref`, `three_way_lit_scan`
2. **Stage 1.5 (Empirical Data Analysis & Statistical Diagnostics):**
   - References: `references/data-analysis-workflow.md`
   - Tools: `statistical_analysis_advisor`, `academic_data_summary`
3. **Stage 1.8 (Scientific Figure Studio & Publication Graphics):**
   - References: `references/scientific-figure-guide.md`
   - Tools: `scientific_figure_designer`
4. **Stage 2 to Stage 2.5 (Manuscript Drafting & Integrity Gate):**
   - References: `references/academic-paper-writing.md`, `references/integrity-failure-modes.md`
   - Skill Specification: `skills/academic-paper.md`
   - Tools: `academic_paper_analysis`, `claim_citation_alignment`, `academic_style_audit`, `academic_integrity_audit`, `author_disclosure_statement`, `bibtex_format_converter`
5. **Stage 3 to Stage 4.5 (Multi-Perspective Peer Review & Rebuttal Coaching):**
   - References: `references/peer-review-rubric.md`, `references/rebuttal-and-revision.md`
   - Skill Specification: `skills/academic-paper-reviewer.md`
   - Tools: `peer_review_evaluation`, `rebuttal_matrix_coach`
6. **Overall Governance (Pipeline Orchestration):**
   - References: `references/pipeline-10-stages.md`
   - Skill Specification: `skills/academic-pipeline.md`
   - Tools: `pipeline_stage_orchestrator`

## 2. Dispatching & Routing Rules

When a user request enters the Academic Research Suite, the Agent classifies the current intent:

| User Intent | Route Target | Key Tool or Document |
| :--- | :--- | :--- |
| **Research Question & Literature** | Discovery & Socratic Mode | `socratic_research_guide`, `three_way_lit_scan` |
| **Citation Verification & Anti-Hallucination** | DOI Verification | `verify_doi`, `search_crossref` |
| **Statistical Model Selection & p-Hacking Prevention** | Empirical Statistics | `statistical_analysis_advisor`, `academic_data_summary` |
| **Publication Figure Planning & Plotting Scripts** | Scientific Figure Studio | `scientific_figure_designer` |
| **Manuscript Writing & Style Calibration** | Paper Drafting | `academic_paper.md`, `academic_style_audit` |
| **Academic Integrity Gate** | Integrity Gate | `academic_integrity_audit` (Stage 2.5 / 4.5) |
| **Peer Review Simulation & Critique** | Peer Review | `peer_review_evaluation`, `academic-paper-reviewer.md` |
| **Reviewer Response & Revision Matrix** | Rebuttal Coaching | `rebuttal_matrix_coach` |
| **End-to-End Scientific Lifecycle** | Pipeline Orchestration | `pipeline_stage_orchestrator`, `academic-pipeline.md` |

## 3. Human-in-the-Loop (HITL) Checkpoints

To ensure academic truthfulness, automated AI execution is paused at three critical transitions:
1. **Checkpoint 1 (Stage 1 -> 1.5):** User must confirm the settled Research Question (RQ) before launching empirical analysis.
2. **Checkpoint 2 (Stage 2.5):** Pre-review integrity audit requires human verification of all DOI citation records.
3. **Checkpoint 3 (Stage 4 -> 4.5):** Rebuttal matrix and revised manuscript require author review of experimental additions before final proofing.
