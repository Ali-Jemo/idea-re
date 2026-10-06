/**
 * Conservative dismissal gate.
 *
 * Adapted from RFCScope's evaluator prompt (ASE 2025). Their evaluator is told:
 * "you will be extremely conservative and your default behavior will be to
 * REJECT", with five explicit dismissal criteria. That stance is the lesson —
 * their Analyzer emitted 281 candidate reports and only 31 survived, because a
 * false gap sends an implementer chasing a decision the spec already made.
 *
 * Every criterion here is a *dismissal*. A finding must survive all of them.
 */

/** The five criteria, plus the one idea-re adds from its own failure modes. */
export const DISMISSAL_CRITERIA = [
  {
    id: "specified-later",
    question: "Is this actually specified elsewhere in the document?",
    // Their 2.1: "Any reader is expected to read the entire document, and so if
    // the claimed underspecification is specified later in the document, you MUST
    // not report it."
    test: (finding, context) => {
      const rest = stripEvidence(finding, context);
      const marker = finding.evidence?.find?.((m) => context.full.includes(m));
      if (marker === undefined) return false;
      return context.full.slice(context.full.indexOf(marker) + marker.length).includes(finding.id);
    },
  },
  {
    id: "left-to-discretion",
    question: "Is this an implementation detail the spec deliberately leaves open?",
    // Their 2.3: "Many minor implementation details are left to the discretion of
    // the implementer. It is understood that different implementations may use
    // different approaches in such cases and that is okay."
    test: (finding) => finding.implementation_detail === true,
  },
  {
    id: "rhetorical-or-implied",
    question: "Is the answer implied by context rather than stated?",
    // Their 2.2: "Certain things are implied or are simply rhetorical."
    test: (finding) => finding.implied === true,
  },
  {
    id: "out-of-context",
    question: "Is this genuinely in scope, or is it a technical improvement request?",
    // Their 2.5 and the analyzer's 2.5: clarifications, style, and "technical
    // improvements in the protocols themselves" MUST NOT be reported.
    test: (finding) => finding.style_or_improvement === true,
  },
  {
    id: "no-divergent-implementations",
    question: "Can two reasonable implementations actually differ because of this?",
    // RFCScope requires "a concrete example for how the underspecification causes
    // divergent implementations". idea-re adds this because an unstated decision
    // nobody would act on is not worth a rebuild blocker.
    test: (finding) => finding.divergent === false,
  },
];

/**
 * Apply the gate. Returns surviving findings plus what was dismissed and why,
 * because a dismissal you cannot inspect is a finding you cannot trust.
 */
export const refute = (findings, context) => {
  const survived = [];
  const dismissed = [];

  for (const finding of findings) {
    const reasons = [];
    for (const criterion of DISMISSAL_CRITERIA) {
      let hit = false;
      try {
        hit = criterion.test(finding, context) === true;
      } catch {
        // A criterion that cannot be evaluated must not silently pass a finding.
        hit = false;
      }
      if (hit) reasons.push({ criterion: criterion.id, question: criterion.question });
    }

    if (reasons.length === 0) survived.push(finding);
    else
      dismissed.push({
        id: finding.gap_id ?? finding.id,
        decision: finding.decision,
        dismissed_by: reasons,
      });
  }

  return {
    survived,
    dismissed,
    survival_rate: findings.length === 0 ? 1 : survived.length / findings.length,
  };
};

const stripEvidence = (finding, context) => context.full ?? "";

/**
 * Ask the caller to mark a finding before it reaches the gate.
 * idea-re's heuristics cannot know these; the agent reading the source can.
 */
export const FINDING_FLAGS = [
  "implementation_detail",
  "implied",
  "style_or_improvement",
  "divergent",
];