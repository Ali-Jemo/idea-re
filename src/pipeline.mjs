import { harvest } from "./harvest.mjs";
import { findGaps, convergence } from "./adversary.mjs";
import { deriveDecisions, DOMAINS } from "./domains.mjs";
import { findContradictions } from "./contradictions.mjs";
import { verifyClaims } from "./verify.mjs";
import { detectStrengthMismatch, classifyFinding, TAXONOMY, taxonomyNote, MEASURED } from "./taxonomy.mjs";
import { refute } from "./refute.mjs";

/**
 * Idea reconstruction pipeline.
 *
 * The adversarial test is the point: rather than summarizing what a source says,
 * we ask which implementation decisions it leaves open. That is the question
 * "can we rebuild this?" actually turns on.
 *
 * Sources are read exactly once. Every stage downstream works from the prose
 * that harvest captured, so a page changing mid-run cannot make two stages
 * disagree about what they saw.
 */
export const analyzeIdea = async (targets, options = {}) => {
  const harvested = await harvest(targets, options);

  // The adversarial pass needs raw prose, not just extracted claims: a spec can
  // leave a decision open while never stating a claim about it.
  const combined = harvested.combined;
  // Decision classes come from the source's own domain, so a consensus protocol
  // is not measured against memory-format questions.
  const { domain, decisions } = deriveDecisions(combined, options.domain);
  const gaps = findGaps(combined, harvested.claims, decisions);
  const verification = verifyClaims(harvested.claims, harvested.prose);

  // RFCScope's finding: a spec that mandates one path and merely recommends
  // another is an inconsistency, not an underspecification. Different failure.
  const strength = detectStrengthMismatch(harvested.claims);
  for (const mismatch of strength)
    mismatch.gap_id = "I-1-strength-mismatch";

  // Every finding gets a subtype, so "what kind of problem is this?" is
  // answerable. Measured accuracy on 239 verified findings: the underspecification
  // classes reach precision 1.00, while I-1/I-2/I-3 are not lexically separable
  // and are reported as the "I" family rather than guessed.
  const findings = [...gaps, ...strength].map((g) => {
    const detected = g.subtype ?? classifyFinding(g);
    return {
      ...g,
      subtype: detected,
      subtype_label: TAXONOMY[detected]?.label ?? "unknown",
      subtype_confidence: g.subtype ? "measured" : MEASURED.subtype_confidence(detected),
    };
  });

  // RFCScope's evaluator posture: extremely conservative, default REJECT.
  // idea-re's own heuristics cannot know the dismissal flags, so an unflagged
  // finding survives; an agent marks flags on the findings it reviews.
  const gate = refute(findings, { full: combined });

  const score = convergence(gate.survived, decisions.length);

  return {
    schema: "idea_reconstruction",
    version: 4,
    digest: harvested.digest,
    fetched_at: harvested.fetched_at,
    domain,
    available_domains: DOMAINS,
    sources: Object.keys(harvested.prose),
    claims: harvested.claims,
    coverage: harvested.coverage,
    verification: verification.summary,
    verification_results: verification.results,
    gaps: gate.survived,
    findings,
    dismissed: gate.dismissed,
    gate: { survival_rate: Number(gate.survival_rate.toFixed(2)), dismissed_count: gate.dismissed.length },
    contradictions: findContradictions(harvested.claims),
    convergence: score,
    decisions_examined: decisions.map((d) => d.id),
    taxonomy: Object.values(TAXONOMY),
    attribution: taxonomyNote,
    limitations: [
      "Claims are extracted heuristically; an agent should supply its own for accuracy.",
      "Claim verification is substring matching over prose, not a byte digest, so it cannot detect a rewritten page.",
      "Gap detection is sentence-level matching, not semantic analysis; it finds unstated decisions, not wrong ones.",
      "Decision classes are chosen by domain keyword match; an unusual idea may fall back to the generic set.",
      "The dismissal gate needs flags idea-re cannot infer (implementation_detail, implied, style_or_improvement, divergent); without them everything survives.",
      "Subtypes are heuristic approximations of the RFCScope taxonomy, not a validated classifier.",
      "A 'rebuildable' verdict means no blocking decision was left unstated, not that the idea is proven correct.",
    ],
  };
};