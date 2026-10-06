/**
 * Adversarial reconstruction: instead of reviewing an idea's prose for holes,
 * try to BUILD it and report where the specification stops being sufficient.
 *
 * A text review finds opinions. An implementation attempt finds the questions
 * you must answer before any two implementations would agree — which is exactly
 * what "can we rebuild this?" means.
 */

import { deriveDecisions } from "./domains.mjs";

/**
 * Generic decision classes, used when no domain matches confidently.
 *
 * Lives here, not in ./domains.mjs, so the domain selector can import it without
 * a cycle: adversary -> domains -> adversary.
 *
 * ponytail: deliberately broad. Domain sets are sharper; this only has to catch
 * a source we could not classify without reporting nothing.
 */
export const IMPLEMENTATION_DECISIONS = [
  {
    id: "conflict-resolution",
    decision: "When two writers change the same thing, what exactly happens?",
    why_it_matters: "Determines whether the design is safe under concurrency.",
    signature: (s) => /conflict|merge|reject|concurrent|parallel/i.test(s),
    answeredWhen: (s) => /rejects? the second|git (rejects|surfaces)|fails? to push|last.write|wins/i.test(s),
  },
  {
    id: "entry-parsing",
    decision: "How is an entry with ambiguous or delimiter-bearing input parsed?",
    why_it_matters: "A parser edge case that silently corrupts data.",
    signature: (s) => /metadata|\[source:|key: value|delimit|separator/i.test(s),
    answeredWhen: (s) => /escape|quote|when a value contains|malformed|reject/i.test(s),
  },
  {
    id: "contradiction-handling",
    decision: "When two statements disagree, which wins and on what basis?",
    why_it_matters: "Determines whether stored knowledge stays coherent.",
    signature: (s) => /contradict|outdated|conflicting|merge duplicates|stale/i.test(s),
    answeredWhen: (s) => /\bwins\b|\bnewer\b|\boldest\b|precedence|supersede|last[- ]write/i.test(s),
  },
  {
    id: "scheduling-trigger",
    decision: "What triggers the background or periodic work?",
    why_it_matters: "An unspecified schedule is an unspecified implementation.",
    signature: (s) => /periodic|schedule|dreaming|cron|interval|automatically/i.test(s),
    answeredWhen: (s) => /at the start of every session|every session|periodically|runs? periodically|every \d+/i.test(s),
  },
  {
    id: "size-budget",
    decision: "What is the size limit of a stored unit, and what happens when it is exceeded?",
    why_it_matters: "Loading is a hard context budget.",
    signature: (s) => /keep it short|entry point|MEMORY\.md|manifest|index/i.test(s),
    answeredWhen: (s) => /(at most|under|maximum|max)\s+\d+\s*(kb|tokens|lines|entries|bytes)?/i.test(s),
  },
  {
    id: "identity-provenance",
    decision: "Who authored a claim, and how is authorship tracked?",
    why_it_matters: "Required to route knowledge to the right owner.",
    signature: (s) => /who (said|owns)|ownership|whose memory|author|source:/i.test(s),
    answeredWhen: (s) => /tracks? who said what|who (said|owns)|ownership, permissions|source/i.test(s),
  },
];

/**
 * Find decisions the source touches but never actually settles.
 * A spec that discusses a topic without answering it scores as a gap.
 *
 * `decisions` defaults to the domain derived from the source text; pass an
 * explicit set to force a domain.
 *
 * Each gap carries the sentences that put the decision on the table. Without
 * them a finding is unfalsifiable: "the size limit is unstated" cannot be
 * checked against the document without knowing which text raised it, and a
 * detection benchmark scores a constant zero.
 */
export const findGaps = (sourceText, claims = [], decisions) => {
  const text = sourceText;
  const applicable = decisions ?? deriveDecisions(text).decisions;
  const gaps = [];

  // Fenced blocks are worked examples, not specification.
  const prose = text.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`]*`/gu, " ");
  const sentences = sentencesOf(prose);

  for (const decision of applicable) {
    if (!decision.signature(text)) continue;

    const contextual = sentences.filter((s) => decision.signature(s));
    if (hasAnswer(decision, text)) continue;

    gaps.push({
      gap_id: `gap_${decision.id}`,
      decision: decision.decision,
      why_it_matters: decision.why_it_matters ?? "An implementer would have to choose arbitrarily.",
      topic: topicFor(decision),
      // The evidence: what in the document raised this decision.
      evidence: evidenceFor(contextual),
      related_claims: claims
        .filter((c) => decision.signature(c.text))
        .map((c) => c.claim_id)
        .slice(0, 3),
      severity: "blocking",
    });
  }
  return gaps;
};

/**
 * An answer exists when the spec commits to an outcome, not merely to a topic.
 *
 * ponytail: sentence-level matching, not NLP. Fenced blocks and inline code are
 * stripped first: worked examples show usage, they do not specify behavior, and
 * counting them as answers hides exactly the gaps worth finding.
 */
const hasAnswer = (decision, text) => {
  // Fenced blocks and inline code are stripped first: worked examples show
  // usage, they do not specify behavior, and counting them as answers hides
  // exactly the gaps worth finding.
  const prose = text.replace(/```[\s\S]*?```/gu, " ").replace(/`[^`]*`/gu, " ");
  const sentences = sentencesOf(prose);
  const topical = sentences.filter((s) => decision.signature(s));

  if (topical.length === 0) return true; // never discussed => not a gap

  return topical.some((sentence) => decision.answeredWhen(sentence));
};

/**
 * Split into sentences, then re-join a fragment that is only a label.
 *
 * "Parsing." and "A malformed record MUST be rejected." are one specification
 * sentence split at the heading's period. Scoring them apart makes the topic and
 * its answer land in different fragments, so a settled decision reads as open.
 */
const sentencesOf = (prose) => {
  const raw = prose.split(/(?<=[.!?])\s+/u).map((s) => s.replace(/\s+/gu, " ").trim()).filter(Boolean);
  const joined = [];
  for (let i = 0; i < raw.length; i += 1) {
    const current = raw[i];
    // A fragment of a few words followed by another sentence is a label.
    if (current.split(" ").length <= 3 && i + 1 < raw.length) {
      joined.push(`${current} ${raw[i + 1]}`);
      i += 1;
      continue;
    }
    joined.push(current);
  }
  return joined;
};

/** Unanswered questions are only meaningful where the idea was actually discussed. */
// Front matter and page furniture read as topical because they mention
// "Internet Standards", "Section", and "Registry" — and sorting by original
// position puts them first, so every finding opened with boilerplate.
const isFurniture = (s) =>
  /^\s*(further information|information about the current status|request for comments|copyright|abstract|table of contents|obsoletes|expires|category|issn)\b/iu.test(s);

/** Evidence sentences, substantive first: the text that raised the decision. */
const evidenceFor = (contextual) =>
  [...contextual]
    .filter((s) => !isFurniture(s))
    .sort((a, b) => b.length - a.length) // a longer sentence carries more of the topic
    .slice(0, 3)
    .map((s) => s.trim());

/**
 * The sentences that put a decision on the table, so a reviewer can see why it
 * was flagged instead of taking the verdict on faith.
 */
const topicFor = (decision) => {
  return decision.topic_hint ?? decision.id.replace(/-/gu, " ");
};

/**
 * Score against the decisions that actually applied.
 *
 * `total` is the number of decision classes considered for this source, not a
 * global constant: scoring a 5-decision protocol against a 7-decision memory
 * set would penalize a spec for topics it never claimed to cover.
 */
export const convergence = (gaps, total = IMPLEMENTATION_DECISIONS.length) => {
  const blocking = gaps.filter((g) => g.severity === "blocking").length;
  return {
    blocking_gaps: blocking,
    decisions_considered: total,
    // Specs with 0 blocking gaps are re-buildable; each one is a decision a
    // reimplementer would have to invent, which is the real risk.
    rebuildable: blocking === 0,
    completeness: total === 0 ? 1 : Math.max(0, 1 - blocking / total),
  };
};
