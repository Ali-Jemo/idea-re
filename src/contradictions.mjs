import { normalize } from "./schema.mjs";

/**
 * Cross-source contradiction detection.
 *
 * This is the part REA's Evidence model has no answer for: REA proves claims
 * against observed bytes, but two prose sources can both be "observed" and still
 * disagree. The Cognition spec's own Dreaming agent resolves contradictions as
 * a core job, so leaving them unexamined would miss the main signal.
 */

const NEGATION = /\b(not|no|never|without|instead of|rather than|cannot|can't|isn't|aren't|doesn't|don't)\b/giu;

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
]);

const hasNegation = (text) => NEGATION.test(text.replace(/\s+/gu, " ")) || false;

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

      found.push({
        contradiction_id: `ctr_${a.claim_id}_${b.claim_id}`,
        overlap: Number(overlap.toFixed(2)),
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