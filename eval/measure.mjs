#!/usr/bin/env node
/**
 * Measure subtype classification against the RFCScope corpus.
 *
 * The corpus gives 239 findings a human-verified subtype. idea-re's classifier
 * is a heuristic, so the only honest question is: how often is it right?
 *
 * Ground truth: https://github.com/HIPREL-Group/RFCScope (studied-errata/)
 *
 * Reports both the rule-based classifier (the previous approach) and the
 * corpus-derived nearest-centroid model, plus 5-fold cross-validation, so the
 * measured ceiling is visible rather than asserted.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, RFCSCOPE } from "./paths.mjs";
import { keywordsIn } from "../src/taxonomy.mjs";
import { train, classify, crossValidate, classifierNote, LABELABLE } from "../src/subtype.mjs";

const CORPUS = process.argv[2] ?? join(CORPORA, "corpus.json");
if (!existsSync(CORPUS)) {
  process.stderr.write(`corpus missing: ${CORPUS}\nrun: node eval/parse-corpus.mjs\n`);
  process.exit(1);
}
const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));

/** True when original and corrected differ only in a requirement keyword. */
const isStrengthDrift = (finding) => {
  const strip = (s) => s.replace(/\b(MUST NOT|SHALL NOT|SHOULD NOT|MUST|SHALL|REQUIRED|SHOULD|MAY|OPTIONAL)\b/gu, "<K>");
  if (finding.original === "" || finding.corrected === "") return false;
  const a = strip(finding.original).replace(/\s+/gu, " ").trim();
  const b = strip(finding.corrected).replace(/\s+/gu, " ").trim();
  if (a === b) return false;
  return keywordsIn(finding.original).length > 0 && keywordsIn(finding.corrected).length > 0;
};

const NOTES = (finding) => `${finding.notes}\n${finding.explanation}`;

// ------------------------------------------------- classifier A: rule-based
const U4 = [
  /\bsections?\b[\s\S]{0,40}?\b(do(es)? not exist|doesn't exist|non-?existent|should (be|have been) (section|indicated)|incorrect(ly)? (section|reference))\b/iu,
  /\bdoes not (define|define or even mention|mention)\b/iu,
];
const I1 = [/\b(inconsistent|contradict|conflicts? with|disagree|typo|misspell)\b/iu];
const hits = (patterns, text) => patterns.some((p) => p.test(text));

const predictRuleBased = (finding) => {
  if (isStrengthDrift(finding)) return "I-1";
  const notes = NOTES(finding);
  if (hits(U4, notes)) return "U-4";
  if (hits(I1, notes)) return "I-1";
  return "U-2";
};

// ------------------------------------ classifier B: corpus-derived centroid
const centroids = train(corpus);
const predictCentroid = (finding) => classify(NOTES(finding), centroids).subtype;

// ---------------------------------------------------------------- measure
const score = (predict) => {
  const results = corpus.map((finding) => {
    const predicted = predict(finding);
    return { ...finding, predicted, correct: predicted === finding.subtype };
  });
  const accuracy = results.filter((r) => r.correct).length / results.length;

  const bySubtype = {};
  for (const r of results) {
    const row = (bySubtype[r.subtype] ??= { total: 0, correct: 0, predictedAs: {} });
    row.total += 1;
    if (r.correct) row.correct += 1;
    row.predictedAs[r.predicted] = (row.predictedAs[r.predicted] ?? 0) + 1;
  }
  const i2vsU3 = results.filter((r) => r.subtype === "I-2" || r.subtype === "U-3");
  return {
    accuracy: Number(accuracy.toFixed(4)),
    by_subtype: Object.fromEntries(
      Object.entries(bySubtype).map(([k, v]) => [
        k,
        { n: v.total, accuracy: Number((v.correct / v.total).toFixed(3)), predicted_as: v.predictedAs },
      ]),
    ),
    i2_vs_u3: {
      n: i2vsU3.length,
      accuracy: Number((i2vsU3.filter((r) => r.correct).length / i2vsU3.length).toFixed(3)),
    },
    results,
  };
};

const macro = (result) => {
  const values = Object.values(result.by_subtype).map((v) => v.accuracy);
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
};

const ruleBased = score(predictRuleBased);
const centroid = score(predictCentroid);
const cv = crossValidate(corpus);
const strengthCount = corpus.filter(isStrengthDrift).length;

// Per-subtype precision/recall for the labelable classes, which is the claim
// this model actually makes. Reporting 0.00 on I-1/I-2 would be true but
// useless: those are excluded by design and surfaced as the "I" family instead.
const labelableStats = {};
for (const subtype of ["U-1", "U-2", "U-3", "U-4", "I-3"]) {
  const truePositives = centroid.results.filter((r) => r.subtype === subtype && r.predicted === subtype).length;
  const predictedCount = centroid.results.filter((r) => r.predicted === subtype).length;
  const actualCount = centroid.results.filter((r) => r.subtype === subtype).length;
  labelableStats[subtype] = {
    n: actualCount,
    precision: predictedCount === 0 ? 0 : Number((truePositives / predictedCount).toFixed(3)),
    recall: actualCount === 0 ? 0 : Number((truePositives / actualCount).toFixed(3)),
    labelled: predictedCount,
  };
}

const abstained = centroid.results.filter((r) => r.predicted === null).length;
const abstainedCorrectly = centroid.results.filter((r) => r.predicted === null && LABELABLE.has(r.subtype)).length;

const report = {
  corpus: { findings: corpus.length, rfc_documents: new Set(corpus.map((r) => r.rfc)).size },
  rule_based: {
    overall_accuracy: ruleBased.accuracy,
    macro: macro(ruleBased),
    i2_vs_u3: ruleBased.i2_vs_u3,
    by_subtype: ruleBased.by_subtype,
  },
  corpus_derived: {
    // Overall accuracy understates the model: it abstains on I-1/I-2, the 189
    // dominant findings, so "accuracy" counts every abstention as a miss. What
    // matters for a triaging classifier is precision on the labels it emits.
    overall_accuracy: centroid.accuracy,
    macro: macro(centroid),
    abstained,
    abstained_correctly: abstainedCorrectly,
    labelable: labelableStats,
    cross_validated: cv,
    by_subtype: centroid.by_subtype,
  },
  strength_drift_detectable: strengthCount,
  verdict:
    `Emits labels for ${centroid.results.length - abstained}/${corpus.length} findings; ` +
    `abstains on the ${abstained - abstainedCorrectly} I-1/I-2 cases that measured 0.00 accuracy.`,
  note: classifierNote,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (process.argv.includes("--errors")) {
  const wrong = centroid.results.filter((r) => !r.correct);
  process.stdout.write(`\n--- ${wrong.length} misclassifications, first 12:\n`);
  for (const r of wrong.slice(0, 12)) {
    const got = classify(NOTES(r), centroids);
    process.stdout.write(`\n${r.subtype} -> ${r.predicted} (conf ${got.confidence}, margin ${got.margin}) [${r.id}]\n`);
    process.stdout.write(`  notes: ${(r.notes || r.explanation).slice(0, 200).replace(/\s+/gu, " ")}\n`);
  }
}