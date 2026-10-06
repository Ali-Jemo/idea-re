#!/usr/bin/env node
/**
 * False-positive rate and detection precision.
 *
 * A false gap sends an implementer after a decision the spec already made, so
 * precision matters more than recall. The detection benchmark cannot measure it:
 * it only scores documents known to contain defects.
 *
 * Two measurements from controls whose correct answer is known by construction:
 *
 *   false_positive_rate  gaps reported on documents that settle every decision
 *   detection            gaps reported on documents that leave exactly one open
 *
 * Precision is the honest summary: of all gaps reported across both sets, how
 * many correspond to a decision the document really left open.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, ensureDir } from "./paths.mjs";
import { analyzeIdea } from "../src/pipeline.mjs";

const DIR = process.argv[2] ?? ensureDir(join(CORPORA, "negatives"));
const manifestPath = `${DIR}/manifest.json`;
if (!existsSync(manifestPath)) {
  process.stderr.write(`missing ${manifestPath}\nrun: node eval/make-negatives.mjs\n`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const rows = [];
for (const control of manifest) {
  const result = await analyzeIdea([control.file], { domain: control.domain });
  const found = result.gaps.map((g) => g.gap_id.replace(/^gap_/u, ""));
  const expected = control.expect_gaps;

  rows.push({
    name: control.name,
    kind: control.kind,
    domain: control.domain,
    expected,
    found,
    false_positives: control.kind === "complete" ? found : found.filter((g) => !expected.includes(g)),
    missed: expected.filter((g) => !found.includes(g)),
    // True positives live only on partial controls: a gap on a complete
    // document is wrong by definition, so counting it as a hit would inflate.
    true_positives: control.kind === "partial" ? found.filter((g) => expected.includes(g)) : [],
  });
}

const complete = rows.filter((r) => r.kind === "complete");
const partial = rows.filter((r) => r.kind === "partial");

const totalFalsePositives = rows.reduce((s, r) => s + r.false_positives.length, 0);
const totalTruePositives = rows.reduce((s, r) => s + r.true_positives.length, 0);
const totalMissed = rows.reduce((s, r) => s + r.missed.length, 0);
const decisionsConsidered = rows.reduce((s, r) => s + manifest.find((m) => m.name === r.name).expect_gaps.length, 0);

// Per-decision false positive rate: of the decisions each complete document
// discussed, how many were wrongly called unstated. This is the number a
// reviewer should read — a single stray keyword can raise a gap in any document.
const completeDecisionExposure = complete.reduce((s, r) => {
  const expected = manifest.find((m) => m.name === r.name);
  return s + Math.max(0, expected.domain === "distributed-systems" ? 5 : expected.domain === "data-format" ? 5 : 7);
}, 0);

const report = {
  controls: {
    complete: complete.length,
    partial: partial.length,
  },
  false_positive_rate: {
    gaps_on_complete_documents: totalFalsePositives,
    per_control: complete.map((r) => ({ name: r.name, false_positives: r.false_positives })),
  },
  detection: {
    expected_open_decisions: totalMissed + totalTruePositives,
    found: totalTruePositives,
    missed: totalMissed,
    recall: totalMissed + totalTruePositives === 0 ? 0 : Number((totalTruePositives / (totalTruePositives + totalMissed)).toFixed(3)),
  },
  precision: totalTruePositives + totalFalsePositives === 0 ? 0 : Number((totalTruePositives / (totalTruePositives + totalFalsePositives)).toFixed(3)),
  detail: rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    domain: r.domain,
    expected: r.expected,
    found: r.found,
    false_positives: r.false_positives,
    missed: r.missed,
  })),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);