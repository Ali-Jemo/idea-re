/**
 * Ambiguity taxonomy.
 *
 * Adapted from RFCScope (Pawagi et al., ASE 2025), which derived these seven
 * subtypes by manually categorising 273 verified technical errata from IETF
 * Standards Track RFCs, 2014-2025. Counts are theirs.
 *
 *     DOI: 10.1109/ASE63991.2025.00106   https://github.com/HIPREL-Group/RFCScope
 *
 * Why borrow it: one "blocking gap" bucket cannot distinguish "the spec says two
 * contradictory things" from "the spec never says". They fail differently, and a
 * re-implementer needs to know which one it is.
 */

export const INCONSISTENCY = {
  "I-1": {
    id: "I-1",
    kind: "inconsistency",
    label: "Direct inconsistency",
    definition: "Two statements in the same document contradict each other outright.",
    count: 119,
  },
  "I-2": {
    id: "I-2",
    kind: "inconsistency",
    label: "Indirect inconsistency",
    definition: "Statements agree in isolation but imply different behaviour when combined.",
    count: 70,
  },
  "I-3": {
    id: "I-3",
    kind: "inconsistency",
    label: "Inconsistency with accepted knowledge",
    definition: "The spec contradicts established practice outside the document.",
    count: 13,
  },
};

export const UNDER_SPECIFICATION = {
  "U-1": {
    id: "U-1",
    kind: "under-specification",
    label: "Undefined term",
    definition: "A term is used without being defined, or is ambiguous in context.",
    count: 7,
  },
  "U-2": {
    id: "U-2",
    kind: "under-specification",
    label: "Incomplete constraint",
    definition: "A constraint is missing and can only be resolved by asking the authors.",
    count: 15,
  },
  "U-3": {
    id: "U-3",
    kind: "under-specification",
    label: "Indirect under-specification",
    definition: "Each part is fine alone, but together they leave a case uncovered.",
    count: 10,
  },
  "U-4": {
    id: "U-4",
    kind: "under-specification",
    label: "Missing or wrong reference",
    definition: "A referenced term, section, or document does not exist or does not support the claim.",
    count: 5,
  },
};

export const TAXONOMY = { ...INCONSISTENCY, ...UNDER_SPECIFICATION };

/**
 * RFC 2119 requirement strength, in RFCScope's terms: they flagged a SHOULD/MUST
 * mismatch as I-1 because the weaker keyword "leaves room for non-compliant
 * implementations" (Errata 3945, RFC 7139).
 */
export const STRENGTH = ["MUST", "MUST NOT", "REQUIRED", "SHALL", "SHOULD", "MAY", "OPTIONAL"];

const strengthRank = (keyword) => {
  const index = STRENGTH.indexOf(keyword);
  // MUST NOT is stronger than MUST for prohibitions; rank it alongside MUST.
  return index === -1 ? -1 : index === 1 ? 0 : index === 2 ? 0 : index - 1;
};

/**
 * Find every normative keyword in a sentence, strongest first.
 * ponytail: uppercase run detection. Deliberately narrow — a lowercase "must"
 * in prose is not a requirement, and treating it as one invents contradictions.
 */
export const keywordsIn = (text) => {
  const found = [];
  for (const match of text.matchAll(/\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED|SHOULD NOT|SHOULD|MAY|OPTIONAL)\b/gu)) {
    found.push(match[1]);
  }
  return found;
};

/**
 * The thing a requirement applies to, with the action stripped off.
 *
 * "…a Path message with SE style MUST be sent for increasing…"
 * "…a Path message with SE style SHOULD be sent for decreasing…"
 * both key on "path message with se style". Keying on the whole sentence instead
 * misses every real mismatch, because the two statements always differ at the tail.
 */
// Anchored on the first action verb so it strips the tail, not a substring.
// `send` must not match inside "ingress", hence the leading boundary plus the
// alternation order putting longer forms first.
const ACTION_TAIL = /\b(be sent|is sent|was sent|are sent|sent|send|received|receive|accepted|accept|used|use|returned|return|processed|process|emitted|emit|generated|generate|performed|perform)\b[\s\S]*$/iu;

export const requirementSubject = (text) => {
  const without = text.replace(KEYWORD_PATTERN, " ");
  const trimmedAction = without.replace(ACTION_TAIL, " ");
  // Drop a trailing conditional clause, but only when the sentence already has
  // a subject. "For the ingress node, a Path message…" must keep "ingress node";
  // anchoring the strip after some words stops a leading "For" from eating it all.
  const subject = trimmedAction
    .replace(/(\b[a-z0-9]{3,}\b[^\s]*.*?)\b(for|when|if|while|during|in the case of|after|before)\b[\s\S]*$/iu, "$1")
    .replace(/[^a-z0-9 ]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

  const words = subject.split(" ").filter(Boolean);
  // A bare actor ("a user agent", "an origin server") is named by every rule in
  // the document. Two requirements that differ only in their object — Host header
  // vs Date header — are not a contradiction, so an actor alone must not key them.
  const hasObject = words.some((w, i) => i >= 2 && w.length > 4 && !ACTOR_ONLY.has(w));
  if (words.length < 3 || !hasObject) return undefined;
  return subject;
};

/** Words that end an actor phrase; everything after one of these is the object. */
const ACTOR_ONLY = new Set([
  "agent", "server", "client", "sender", "receiver", "recipient", "node",
  "replica", "leader", "proxy", "gateway", "host", "user", "service",
]);

const KEYWORD_PATTERN = /\b(MUST NOT|SHALL NOT|SHOULD NOT|MUST|SHALL|REQUIRED|SHOULD|MAY|OPTIONAL)\b/gu;

/**
 * Detect a requirement-strength mismatch across related statements.
 * Errata 3945 (RFC 7139): increase mandates MUST, decrease says SHOULD.
 */
export const detectStrengthMismatch = (claims) => {
  const bySubject = new Map();
  for (const claim of claims) {
    const keywords = keywordsIn(claim.text);
    if (keywords.length !== 1) continue; // mixed strength in one sentence is its own thing

    const subject = requirementSubject(claim.text);
    if (subject === undefined) continue;
    const existing = bySubject.get(subject);
    if (existing === undefined) bySubject.set(subject, { subject, uses: [claim] });
    else existing.uses.push(claim);
  }

  const mismatches = [];
  for (const { subject, uses } of bySubject.values()) {
    if (uses.length < 2) continue;
    const ranks = uses.map((c) => ({ rank: strengthRank(keywordsIn(c.text)[0]), claim: c }));
    const strongest = Math.min(...ranks.map((r) => r.rank));
    const weakest = Math.max(...ranks.map((r) => r.rank));
    if (weakest - strongest < 2) continue; // adjacent strengths are a normal choice
    mismatches.push({
      subject,
      strongest: ranks.find((r) => r.rank === strongest).claim.text,
      weakest: ranks.find((r) => r.rank === weakest).claim.text,
      // Evidence: both statements, so a reviewer can check the claim directly.
      evidence: [ranks.find((r) => r.rank === weakest).claim.text, ranks.find((r) => r.rank === strongest).claim.text],
      decision: `Requirement strength differs for "${subject}": one statement is weaker than its parallel.`,
      why_it_matters: "A weaker keyword leaves room for a non-compliant implementation the spec intended to forbid.",
      topic: subject,
      severity: "blocking",
    });
  }
  return mismatches;
};

/**
 * Classify a finding. idea-re historically reported every unstated decision as
 * one kind of thing; RFCScope's split says whether the spec *contradicts itself*
 * or merely *fails to speak*.
 */
export const classifyFinding = (gap) => {
  if (gap.detected_by === "strength-mismatch") return "I-1";
  // A decision with related claims that contradict each other is indirect.
  if ((gap.related_claims?.length ?? 0) > 1) return "I-2";
  return "U-2";
};

/**
 * Confidence in a heuristically assigned subtype, from the measured evaluation.
 *
 * The underspecification classes were separable; the three inconsistency classes
 * were not. Reporting that here stops a caller reading a subtype as a verdict.
 */
export const MEASURED = {
  corpus: "RFCScope studied-errata",
  findings: 239,
  rfc_documents: 144,
  subtype_confidence: (id) =>
    id === "I-1" || id === "I-2" || id === "I-3"
      ? "low — these three classes are not lexically separable; measured 0.00 accuracy"
      : "moderate — precision 1.00 on 239 verified findings",
};

export const taxonomyNote =
  "Subtypes follow RFCScope (ASE 2025), derived from 273 verified IETF errata. " +
  "See DOI 10.1109/ASE63991.2025.00106.";