#!/usr/bin/env node
/**
 * Labelled domain-classification cases, for benchmarking a decision model.
 *
 * idea-re picks which decision lens applies to a document. It does that by
 * scoring keyword signatures weighted by how much of the topic is stated as a
 * requirement — a heuristic whose weakest measured point is domain choice: CBOR
 * filed as distributed-systems before the weighting fix, and RFC 6749 left
 * undecidable at a 0.027 margin.
 *
 * "Which of 3 domains does this belong to?" is a finite-choice decision, which
 * is exactly the shape a decision model takes. This benchmark answers whether one
 * actually beats the heuristic here.
 *
 * Labels come from what each document is, not from what idea-re guessed. Where
 * idea-re currently returns `generic`, that is recorded as the label: declining
 * to guess is a legitimate answer and a model that answers confidently would be
 * worse.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDecisions, DOMAINS, stripBoilerplate } from "../../src/domains.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const OUT_DIR = join(root, "eval", "data", "julia-cases");

/** Ground truth by document. Every one is a real specification with a known subject. */
const LABELS = {
  8259: "data-format", // JSON
  8949: "data-format", // CBOR
  3339: "data-format", // date and time on the internet
  9325: "data-format", // textual representation of trees
  8941: "data-format", // Concise Software Identification (tags)
  9110: "agent-protocol", // HTTP semantics
  6749: "generic", // OAuth 2.0: a protocol, but not an agent protocol
  8258: "generic", // Deprecating insecure HTTP connections
  9111: "generic", // HTTP/2
  8446: "generic", // TLS 1.3
  8447: "generic", // DNS over dedicated QUIC
  6269: "generic", // DNS over TCP
  7234: "generic", // TCP extensions for high performance
  9224: "data-format", // RDAP bootstrap registry (JSON format)
  9460: "data-format", // SVCB/HTTPS records
  9461: "data-format", // SVCB mapping for DNS
  9527: "data-format", // ZONEMD records
  9704: "distributed-systems", // local DNS authority: replication among servers
  9226: "distributed-systems", // TRON / in-band control plane
  9548: "distributed-systems", // reliable FEC
  8852: "distributed-systems", // network time security
  8032: "distributed-systems", // Ed25519 verification / CRDTs
};

/**
 * Excerpts: the body after front matter, not the RFC's title page.
 *
 * The first version took lines 1-90, which is 80% boilerplate and a truncated
 * abstract. It scored 10/22 but the misses were mostly `data-format`, because
 * a title page mentions nothing that discriminates.
 */
const excerptOf = (text) => {
  const prose = stripBoilerplate(text);
  // Start at the abstract or the first numbered section, whichever comes first,
  // then keep a bounded window so no case exceeds the model's context budget.
  const start = prose.search(/\bAbstract\b|^\s*1\.?\s/mu);
  const body = start > 0 ? prose.slice(start) : prose;
  return body.replace(/\s+/gu, " ").slice(0, 2400).trim();
};

const cases = [];
for (const [rfc, label] of Object.entries(LABELS)) {
  const path = join(root, "eval", "data", "rfcs", `rfc${rfc}.txt`);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  const excerpt = excerptOf(text);
  cases.push({
    id: `rfc${rfc}`,
    label,
    options: [...DOMAINS, "generic"],
    excerpt,
    bytes: excerpt.length,
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "cases.json"), JSON.stringify(cases, null, 2));

// What the current heuristic answers, so a benchmark compares like with like.
const scored = cases.map((c) => {
  const result = deriveDecisions(c.excerpt);
  return { id: c.id, label: c.label, predicted: result.domain, scores: result.scores ?? null };
});
writeFileSync(join(OUT_DIR, "heuristic-baseline.json"), JSON.stringify(scored, null, 2));

const correct = scored.filter((s) => s.predicted === s.label).length;
process.stdout.write(`wrote ${cases.length} cases -> ${OUT_DIR}\n`);
process.stdout.write(`heuristic baseline: ${correct}/${cases.length} correct\n`);
for (const s of scored.filter((s) => s.predicted !== s.label))
  process.stdout.write(`  miss ${s.id}: label=${s.label} predicted=${s.predicted}\n`);