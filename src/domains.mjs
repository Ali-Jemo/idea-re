/**
 * Domain-specific decision classes.
 *
 * ponytail: the first version hardcoded seven decisions tuned on one memory
 * spec and reported zero gaps on a consensus protocol — a detector that only
 * knows one subject is a toy. These classes are selected from what the source
 * actually talks about, so a protocol gets protocol questions and a memory
 * format gets format questions.
 *
 * `answeredWhen` matches the *shape of a commitment*, not specific wording.
 * Literal phrasing scored 0.000 precision on the negative controls: "after two
 * seconds" is an answer that `/after \d+/` rejects, and "MUST ignore any field
 * it does not recognise" is an answer that `/ignore unknown/` rejects. A
 * detector that reports a settled decision as open is worse than one that misses.
 */

/**
 * Commits to a numeric limit, in digits or words: "10,000", "at most 500".
 *
 * Also catches a budget stated in units — "15 words across 33 s", "≤ 5 words",
 * "at most 3 lines". A copy budget is a size limit written as prose, and without
 * this the question "what is the size limit?" was never even asked of documents
 * that answer it plainly.
 */
const numericLimit =
  /(at most|under|maximum|max|no more than|up to|limit(?:ed)? to|cap(?:ped)? (?:at|to)|bounded (?:at|to)|window of|queue of|holds? at)\s+[\d,]+|\b(ten|hundred|thousand|ten thousand|[a-z]+teen)\b(?=[^.]*\b(message|entry|entries|byte|bytes|line|lines|token|tokens|request|requests)\b)|[\d,.]+\s*(words?|characters?|lines?|sentences?|shots?|frames?|seconds?|s\b|px|pt|lufs)\b|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(words?|characters?|lines?|sentences?|shots?|frames?|seconds?)\b/i;

/** Commits to an action with an outcome: "rejects the second push". */
const commitsAction = /\b(when|if|upon|once)\b[^.]{0,80}\b(rejects?|fails?|discards?|drops?|ignores?|returns?|drops|marks?|applies?|excludes?)\b/i;

/** Says what must never happen. */
const prohibits = /\b(must not|shall not|never|cannot|can't|mustn't|no [a-z]+ (?:may|can|shall|must) )\b/i;

/** Commits to a bound, a rule, or an explicit outcome for some case. */
const commits = (s) => commitsAction.test(s) || prohibits.test(s) || numericLimit.test(s);

const byDomain = {
  "distributed-systems": [
    {
      id: "failure-model",
      decision: "What happens when a replica or node fails, and how is that detected?",
      signature: (s) => /replica|node|quorum|leader|failure|fails|crash|partition/i.test(s),
      // A failure model answers by naming the detection and the reaction.
      answeredWhen: (s) =>
        /\b(time[sd]? out|timings? out|detects?|detection|marks? (?:it )?(?:as )?failed|abandon|removes? from (?:the )?(?:quorum|membership)|evict|heartbeat|lease|failover)\b/i.test(s) ||
        commitsAction.test(s),
    },
    {
      id: "safety-invariant",
      decision: "What invariant is preserved under concurrent or adversarial execution?",
      // The signature must match the sentence that *answers* the question, not
      // only the sentence that raises it. "A replica MUST never apply two
      // conflicting committed values" is the invariant, and it does not contain
      // the word "invariant" — scoping the signature to the section heading made
      // this a false positive on every well-specified document.
      signature: (s) =>
        /concurrent|atomic|invariant|agreement|consensus|at most once|exactly once|lineariz|conflict|double|diverg/i.test(s),
      // An invariant is stated as a prohibition or an exclusivity claim.
      answeredWhen: (s) =>
        prohibits.test(s) ||
        /\b(must never|never applies?|only one|at most one|single|the same value|exactly one|unique)\b/i.test(s),
    },
    {
      id: "ordering-semantics",
      decision: "What is the ordering guarantee, and what can a reader observe out of order?",
      signature: (s) => /order|monotonic|sequence|ballot|consistency|lineariz|stale/i.test(s),
      // An ordering guarantee names the guarantee and what a reader may see.
      answeredWhen: (s) =>
        /\b(monotonic(?:ally)? (?:increas|decreas)|total order|lineariz|read.your.writes|read.your.write|in order|sequence numbers? (?:are|increase)|ordered by|not ordered|any order|arbitrary order|stale)\b/i.test(s),
    },
    {
      id: "state-machine-progress",
      decision: "What drives progress, and can the system stall?",
      signature: (s) => /propose|commit|apply|state machine|progress|leader elect/i.test(s),
      // Progress is guaranteed by saying what happens every round.
      answeredWhen: (s) =>
        /\b(every (?:round|term|epoch)|each round|in every|must apply|always applies|eventually|guaranteed|makes progress|continues|keeps (?:making )?progress)\b/i.test(s),
    },
    {
      id: "backpressure-limits",
      decision: "What bounds memory, queue depth, or replay size?",
      signature: (s) => /queue|buffer|window|backpressure|limit|capacity|snapshot/i.test(s),
      answeredWhen: (s) => numericLimit.test(s) || /\b(drops?|discards?|rejects?|spills?)\b/i.test(s),
    },
  ],
  "data-format": [
    {
      id: "parser-edge-cases",
      decision: "How is ambiguous or malformed input parsed?",
      signature: (s) => /pars|format|syntax|delimit|separator|escape|encode|decode/i.test(s),
      // Either the ambiguity is resolved, or malformed input is refused.
      answeredWhen: (s) =>
        /\b(escape|escaped|quoting|quoted|delimit(?:er)?|ambiguit|malformed|invalid|reject(?:ed|s)?|error|not accept|must not|undefined input)\b/i.test(s),
    },
    {
      id: "schema-evolution",
      decision: "How does a consumer handle a field or version it does not know?",
      signature: (s) => /version|field|schema|unknown|forward|backward|compatib/i.test(s),
      // Forward compatibility is an instruction to the consumer.
      answeredWhen: (s) =>
        /\b(ignore[sd]?\b|ignores? any|ignores? unknown|ignores? fields?|ignores? any field|unknown fields? (?:are|is)? (?:permitted|allowed|ignored)|optional|treated as|skipped|not recognised|does not recognise|reserved)\b/i.test(s),
    },
    {
      id: "identity-dedup",
      decision: "What uniquely identifies an entry, and what happens on collision?",
      signature: (s) => /identif|unique|duplicate|dedup|key|id\b|same as/i.test(s),
      answeredWhen: (s) =>
        /\b(unique|uniquely|identical|must be|is the identifier|identifies|collision|duplicate|dedup|same .+ (?:is|are) (?:the )?(?:same|one)|rejects? the)\b/i.test(s),
    },
    {
      id: "size-budget",
      decision: "What is the size limit of an entry point or index, and what happens past it?",
      signature: (s) => /keep it short|entry point|index|manifest|root|limit|maximum/i.test(s),
      answeredWhen: (s) => numericLimit.test(s) || /\b(must not exceed|too large|rejects? writes|compacted|until)\b/i.test(s),
    },
    {
      id: "canonical-representation",
      decision: "Is there one canonical byte form, and how is it compared?",
      signature: (s) => /canonical|normaliz|compare|sort|order|byte/i.test(s),
      answeredWhen: (s) =>
        /\b(canonical|normalis|normaliz|byte order|lexicograph|compar(?:e|ed|ing) (?:in|by|using)|sorted? by|are the same)\b/i.test(s),
    },
  ],
  "agent-protocol": [
    {
      id: "concurrency-conflict",
      decision: "When two actors write the same location, what resolves it?",
      signature: (s) => /agent|swarm|parallel|concurrent|same (line|file|entry)|conflict|merge/i.test(s),
      answeredWhen: (s) => commitsAction.test(s) || /\b(last.write|wins?|rejects?|conflict|version control|merge)\b/i.test(s),
    },
    {
      id: "provenance-attribution",
      decision: "Who authored a claim, and how is that tracked?",
      signature: (s) => /source|author|wrote|who said|attribut|owner/i.test(s),
      answeredWhen: (s) =>
        /\b(tracks? who|records? (?:the )?(?:author|who|source)|who (?:said|wrote|owns)|ownership|attribut|source link|source:|to the right repo|author(?:ed)? by)\b/i.test(s),
    },
    {
      id: "contradiction-policy",
      decision: "When two entries disagree, which survives and why?",
      signature: (s) => /contradict|outdated|stale|conflicting|supersede|merge duplicates/i.test(s),
      answeredWhen: (s) =>
        /\b(wins?|newer|oldest|precedence|supersede|last.write|most recent|takes? precedence)\b/i.test(s),
    },
    {
      id: "retrieval-scope",
      decision: "What is loaded into context, and what is deliberately left out?",
      signature: (s) => /load|context|session|index|entry point|start of every/i.test(s),
      answeredWhen: (s) =>
        /\b(at the start|every session|loads?|only (?:what|those|the)|follows? links? only|as the task requires|index)\b/i.test(s),
    },
    {
      id: "scheduling-trigger",
      decision: "What triggers the background or periodic work?",
      signature: (s) => /periodic|schedule|dreaming|cron|interval|background|automatically/i.test(s),
      answeredWhen: (s) =>
        /\b(periodically|every \w+|(?:once|twice) per|on \w+ day|at the start|trigger(?:ed)? (?:by|when)|runs? on)\b/i.test(s),
    },
    {
      id: "link-graph-semantics",
      decision: "What does a link between entries resolve to, and what if the target is missing?",
      signature: (s) => /\[\[|cross-link|wikilink|link to|follows? the link|folder/i.test(s),
      answeredWhen: (s) =>
        /\b(link(?:s|ed|ing)? (?:to|with|are|is)|follows? (?:a|the) link|missing|absent|ignored|dangling|resolv)\b/i.test(s),
    },
    {
      id: "entry-size-budget",
      decision: "What is the size limit of the entry point, and what happens when it is exceeded?",
      signature: (s) => /keep it short|entry point|MEMORY\.md|every session|load/i.test(s),
      answeredWhen: (s) => numericLimit.test(s) || /\b(must not exceed|compacted|rejects? writes)\b/i.test(s),
    },
  ],
};

/**
 * Generic fallback for a source that matches no domain confidently.
 *
 * Duplicated from ./adversary.mjs rather than imported, so the domain selector
 * does not depend on the module that already imports it.
 */
const GENERIC_DECISIONS = [
  {
    id: "conflict-resolution",
    decision: "When two writers change the same thing, what exactly happens?",
    signature: (s) => /conflict|merge|reject|concurrent|parallel/i.test(s),
    answeredWhen: commits,
  },
  {
    id: "entry-parsing",
    decision: "How is an entry with ambiguous or delimiter-bearing input parsed?",
    signature: (s) => /metadata|\[source:|key: value|delimit|separator/i.test(s),
    answeredWhen: (s) => /\b(escape|escaped|quoted|quoting|malformed|invalid|reject|error)\b/i.test(s),
  },
  {
    id: "contradiction-handling",
    decision: "When two statements disagree, which wins and on what basis?",
    // `conflict` bare, not just its participles. cinetic states the rule as
    // "Brand guidelines that conflict with a rule here: follow the guidelines",
    // and the signature missed the sentence that answers the question.
    signature: (s) => /contradict|conflict|conflicting|outdated|merge duplicates|stale|disagree|overrid/i.test(s),
    answeredWhen: (s) =>
      /\b(wins?|follow the (?:guidelines|brand|supplied)|takes precedence|precedence|supersede|last[- ]write|newer (?:entry|wins)|overrides?)\b/i.test(s),
  },
  {
    id: "scheduling-trigger",
    decision: "What triggers the background or periodic work?",
    signature: (s) => /periodic|schedule|dreaming|cron|interval|automatically/i.test(s),
    answeredWhen: (s) => /\b(periodically|every \w+|on \w+ day|at the start|trigger|runs? on)\b/i.test(s),
  },
  {
id: "size-budget",
    decision: "What is the size limit of a stored unit, and what happens when it is exceeded?",
    // The topic word is "budget", not "limit". cinetic sets a copy budget
    // ("Tessel's statements total 15 words across 33 s", "It has ≤ 5 words",
    // a per-format word table) and none of that raised this question, so the
    // gap was reported as unstated when the document states it explicitly.
    signature: (s) =>
      /keep it short|entry point|MEMORY\.md|manifest|root|limit|maximum|budget|per (?:line|shot|film|frame)|word count|words? in the film|characters? per|sentence count|entry limit|\b(?:words?|characters?|lines?|sentences?|shots?|frames?)\b(?=\s+(?:in|across|per|for|on)\b|\s*\d)/i.test(s),
    answeredWhen: (s) => numericLimit.test(s) || /\b(must not exceed|compacted|rejects? writes|at most|at least|or under|no more than)\b/i.test(s),
  },
  {
    id: "identity-provenance",
    decision: "Who authored a claim, and how is authorship tracked?",
    signature: (s) => /who (said|owns)|ownership|whose memory|author|source:/i.test(s),
    answeredWhen: (s) => /\b(tracks? who|records? (?:the )?author|who (?:said|wrote|owns)|ownership|attribut|source:)\b/i.test(s),
  },
];

/**
 * Discard boilerplate before scoring.
 *
 * Measured: OAuth (RFC 6749) classified as data-format purely on front matter —
 * "Copyright Notice", "Further information on Internet Standards", "Request for
 * Comments: 6749" — matching the parser, identity and size signatures 247 times
 * between them. Table-of-contents lines matched too, because a title row ends in
 * a period.
 *
 * The table of contents was the larger problem: 15 of 19 benchmark excerpts were
 * a TOC rather than prose, so every domain result — heuristic and Julia both —
 * was computed on section titles. A TOC carries no argument, so it can only
 * match on vocabulary, which is exactly the failure mode under test.
 */
const TOC_LINE = /^\s*(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][^\n]{3,60}(?:\s*\.{2,}.*|\s*\d+\s*)?$/u;

export const stripBoilerplate = (prose) => {
  const text = String(prose).replace(/\r\n/gu, "\n");
  const lines = text.split("\n");

  // Metadata rows first: a title page has no argument either.
  const metadata = /^\s*(Request for Comments|Internet-Draft|Obsoletes|Expires|Copyright Notice|Category|ISSN|STD|Updates)/iu;
  const kept = lines.filter((line) => !metadata.test(line));

  // Drop a leading table of contents: a contiguous run of short title-like rows
  // before the first long prose paragraph.
  let index = 0;
  let run = 0;
  while (index < kept.length && run < 120) {
    const line = kept[index];
    const long = line.trim().length > 90;
    if (!long && TOC_LINE.test(line) && line.trim().length > 3) run += 1;
    else if (line.trim().length > 0) break;
    index += 1;
  }
  const body = run >= 4 ? kept.slice(index) : kept;
  return body
    .filter((line) => !/^\s*\S[^.]{0,60}\.{3,}\s*\d*\s*$/u.test(line))
    .join("\n");
};

/**
 * Score each domain by how much of its vocabulary the source uses as a
 * requirement — but a format specification mostly *describes* rather than
 * *requires*. Requiring normative keywords to recognise a format spec scored
 * data-format 0/6: JSON, CBOR, and structured fields all describe their own
 * syntax ("this format has a header") instead of mandating behaviour.
 *
 * So the demand fraction scales a topic's weight without gating it. A topic that
 * discusses its subject repeatedly is present, whatever its mood; a topic raised
 * once and never required is noise.
 */
const REQUIREMENT_SHAPE =
  /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|REQUIRED|MAY|OPTIONAL|must not|must|shall not|shall|should not|should|may not|may|is required to|are required to|needs? to|has to|have to)\b/u;

const scoreDomains = (rawProse) => {
  // Collapse runs of whitespace first. A multi-line template literal in a test
  // and a wrapped line in an RFC must score identically.
  const prose = stripBoilerplate(String(rawProse).replace(/\s+/gu, " "));
  const sentences = prose.split(/(?<=[.!?])\s+/u).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return {};

  const scores = {};
  for (const [domain, decisions] of Object.entries(byDomain)) {
    let score = 0;
    for (const decision of decisions) {
      const topical = sentences.filter((s) => decision.signature(s));
      // Two mentions: one stray keyword is not a domain.
      if (topical.length < 2) continue;
      const demanding = topical.filter((s) => REQUIREMENT_SHAPE.test(s)).length;
      // Weight ranges 1.0 to 2.0, so a descriptive-but-frequent topic reaches
      // the majority threshold that a pure protocol spec clears on demand alone.
      score += 1 + demanding / topical.length;
    }
    if (score > 0) scores[domain] = Number(score.toFixed(3));
  }
  return scores;
};

/**
 * Choose the decision classes that apply to this source.
 *
 * `forced` lets a caller override the guess when it knows the domain — an agent
 * reading the source usually does.
 */
export const deriveDecisions = (prose, forced) => {
  if (forced !== undefined) {
    // `generic` is a real outcome of classification, so it must be a real
    // override target. It was returned here but absent from byDomain, so
    // `--domain generic` threw and DOMAINS omitted it.
    if (forced === "generic") return { domain: "generic", decisions: GENERIC_DECISIONS, scores: {} };
    const decisions = byDomain[forced];
    if (decisions === undefined)
      throw new Error(`Unknown domain: ${forced}. Known: ${[...Object.keys(byDomain), "generic"].join(", ")}`);
    return { domain: forced, decisions, scores: {} };
  }
  const scores = scoreDomains(prose);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { domain: "generic", decisions: GENERIC_DECISIONS, scores };

  const [top, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  // Two topics clear the bar; a clear lead confirms it.
  //
  // Measured on 19 specifications: a real format spec (JSON, CBOR, structured
  // fields) discusses only 2-4 of the 5 data-format decision topics, scoring
  // 1.2-2.2. The old `ceil(5/2) = 3` rejected every one and data-format scored
  // 0/6. Raft clears 3.0, so the threshold was excluding documents that plainly
  // belonged.
  //
  // The lead does the real work. Across the benchmark every correct decision
  // cleared its runner-up by at least 1.0, and every wrong one sat at 0.6 or
  // below — OAuth lands at 0.56 and is genuinely ambiguous. A 0.8 margin splits
  // them, and anything closer declines to `generic`.
  if (topScore < 2 || topScore - runnerUp < 0.8)
    return { domain: "generic", decisions: GENERIC_DECISIONS, scores };

  return { domain: top, decisions: byDomain[top], scores };
};

/** Every selectable lens, including the fallback that classification can return. */
export const DOMAINS = [...Object.keys(byDomain), "generic"];