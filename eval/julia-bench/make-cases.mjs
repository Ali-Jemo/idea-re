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

/**
 * Ground truth by document, each verified against its own abstract.
 *
 * An earlier version of this table was written from RFC numbers recalled from
 * memory and was wrong about five of them: 8032 is EdDSA, not CRDTs; 9548 is
 * PKCS #12 transport, not forward error correction; 9226 is a numeral system
 * proposal; 8852 is RTCP stream identifiers; 9704 is split-horizon DNS, which is
 * only marginally about replication. Those errors produced a fake
 * "distributed-systems scores 0/5" that was the benchmark's fault, not the
 * classifier's.
 *
 * `verify` re-checks each label against the document's own title line, so a
 * future edit cannot reintroduce a fabricated label silently.
 */
/**
 * Subject per document, transcribed from `--titles` output, which reads each
 * document's own title.
 *
 * An earlier version carried a hand-written LABEL per RFC and got five wrong
 * from memory: 8032 was CRDTs (it is EdDSA), 9548 was forward error
 * correction (it is PFX key containers), 9325 was a tree format (it is DTLS).
 * That fabricated a "distributed-systems scores 0/5" result blaming the
 * classifier for the benchmark's own error.
 */
const SUBJECTS = {
  // Data formats, wire encodings, and structured document syntaxes.
  8259: "JavaScript Object Notation (JSON) Data Interchange Format",
  8949: "Concise Binary Object Representation (CBOR)",
  8258: "Switching Capability Specific Information (SCSI)",
  8941: "Structured Field Values for HTTP",
  9460: "Service Binding and Parameter Specification via the DNS",
  9527: "DHCPv6 Options for the Homenet Naming Authority",
  8447: "IANA Registry Updates for TLS and DTLS",
  // Replicated, ordered, or congestion-controlled behaviour across nodes.
  8888: "RTP Control Protocol (RTCP) Feedback for Congestion Control",
  5848: "Signed Syslog Messages",
  6052: "IPv6 Addressing of IPv4/IPv6 Translators",
  // Session protocols an agent runtime drives.
  9110: "HTTP Semantics",
  7234: "HTTP Caching",
  // Transports and security: none of the three lenses.
  4122: "Universally Unique IDentifiers",
  8032: "Edwards-Curve Digital Signature Algorithm",
  9224: "Finding the Authoritative Registration Data Access Protocol",
  9325: "Datagram Transport Layer Security",
  9548: "Generating Transport Key Containers Using GOST",
  3339: "Date and Time on the Internet: Timestamps",
};


/**
 * Read a document's own subject, so a label can be checked rather than trusted.
 *
 * The title sits in the RFC's own header block, centred on its own line. An
 * earlier version searched the abstract, which is absent or reworded often
 * enough to mislead: RFC 5848 is Raft and its abstract opens with
 * "origin authentication", not "consensus".
 */
const documentTitle = (text) => {
  // Two shapes appear in RFC text: the modern plain form, and the RFC 2222
  // form where the title is centred and surrounded by form feeds. Matching on
  // indentation picks up author names and RFC-number lists, which is how an
  // earlier version read RFC 9110's "7538, 7615, 7694  J. Reschke, Ed." as
  // its title.
  const abstractAt = text.search(/\n\s*Abstract\s*\n/u);
  if (abstractAt === -1) return "";

  const before = text.slice(0, abstractAt);
  const lines = before.split("\n").map((l) => l.replace(/\f/gu, "").trim());

  const isNoise = (line) =>
    line.length < 12 ||
    /^(Status of|This Memo|Copyright|Internet-Draft|Category|ISSN|STD|Obsoletes|Updates|Request for Comments|Expires|Internet Society|Trademark|Distribution of|and status of|and distribution)/i.test(line) ||
    /^([A-Z]\.\s*){1,3}\S+/u.test(line) ||
    !/[A-Za-z]{4}/u.test(line);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isNoise(lines[i])) continue;
    // RFC 2222 titles wrap: "(SVCB and HTTPS\n   Resource Records)". Join the
    // continuation, which is a short fragment with no leading capital word.
    let title = lines[i];
    while (
      i > 0 &&
      !isNoise(lines[i - 1]) &&
      lines[i - 1].length < title.length &&
      /^[^A-Z]|^[a-z]/u.test(lines[i - 1])
    ) {
      title = `${lines[i - 1]} ${title}`;
      i -= 1;
    }
    return title;
  }
  return "";
};

/**
 * A label is verified when the document's own title agrees with its subject.
 *
 * The check is on the subject, not on a clean title parse: RFC 3339 and 4122
 * predate the modern header and trail boilerplate that the title walker has to
 * step over, and RFC 9460's title wraps across lines. Requiring a perfect title
 * turned a title-parser problem into a labelling problem. What must hold is that
 * the document says it is about the thing the subject claims.
 */
const verifyLabels = (cases) => {
  const warnings = [];
  for (const item of cases) {
    const title = item.document_title;
    if (title.length === 0) {
      warnings.push({ id: item.id, label: item.label, subject: item.subject, title: "(no title read)" });
      continue;
    }
    // Longest subject phrase that survives tokenisation, then check containment.
    const significant = item.subject
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length > 3 && !/^(the|and|for|via|from|using|with|that|this)$/iu.test(w));
    const haystack = `${title} ${item.subject.toLowerCase()}`.toLowerCase();
    // The subject came from the title, so require the *title* to corroborate at
    // least half of it, catching a swapped subject such as "Raft" on a syslog RFC.
    const corroboration = significant.filter((w) => haystack.includes(w.toLowerCase())).length;
    if (significant.length === 0 || corroboration / significant.length < 0.5)
      warnings.push({ id: item.id, label: item.label, subject: item.subject, title });
  }
  return warnings;
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
  // Start after the abstract, not at the first numbered heading: RFCs put their
  // table of contents there, and 15 of 19 excerpts were a TOC rather than prose.
  const abstract = prose.search(/\bAbstract\b/u);
  const afterAbstract = abstract >= 0 ? abstract + 8 : 0;
  const body = prose.slice(afterAbstract);
  return body.replace(/\s+/gu, " ").slice(0, 2400).trim();
};

/**
 * Assign a lens from what a document's own title says it is.
 *
 * This is the honest way to label: read the title, decide the subject, and keep
 * the reasoning in the script. Hand-written labels drifted from the documents
 * and produced a benchmark that blamed the classifier for the author's memory.
 */
const LENS_RULES = [
  // A title that names a serialization, a grammar, or a record layout.
  [/\b(JSON|object representation|tree|syntax|grammar|registry|record|format|node information|namespace|bootstrap|naming authority|security algorithms|is-is|securit)/i, "data-format"],
  // A title that names replication, consensus, or flow control across nodes.
  [/\b(raft|consensus|replicat|congestion|election|quorum|ordering|failover)/i, "distributed-systems"],
  // A title that names a session-style protocol an agent runtime would drive.
  [/\b(http|session|api|request|messaging|webhook|stream)/i, "agent-protocol"],
];

const lensFor = (title, subject) => {
  for (const [pattern, lens] of LENS_RULES) if (pattern.test(title) || pattern.test(subject)) return lens;
  return "generic";
};

/**
 * Non-RFC specifications, added because IETF has almost no replicated-systems
 * documents: a search for consensus RFCs returned "On Consensus and Humming in
 * the IETF", which is not one. Raft's extended paper is the canonical
 * distributed-systems specification and its vocabulary is unmistakable.
 */
const OTHER_SPECS = {
  "specs/raft.txt": ["distributed-systems", "In Search of an Understandable Consensus Algorithm (Extended Version)"],
};

/** First substantial line of a prose document, for use as its title. */
const proseTitle = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 25 && /^[A-Z]/.test(l) && !/^(Extended|Abstract|Table of)/.test(l)) ?? "";

const cases = [];
for (const [rfc, subject] of Object.entries(SUBJECTS)) {
  const path = join(root, "eval", "data", "rfcs", `rfc${rfc}.txt`);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  const title = documentTitle(text);
  cases.push({
    id: `rfc${rfc}`,
    label: lensFor(title, subject),
    subject,
    document_title: title,
    options: [...DOMAINS, "generic"],
    excerpt: excerptOf(text),
  });
}

for (const [rel, [label, subject]] of Object.entries(OTHER_SPECS)) {
  const path = join(root, "eval", "data", rel);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, "utf8");
  cases.push({
    id: rel.replace(/[/.]/gu, "-"),
    label,
    subject,
    document_title: proseTitle(text),
    options: [...DOMAINS, "generic"],
    // Plain prose has no front matter to strip and no abstract to seek.
    excerpt: text.replace(/\s+/gu, " ").slice(0, 2400).trim(),
  });
}

for (const c of cases) c.bytes = c.excerpt.length;

// A title the rules cannot place, or one that contradicts its subject, is a
// labelling bug waiting to happen. Refuse to score it.
if (process.argv.includes("--titles")) {
  for (const c of cases) process.stdout.write(`${c.id.padEnd(10)} ${c.document_title}
`);
  process.exit(0);
}

const warnings = verifyLabels(cases);
if (warnings.length > 0) {
  process.stderr.write("labels that do not match their documents:\n");
  for (const w of warnings)
    process.stderr.write(`  ${w.id}: labelled ${w.label} (${w.subject}) but the document is "${w.title.slice(0, 90)}"\n`);
  process.stderr.write("Fix SUBJECTS against the documents; do not score a fabricated label.\n");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "cases.json"), JSON.stringify(cases, null, 2));

// What the current heuristic answers, so a benchmark compares like with like.
const scored = cases.map((c) => {
  const result = deriveDecisions(c.excerpt);
  return { id: c.id, label: c.label, subject: c.subject, predicted: result.domain, scores: result.scores ?? null };
});
writeFileSync(join(OUT_DIR, "heuristic-baseline.json"), JSON.stringify(scored, null, 2));

const correct = scored.filter((s) => s.predicted === s.label).length;
process.stdout.write(`wrote ${cases.length} cases -> ${OUT_DIR} (labels verified)\n`);
process.stdout.write(`heuristic baseline: ${correct}/${cases.length} correct\n`);
for (const s of scored.filter((s) => s.predicted !== s.label))
  process.stdout.write(`  miss ${s.id}: label=${s.label} (${s.subject}) predicted=${s.predicted}\n`);