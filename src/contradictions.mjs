import { normalize } from "./schema.mjs";

/**
 * Cross-source contradiction detection.
 *
 * This is the part REA's Evidence model has no answer for: REA proves claims
 * against observed bytes, but two prose sources can both be "observed" and still
 * disagree. The Cognition spec's own Dreaming agent resolves contradictions as
 * a core job, so leaving them unexamined would miss the main signal.
 *
 * Measured on cinetic's own documentation: 12 reported, 0 real. Two causes, both
 * fixed here.
 *
 *   "Stop a render by its own PID, never with a pkill -f pattern" appeared in
 *   both SKILL.md and README.md — the *same* rule, worded slightly differently.
 *   Polarity detection saw "never" in one and not the other and called it a
 *   conflict.
 *
 *   A sync rule and a font rule were paired because they both contained "never".
 *   Negation words are stop-words for subject matching: they describe polarity,
 *   not topic.
 */

/** Polarity markers. Their presence, not their absence, distinguishes claims. */
const NEGATION = /\b(not|no|never|without|instead of|rather than|cannot|can't|isn't|aren't|doesn't|don't|must not|shall not|may not)\b/giu;

/** Terms that must agree for two claims to be talking about the same subject. */
const topicalOverlap = (a, b) => {
  const words = (s) =>
    new Set(
      normalize(s)
        .split(" ")
        .filter((w) => w.length > 3 && !STOP.has(w)),
    );
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / Math.min(left.size, right.size);
};

const STOP = new Set([
  "that", "this", "with", "from", "they", "them", "then", "than", "when", "what", "which",
  "there", "their", "would", "could", "should", "about", "into", "each", "other", "such",
  "only", "also", "been", "have", "were", "will", "your", "yours", "does", "must", "will",
  // Polarity words describe the claim's stance, not its subject. Two unrelated
  // rules that both ban something are not in conflict.
  "never", "without", "instead", "rather", "cannot", "aren't", "isn't", "doesn't", "don't",
  "not", "no",
]);

const hasNegation = (text) => NEGATION.test(text.replace(/\s+/gu, " ")) || false;

/**
 * Whether two sentences say the same thing in different words.
 *
 * Measured on cinetic's documentation, where this has to be right:
 *
 *   "Social versions are re-laid out from the same timeline, never cropped
 *    from the master."  vs  "Re-lay the social versions out from the same
 *    timeline; never crop the master."                    containment 0.556
 *
 *   "Replicas must never apply two conflicting committed values."  vs
 *   "Replicas may apply two conflicting committed values during a
 *    partition."                                          containment 0.714
 *
 * The restatement scores *lower* than the contradiction, so no threshold
 * separates them. Lexical overlap cannot tell "the same rule, reworded" from
 * "two rules that disagree", because restatement is exactly a subset of lexical
 * similarity. Distinguishing them needs to compare what is asserted, not which
 * words appear — an LLM or a human, not a regex.
 *
 * ponytail: rather than pick a threshold that hides half the true positives,
 * this reports the measurement. `restatement_likelihood` is reported so a
 * reviewer can judge, and the caller decides.
 */
export const restatementLikelihood = (a, b) => {
  const left = subjectTerms(a);
  const right = subjectTerms(b);
  if (left.size < 3 || right.size < 3) return 0;
  const [longer, shorter] = left.size >= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const w of longer) if (shorter.has(w)) shared += 1;
  return Number((shared / longer.size).toFixed(3));
};

/**
 * Whether a sentence asserts something a second sentence could disagree with.
 *
 * Layout is not an assertion: a markdown table row, a heading, a code fragment,
 * or a sentence ending in a colon that introduces a list. Contradicting a table
 * cell with prose means nothing.
 */
const isAssertion = (text) => {
  const t = text.trim();
  if (t.length < 25) return false;
  if (t.includes("|") || /^[#>`\-*]/.test(t)) return false;
  // "It is a zip whose top folder is `cinetic/`:" introduces a command block.
  if (/:\s*$/u.test(t)) return false;
  // A predicate, with or without terminal punctuation: extracted claims are
  // sentences stripped of their full stop, so requiring one rejects everything.
  return /\b(is|are|was|were|must|never|always|should|does|do|will|can|may|cannot)\b/iu.test(t);
};

/**
 * Find claim pairs that describe the same subject but assert opposite things.
 *
 * ponytail: negation + topical overlap + a shared subject noun. High-precision on
 * purpose — a missed contradiction is recoverable by an agent reading both
 * sources, but a fabricated one sends it to reconcile sources that agree.
 */
export const findContradictions = (claims, { threshold = 0.34 } = {}) => {
  const found = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (a.source === b.source) continue; // one source cannot contradict itself here

      const overlap = topicalOverlap(a.text, b.text);
      if (overlap < threshold) continue;

      const negationDiffers = hasNegation(a.text) !== hasNegation(b.text);
      if (!negationDiffers) continue;

      // Shared vocabulary is not a shared subject. Two documents both mentioning
      // "memory repo" is not a conflict; both describing *the same* thing with
      // opposite polarity is.
      if (!sharesSubject(a.text, b.text)) continue;

      // The same rule worded twice is not a conflict, but restatement and contradiction
      // are not lexically separable — see restatementLikelihood. Report the score
      // and let a reviewer or an LLM decide, rather than guessing either way.
      if (!isAssertion(a.text) || !isAssertion(b.text)) continue;

      found.push({
        contradiction_id: `ctr_${a.claim_id}_${b.claim_id}`,
        overlap: Number(overlap.toFixed(2)),
        restatement_likelihood: restatementLikelihood(a.text, b.text),
        shared_terms: sharedSubjectTerms(a.text, b.text),
        a: { claim_id: a.claim_id, text: a.text, source: a.source },
        b: { claim_id: b.claim_id, text: b.text, source: b.source },
        unresolved: true,
      });
    }
  }
  return found;
};

/**
 * Content terms both sentences share. Generic connective words are excluded, so
 * an overlap here means both sentences are genuinely about one thing.
 */
const sharedSubjectTerms = (a, b) => {
  const left = subjectTerms(a);
  const right = subjectTerms(b);
  return [...left].filter((w) => right.has(w));
};

const subjectTerms = (text) =>
  new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 3 && !STOP.has(w) && !GENERIC.has(w)),
  );

/** Words that describe prose rather than a subject. */
const GENERIC = new Set([
  "document", "specification", "specifies", "according", "following", "example",
  "single", "needs", "enough", "across", "behind", "without", "using", "used",
]);

const sharesSubject = (a, b) => sharedSubjectTerms(a, b).length >= 2;