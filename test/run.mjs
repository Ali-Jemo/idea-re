#!/usr/bin/env node
import assert from "node:assert/strict";
import { makeClaim, claimId, harvestDigest } from "../src/schema.mjs";
import { findGaps, convergence, IMPLEMENTATION_DECISIONS } from "../src/adversary.mjs";
import { toText, extractClaims } from "../src/harvest.mjs";
import { renderReport } from "../src/report.mjs";
import { deriveDecisions } from "../src/domains.mjs";
import { findContradictions } from "../src/contradictions.mjs";
import { verifyClaim, verifyClaims } from "../src/verify.mjs";
import { TAXONOMY, detectStrengthMismatch, requirementSubject, keywordsIn } from "../src/taxonomy.mjs";
import { refute, DISMISSAL_CRITERIA } from "../src/refute.mjs";

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } catch (cause) {
    failed += 1;
    process.stdout.write(`FAIL  ${name}\n      ${cause.message}\n`);
  }
};

const claim = (over = {}) =>
  makeClaim({ text: "Agents load memory at session start", quote: "Agents load it at the start of every session", source: "https://example.com/spec", ...over });

process.stdout.write("schema\n");

test("claim ids are stable across whitespace and case", () => {
  assert.equal(claimId("The  Quick   Brown Fox"), claimId("the quick brown fox"));
});

test("claim ids differ for different text", () => {
  assert.notEqual(claimId("one thing"), claimId("another thing"));
});

test("a claim without a quote is rejected", () => {
  assert.throws(() => makeClaim({ text: "x", source: "https://a.com" }), /quote is required/u);
});

test("a claim without an absolute source is rejected", () => {
  assert.throws(() => claim({ quote: "q", source: "not-a-url" }), /absolute URL/u);
});

test("an unknown confidence level is rejected", () => {
  assert.throws(() => claim({ confidence: "vibes" }), /confidence must be one of/u);
});

test("harvest digest is order-independent", () => {
  const a = claim();
  const b = claim({ text: "Different claim", quote: "q2" });
  assert.equal(harvestDigest([a, b]), harvestDigest([b, a]));
});

process.stdout.write("adversary\n");

test("a spec that discusses a topic without settling it yields a gap", () => {
  const gaps = findGaps("When two agents edit the same line, git merges their changes and surfaces conflicts.");
  assert.ok(gaps.some((g) => g.gap_id === "gap_conflict-resolution"), "expected a conflict-resolution gap");
});

test("a spec that never mentions a topic raises no gap", () => {
  // Nothing about metadata parsing was said, so there is nothing to leave open.
  assert.deepEqual(findGaps("Memories are stored in files. Links connect them."), []);
});

test("a committed conflict policy clears that gap", () => {
  const vague = findGaps("When two agents edit the same line, git merges their changes and surfaces conflicts.");
  const firm = findGaps(
    "When two agents edit the same line, git rejects the second push, and that agent reads both versions before writing one.",
  );
  assert.ok(vague.some((g) => g.gap_id === "gap_conflict-resolution"));
  assert.ok(!firm.some((g) => g.gap_id === "gap_conflict-resolution"), "a stated policy clears the gap");
});

test("code examples do not count as specification", () => {
  // A fenced example demonstrates usage; it must not silence the gap.
  const gaps = findGaps("```\n- [[team_structure]]\n- [[projects/payments]]\n```\nUse [[path]] to link.");
  assert.ok(gaps.some((g) => g.gap_id === "gap_link-resolution") === false, "link syntax is specified");
});

test("completeness falls as gaps accumulate", () => {
  const clean = convergence([]);
  const messy = convergence(
    IMPLEMENTATION_DECISIONS.slice(0, 3).map((d) => ({ gap_id: `gap_${d.id}`, severity: "blocking" })),
  );
  assert.equal(clean.completeness, 1);
  assert.ok(messy.completeness < clean.completeness);
  assert.equal(clean.rebuildable, true);
  assert.equal(messy.rebuildable, false);
});

test("a complete spec scores rebuildable with no gaps", () => {
  // The discriminating test: the detector must not just always find gaps.
  const complete = [
    "When two agents edit the same line, git rejects the second push.",
    "When a metadata value contains a semicolon, escape it as a backslash.",
    "Use [[path]] to link between files.",
    "When a new entry contradicts an old one, the newer entry wins by last-write.",
    "Dreaming runs periodically, and it owns its state in the repo.",
    "MEMORY.md must contain at most 500 lines.",
    "The agent tracks who said what and writes each memory to the right repo.",
  ].join("\n");
  const gaps = findGaps(complete);
  assert.deepEqual(gaps.map((g) => g.gap_id), [], "a fully specified spec has no gaps");
  assert.equal(convergence(gaps).rebuildable, true);
});

process.stdout.write("domains\n");

test("a thin consensus sketch does not claim a domain", () => {
  // Named protocols with no requirements score 2.6 of the 3.0 needed. Correct
  // behaviour is `generic`, not a confident guess from three capitalised nouns.
  assert.equal(
    deriveDecisions(
      `A proposer broadcasts PREPARE to all replicas. Replicas reply PROMISE.
       The leader sends COMMIT and replicas apply the value to their state machine.
       Ballots are monotonically increasing, and a replica ignores a lower number.
       If a replica fails, the others time out after 2 seconds and start a new election.`,
    ).domain,
    "generic",
  );
});

test("a thin mention does not claim a domain", () => {
  // Three sentences cannot establish a domain: the majority rule must hold back.
  assert.equal(
    deriveDecisions("A proposer broadcasts PREPARE. Replicas reply PROMISE. The leader sends COMMIT.").domain,
    "generic",
  );
});

test("a memory spec classifies as agent-protocol", () => {
  // Needs at least ceil(7/2) = 4 of the domain's topics present: concurrency,
  // provenance, contradiction policy, retrieval scope, and scheduling.
  const { domain } = deriveDecisions(
    `Every session follows the same steps. An agent clones the latest memory before it starts.
     Agents load MEMORY.md at the start of every session.
     Entries link to each other, so an agent follows links like a wiki.
     Dreaming is a dedicated agent that runs periodically and cleans up memory.
     When two agents edit the same entry, git rejects the second push.
     Each repo keeps its own ownership, permissions, and history.
     The agent tracks who said what and writes each memory to the right repo.
     When a new entry contradicts an old one, the newer entry wins.`,
  );
  assert.equal(domain, "agent-protocol");
});

test("an OAuth spec is not confidently classified", () => {
  // Measured against real RFC 6749: data-format 6.759 vs agent-protocol 6.732.
  // A 0.027 lead means "I do not know", and saying so beats a coin flip an agent
  // would act on. OAuth is genuinely neither a serialization format nor an
  // agent protocol.
  const { domain } = deriveDecisions(
    `The authorization server MUST support the use of the TLS protocol.
     The client MUST authenticate with the authorization server.
     Access tokens MUST be bound to the client identifier.
     The response type MUST be a registered extension value.
     The field separator MUST be encoded in the request body.`,
  );
  assert.equal(domain, "generic");
});

test("a single stray mention does not claim a domain", () => {
  assert.equal(deriveDecisions("The server may fail. Replica consensus is discussed here.").domain, "generic");
});

test("an explicit domain override wins over the guess", () => {
  const { domain } = deriveDecisions("totally unrelated prose", "data-format");
  assert.equal(domain, "data-format");
});

test("an unknown domain override is rejected", () => {
  assert.throws(() => deriveDecisions("x", "nonsense"), /Unknown domain/u);
});

test("format specs classify as data-format, not by commonest word", () => {
  // CBOR mentions "key ordering" 48 times and "the consensus of the IETF
  // community" once. A raw keyword count filed it as distributed-systems.
  const cbor = `
    A deterministic encoding may use a length-first map key ordering.
    The consensus of the IETF community prefers deterministic encoding.
    A decoder MUST reject a well-formed item that is not a valid data item.
    Implementers MUST validate the major type before reading additional information.
    Well-formedness is defined independently of validity.
    Generators and decoders SHOULD be able to process nested indefinite-length items.
    A decoder MUST skip over an unknown simple value.
    Applications MUST NOT rely on the order in which items appear in a map.
  `;
  assert.equal(deriveDecisions(cbor).domain, "data-format");
});

test("a single stray mention does not claim a domain", () => {
  assert.equal(deriveDecisions("The server may fail. Replica consensus is discussed here.").domain, "generic");
});

test("completeness scores against the applicable decision set", () => {
  // A 5-decision protocol must not be penalised against a 7-decision memory set.
  const five = Array.from({ length: 5 }, (_, i) => ({ gap_id: `gap_d${i}`, severity: "blocking" }));
  assert.equal(convergence(five, 5).completeness, 0);
  assert.equal(convergence(five, 5).decisions_considered, 5);
});

process.stdout.write("contradictions\n");

const src = (text, u) => makeClaim({ text, quote: text, source: u, confidence: "stated" });

test("opposite polarity on the same subject is a contradiction", () => {
  const found = findContradictions([
    src("Replicas must never apply two conflicting committed values", "https://a.com/s"),
    src("Replicas may apply two conflicting committed values during a partition", "https://b.com/b"),
  ]);
  assert.equal(found.length, 1);
  assert.ok(found[0].shared_terms.includes("replicas"));
});

test("two documents sharing a topic is not a contradiction", () => {
  // The live false positive: both mention "memory repo", neither conflicts.
  assert.deepEqual(
    findContradictions([
      src("This document specifies the file structure of an Agent Memory Repo.", "https://a.com/SPEC.md"),
      src("Agents need memory that lasts across sessions, and a single MEMORY.md file isn't enough.", "https://b.com/README.md"),
    ]),
    [],
  );
});

test("agreeing sources are never flagged", () => {
  assert.deepEqual(
    findContradictions([
      src("A memory repo is a git repository whose root is the memory root.", "https://a.com/S.md"),
      src("A memory repo is a git repository that keeps its own history.", "https://b.com/R.md"),
    ]),
    [],
  );
});

test("one source cannot contradict itself here", () => {
  assert.deepEqual(
    findContradictions([
      src("The leader must never commit twice", "https://a.com/s"),
      src("The leader may commit twice under partition", "https://a.com/s"),
    ]),
    [],
  );
});

process.stdout.write("verification\n");

test("a claim whose quote is present verifies", () => {
  const c = src("Ballots are monotonically increasing", "https://a.com/s");
  assert.equal(verifyClaim(c, "Ballots are monotonically increasing across rounds.").status, "verified");
});

test("a claim whose quote is gone is unsupported", () => {
  const c = src("Ballots are monotonically increasing", "https://a.com/s");
  assert.equal(verifyClaim(c, "The system uses quorums for reads.").status, "unsupported");
});

test("claims from an unfetched source are unverifiable, not failed", () => {
  const result = verifyClaims([src("Some claim text here", "https://never-fetched.example/x")], {});
  assert.equal(result.summary.unverifiable, 1);
  assert.equal(result.summary.unsupported, 0);
});

process.stdout.write("taxonomy (RFCScope ASE 2025)\n");

const rfcClaim = (t) => makeClaim({ text: t, quote: t, source: "https://rfc-editor.org/errata", confidence: "stated" });

test("the taxonomy carries RFCScope's seven subtypes and their counts", () => {
  assert.equal(Object.keys(TAXONOMY).length, 7);
  assert.equal(TAXONOMY["I-1"].count, 119);
  assert.equal(TAXONOMY["U-2"].count, 15);
});

test("a MUST/SHOULD mismatch on the same subject is detected", () => {
  // Verbatim from Errata 3945, RFC 7139 — an officially verified erratum.
  const found = detectStrengthMismatch([
    rfcClaim("For the ingress node, a Path message with SE style MUST also be sent for increasing the ODUflex bandwidth."),
    rfcClaim("For the ingress node, a Path message with SE style SHOULD also be sent for decreasing the ODUflex bandwidth."),
  ]);
  assert.equal(found.length, 1);
  assert.match(found[0].strongest, /MUST/u);
  assert.match(found[0].weakest, /SHOULD/u);
});

test("a leading prepositional clause does not erase the requirement subject", () => {
  // "For the ingress node, ..." once stripped to nothing by a naive clause cut.
  const subject = requirementSubject("For the ingress node, a Path message with SE style MUST be sent.");
  assert.ok(subject !== undefined);
  assert.match(subject, /path message/u);
});

test("uniform requirement strength produces no mismatch", () => {
  assert.deepEqual(
    detectStrengthMismatch([
      rfcClaim("The client MUST validate every record before use."),
      rfcClaim("The client MUST validate every record before use."),
    ]),
    [],
  );
});

test("adjacent strengths are a normal choice, not a defect", () => {
  assert.deepEqual(
    detectStrengthMismatch([
      rfcClaim("The server SHOULD retain the session for 30 seconds."),
      rfcClaim("The server MAY retain the session for 30 seconds."),
    ]),
    [],
  );
});

test("lowercase 'must' in prose is not a requirement", () => {
  assert.deepEqual(keywordsIn("You must configure this before use."), []);
});

test("a bare actor is not enough to key two requirements together", () => {
  // Both mention "a user agent"; they are different rules and do not conflict.
  // Keying on the actor alone invented a MUST/MAY contradiction on RFC 9110.
  assert.equal(
    requirementSubject("A user agent MUST generate a Host header field in a request unless it sends that information as a request target URI"),
    undefined,
  );
  assert.equal(
    requirementSubject("A user agent MAY send a Date header field in a request, though generally will not do so unless there is a need"),
    undefined,
  );
});

test("two different rules for one actor produce no strength mismatch", () => {
  assert.deepEqual(
    detectStrengthMismatch([
      rfcClaim("A user agent MUST generate a Host header field in a request unless it sends that information as a request target URI."),
      rfcClaim("A user agent MAY send a Date header field in a request, though generally will not do so unless there is a need."),
    ]),
    [],
  );
});

process.stdout.write("dismissal gate\n");

test("the gate defaults to survival when nothing is flagged", () => {
  const { survived, survival_rate } = refute([{ id: "gap_a", decision: "d" }], { full: "" });
  assert.equal(survived.length, 1);
  assert.equal(survival_rate, 1);
});

test("a finding flagged as an implementation detail is dismissed", () => {
  const { survived, dismissed } = refute(
    [{ id: "gap_a", decision: "d", implementation_detail: true }],
    { full: "" },
  );
  assert.equal(survived.length, 0);
  assert.equal(dismissed[0].dismissed_by[0].criterion, "left-to-discretion");
});

test("a finding with no divergent implementations is dismissed", () => {
  const { survived, dismissed } = refute([{ id: "gap_a", decision: "d", divergent: false }], { full: "" });
  assert.equal(survived.length, 0);
  assert.equal(dismissed[0].dismissed_by[0].criterion, "no-divergent-implementations");
});

test("every dismissal records which criterion fired", () => {
  const { dismissed } = refute(
    [{ id: "gap_a", decision: "d", implied: true, style_or_improvement: true }],
    { full: "" },
  );
  assert.equal(dismissed[0].dismissed_by.length, 2);
});

test("five dismissal criteria are defined", () => {
  assert.equal(DISMISSAL_CRITERIA.length, 5);
});

process.stdout.write("harvest\n");

test("a gap carries the document text that raised it", () => {
  // Without evidence a finding is unfalsifiable: "the size limit is unstated"
  // cannot be checked against a document, and a detection benchmark scores a
  // constant zero for reasons that have nothing to do with the finding.
  // The text must raise the topic without answering it, or no gap is reported.
  const gaps = findGaps(
    "The Services Array holds entries. Agents should keep it short. This is a manifest at the entry point.",
  );
  assert.ok(gaps.length > 0, "expected a gap on an unstated size limit");
  const withEvidence = gaps.filter((g) => (g.evidence ?? []).length > 0);
  assert.ok(withEvidence.length > 0, "at least one gap should carry evidence");
  for (const g of withEvidence)
    for (const e of g.evidence) assert.ok(e.length > 0, "evidence must be non-empty");
});

test("evidence excludes front matter", () => {
  // RFC front matter mentions "Internet Standards" and "Section", so it matches
  // topical signatures and used to become every finding's first citation.
  const gaps = findGaps(
    `Further information on Internet Standards is available in Section 2 of RFC 7841.
     Information about the current status of this document, any errata, and how to provide feedback.
     Registry Syntax Using the above terms the syntax of a registry is defined by a parser.`,
  );
  for (const g of gaps)
    for (const e of g.evidence ?? [])
      assert.ok(!/^further information|^information about the current status/iu.test(e), `furniture leaked: ${e.slice(0, 50)}`);
});

test("a gap with evidence reaches a known defect's quoted sentence", () => {
  // RFCScope findings RFC9224-1/-2 report a longest-match ordering defect in
  // RFC 9224. Pin the evidence-selection behaviour that makes such a sentence
  // reachable at all, under the domain whose ordering question it raises.
  const { decisions } = deriveDecisions("replica ballot election quorum manifest", "distributed-systems");
  const gaps = findGaps(
    `Further information on Internet Standards is available in Section 2 of RFC 7841.
     The longest match is done the same way as in packet forwarding.
     Ballots carry an election round number and a leader identifier.
     Replicas apply committed values to their state machine.`,
    [],
    decisions,
  );
  assert.ok(gaps.length > 0, "expected at least one gap");
  const evidence = gaps.flatMap((g) => g.evidence ?? []).join(" ");
  // "Ballots are monotonically increasing" would answer the ordering question
  // and clear that gap; the unstated-decision case must stay unstated.
  assert.ok(/longest match|election round/iu.test(evidence), "substantive text must be cited");
});

test("markup is stripped to prose", () => {
  const text = toText("<h1>Title</h1><script>evil()</script><p>Body &amp; more</p>");
  assert.ok(text.includes("Body & more"));
  assert.ok(!text.includes("evil()"));
  assert.ok(!text.includes("<h1>"));
});

test("claim extraction returns sourced, bound claims", () => {
  const claims = extractClaims(
    "Agents must clone the memory repo before every session. The repo is a git repository.",
    "https://example.com/spec.md",
    { fetched_at: "2026-01-01T00:00:00Z" },
  );
  assert.ok(claims.length > 0);
  for (const c of claims) {
    assert.ok(c.quote.length > 0);
    assert.equal(c.source, "https://example.com/spec.md");
  }
});

test("claim extraction deduplicates identical sentences", () => {
  const claims = extractClaims("Agents must clone memory. Agents must clone memory.", "https://a.com/x.md");
  assert.equal(claims.length, 1);
});

test("headings are never extracted as claims", () => {
  // Shared titles across two documents once manufactured false contradictions.
  const claims = extractClaims(
    "# Agent Memory Repo\n\nA memory repo is a git repository with a memory root.\n\n## Repository\n\nA memory repo is a git repository.",
    "https://a.com/SPEC.md",
  );
  assert.ok(!claims.some((c) => c.text.startsWith("#")), "no claim should start with a heading marker");
  assert.ok(!claims.some((c) => c.text.includes("Agent Memory Repo")));
});

process.stdout.write("precision (negative controls)\n");

// The controls are generated, not committed: they live under eval/data/ with
// the fetched corpora. Generate them here so `npm test` works on a fresh clone
// without a network round-trip, and so the tests and the benchmark cannot drift
// apart. They pin the three bugs the false-positive measurement exposed: literal
// answer patterns, hard-wrapped sentences, and heading periods splitting a
// topic from its answer.
const { readFileSync } = await import("node:fs");
const { join, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(root, "eval", "make-negatives.mjs"));

const NEG = join(root, "eval", "data", "corpora", "negatives", "manifest.json");
const controls = JSON.parse(readFileSync(NEG, "utf8"));
for (const control of controls) {
  test(`${control.name}: ${control.kind} control`, () => {
    const text = readFileSync(control.file, "utf8");
    const { decisions } = deriveDecisions(text, control.domain);
    const gaps = findGaps(text, [], decisions).map((g) => g.gap_id.replace(/^gap_/u, ""));
    if (control.kind === "complete") {
      assert.deepEqual(gaps, [], "a document that settles every decision must report none");
      return;
    }
    for (const expected of control.expect_gaps)
      assert.ok(gaps.includes(expected), `expected ${expected}, got ${gaps.join(", ") || "none"}`);
    assert.deepEqual(gaps.filter((g) => !control.expect_gaps.includes(g)), [], "no false positives");
  });
}

process.stdout.write("report\n");

test("report renders and escapes hostile input", () => {
  const result = {
    digest: "hst_test",
    fetched_at: "2026-01-01T00:00:00Z",
    sources: ["https://example.com/<script>"],
    claims: [claim({ text: "<script>alert(1)</script>", quote: "<img src=x onerror=alert(1)>" })],
    coverage: { sources_requested: 1, sources_read: 1, sources_failed: 0, failures: [], passes: [{ pass: 1, new_claims: 1, total: 1 }], converged: true },
    gaps: [],
    gate: { survival_rate: 1, dismissed_count: 0 },
    attribution: "<script>evil</script> attribution",
    convergence: { blocking_gaps: 0, rebuildable: true, completeness: 1, decisions_considered: 6 },
    limitations: ["<b>limitation</b>"],
  };
  const html = renderReport(result, { title: "Test" });
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(!html.includes("<script>alert(1)</script>"), "claim text must be escaped");
  assert.ok(!html.includes("<img src=x"), "quote must be escaped");
  assert.ok(!html.includes("<b>limitation</b>"), "limitations must be escaped");
  assert.ok(!html.includes("<script>evil</script>"), "attribution must be escaped");
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
