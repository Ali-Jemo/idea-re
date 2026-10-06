#!/usr/bin/env node
/**
 * Detection recall against RFCScope's verified findings on unmodified RFCs.
 *
 * The studied-errata corpus pairs an original with its correction, which is a
 * different task. This one is what idea-re claims to do: read a document nobody
 * edited, and report what is unstated or self-contradictory.
 *
 * Ground truth: 30 findings across 13 RFCs, 7 confirmed by the RFC authors or
 * verified on the RFC Editor Errata portal.
 *
 * A finding counts as recalled when an idea-re finding's evidence quote shares
 * real content with the report's excerpt. Word overlap, not string equality:
 * RFC text is re-wrapped and re-indented between the report and the source.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORPORA, RFCS } from "./paths.mjs";

const DETECTED = process.argv[2] ?? join(CORPORA, "detected.json");
const RFC_DIR = process.argv[3] ?? RFCS;
if (!existsSync(DETECTED)) {
  process.stderr.write(`missing ${DETECTED}\nrun: node eval/parse-detected.mjs\n`);
  process.exit(1);
}

const findings = JSON.parse(readFileSync(DETECTED, "utf8"));
const { analyzeIdea } = await import("../src/pipeline.mjs");

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "is", "are", "and", "or", "for", "on", "as",
  "that", "this", "with", "be", "by", "it", "from", "at", "which", "not", "can",
]);

const tokens = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .match(/[a-z][a-z-]{3,}/gu)
      ?.filter((w) => !STOP.has(w)) ?? [],
  );

/** Fraction of the report's content words present in our finding's evidence. */
const overlap = (a, b) => {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared += 1;
  return shared / ta.size;
};

const perRfc = new Map();
for (const f of findings) {
  if (!perRfc.has(f.rfc)) perRfc.set(f.rfc, []);
  perRfc.get(f.rfc).push(f);
}

const results = [];
const missingRfc = [];
for (const [rfc, bugs] of perRfc) {
  const path = join(RFC_DIR, `${rfc}.txt`);
  if (!existsSync(path)) {
    missingRfc.push(rfc);
    continue;
  }
  const result = await analyzeIdea([resolve(path)], { maxPasses: 1 });
  // Match against the evidence a finding carries, not its question. A finding
  // with no document text cannot be checked against a quoted excerpt, and the
  // benchmark scores a constant zero.
  const evidence = result.findings
    .map((g) => [...(g.evidence ?? []), g.strongest ?? "", g.weakest ?? ""].join(" "))
    .join(" ");

  for (const bug of bugs) {
    const score = overlap(bug.excerpt, evidence);
    results.push({
      id: bug.id,
      rfc,
      category: bug.category,
      confirmed: bug.confirmed,
      best_overlap: Number(score.toFixed(3)),
      recalled: score >= 0.3,
    });
  }
  process.stderr.write(`  analysed ${rfc}: ${result.findings.length} findings\n`);
}

const confirmedResults = results.filter((r) => r.confirmed);
const summarise = (rows) => ({
  n: rows.length,
  recalled: rows.filter((r) => r.recalled).length,
  rate: rows.length === 0 ? 0 : Number((rows.filter((r) => r.recalled).length / rows.length).toFixed(3)),
});

const report = {
  benchmark: {
    source: "RFCScope detected-bugs",
    rfc_documents: perRfc.size - missingRfc.length,
    findings: findings.length,
    author_confirmed: findings.filter((f) => f.confirmed).length,
    missing_rfcs: missingRfc,
  },
  recall_at_0_3: summarise(results),
  recall_confirmed_only: summarise(confirmedResults),
  mean_overlap: Number((results.reduce((s, r) => s + r.best_overlap, 0) / results.length).toFixed(3)),
  by_category: Object.fromEntries(
    [...new Set(results.map((r) => r.category))].map((c) => [c, summarise(results.filter((r) => r.category === c))]),
  ),
  note:
    "Recall at a 0.3 content-word overlap between a report's excerpt and idea-re's finding evidence. " +
    "Low recall is expected and honest: idea-re reports decisions that are *unstated*, while " +
    "these findings are contradictions inside stated text. The two tasks need different tools.",
  results,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);