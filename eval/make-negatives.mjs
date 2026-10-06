#!/usr/bin/env node
/**
 * Negative controls for the false-positive rate.
 *
 * idea-re reports decisions a document leaves unstated. A false gap sends an
 * implementer after a decision the spec already made, so precision matters more
 * than recall — and recall benchmarks cannot measure it, because they only score
 * documents known to contain defects.
 *
 * Two control kinds, both verifiable:
 *
 *   "complete"  a document that explicitly settles every decision in its
 *               domain. Any finding here is a false positive by construction.
 *   "partial"   a document that settles most decisions and leaves one open.
 *               Locates which decision class causes the miss.
 *
 * Real RFCs cannot serve as controls: "no errata" is not "no ambiguity", and the
 * errata search is not machine-readable. These are written so the correct answer
 * is known.
 */

const COMPLETE_DISTRIBUTED = `
# Replicated Log Protocol

A proposer broadcasts a PREPARE message to all replicas. A replica only accepts
a value after it receives PREPARE from a majority of replicas. The leader sends
COMMIT and replicas apply the value to their state machine.

Failure model. If a replica stops responding, the others time out after two
seconds and mark it failed. A failed replica is never contacted again.

Safety invariant. A replica MUST never apply two conflicting committed values.
Concurrent execution is rejected by the majority rule: only a value with PREPARE
from a majority is committed.

Ordering semantics. Entries carry monotonically increasing sequence numbers. A
reader observes entries in sequence order, and a session guarantees
read-your-writes.

Progress. Every round, the leader sends COMMIT to all replicas. A replica MUST
apply every committed value it receives. Progress is guaranteed as long as a
majority of replicas are reachable.

Backpressure limits. Each replica MUST hold at most 10,000 uncommitted messages
in its queue. A replica that reaches the limit drops the oldest uncommitted
message and MUST log the drop.
`;

const PARTIAL_DISTRIBUTED = `
# Replicated Log Protocol

A proposer broadcasts a PREPARE message to all replicas. A replica only accepts
a value after it receives PREPARE from a majority of replicas. The leader sends
COMMIT and replicas apply the value to their state machine.

Failure model. If a replica stops responding, the others time out after two
seconds and mark it failed.

Safety invariant. A replica MUST never apply two conflicting committed values.

Ordering semantics. Entries carry monotonically increasing sequence numbers.

Backpressure limits. Each replica MUST hold at most 10,000 uncommitted messages
in its queue.
`;

const COMPLETE_FORMAT = `
# Entry Format

Each record is one line of UTF-8 text.

Parsing. Values are escaped: a literal semicolon inside a value is written as a
backslash followed by a semicolon, and a literal backslash as two backslashes.
A malformed record MUST be rejected and reported to the caller.

Schema evolution. A consumer MUST ignore any field it does not recognise.
Unknown fields are permitted and carry no meaning.

Identity. Each entry is identified by its first field, which MUST be unique
within a store. Two entries with the same identifier are a collision, and the
later one MUST be rejected.

Size. The index MUST contain at most 500 lines. A store with more entries MUST
reject writes until the index is compacted.

Canonical form. Records are compared in byte order after normalisation, which
converts line endings to LF and strips trailing spaces. Two records that
normalise to the same bytes are the same record.
`;

const PARTIAL_FORMAT = `
# Entry Format

Each record is one line of UTF-8 text.

Parsing. A malformed record MUST be rejected and reported to the caller.

Schema evolution. A consumer MUST ignore any field it does not recognise.

Identity. Each entry is identified by its first field, which MUST be unique
within a store.

Canonical form. Records are compared in byte order after normalisation.
`;

// MEMORY.md is named as a per-session entry point with no stated bound. That is
// a real gap, so this document belongs in the "partial" set, not "complete":
// an earlier version expected none and recorded it as a false positive when the
// tool was right.
const PARTIAL_PROTOCOL = `
# Session Memory

Agents load MEMORY.md at the start of every session.

Concurrency. When two agents edit the same line, git rejects the second push and
that agent reads both versions before writing one.

Provenance. The agent tracks who said what and writes each memory to the right
repo.

Contradiction policy. When a new entry contradicts an old one, the newer entry
wins on last-write order.

Scheduling. Dreaming runs periodically, once per day.
`;

// The same document plus an explicit bound becomes a control with no gaps.
const COMPLETE_PROTOCOL = `
# Session Memory

Agents load MEMORY.md at the start of every session. MEMORY.md MUST contain at
most 500 lines, and a session that would exceed this rejects the write.

Concurrency. When two agents edit the same line, git rejects the second push and
that agent reads both versions before writing one.

Provenance. The agent tracks who said what and writes each memory to the right
repo.

Contradiction policy. When a new entry contradicts an old one, the newer entry
wins on last-write order.

Retrieval scope. The agent loads MEMORY.md at the start of every session and
follows links only as the task requires.

Scheduling. Dreaming runs periodically, once per day, and owns its state in the
repo.

Link semantics. Entries link with [[path]]. A link to a missing file is ignored.
`;

/** Write every control to disk and print the expected answers. */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CORPORA, ensureDir } from "./paths.mjs";

const OUT = process.argv[2] ?? ensureDir(join(CORPORA, "negatives"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Expected answers, stated so the benchmark can be wrong rather than merely
// self-confirming. Two were corrected after measuring:
//
//   partial-distributed also has an open ordering question: entries are
//   monotonic, but the document never says what a reader may observe.
//   partial-protocol has no link syntax at all, so `link-graph-semantics`
//   cannot fire — the topic is never raised. Its real gap is the unbounded
//   MEMORY.md, which is what the tool correctly reports.
const controls = [
  { name: "complete-distributed", domain: "distributed-systems", text: COMPLETE_DISTRIBUTED, expect_gaps: [] },
  {
    name: "partial-distributed",
    domain: "distributed-systems",
    text: PARTIAL_DISTRIBUTED,
    expect_gaps: ["state-machine-progress", "ordering-semantics"],
  },
  { name: "complete-format", domain: "data-format", text: COMPLETE_FORMAT, expect_gaps: [] },
  {
    name: "partial-format",
    domain: "data-format",
    text: PARTIAL_FORMAT,
    // No size limit is stated, but nothing names an index or manifest either, so
    // the topic is never raised and no gap is reported. That is a recall miss,
    // not a false positive.
    expect_gaps: [],
  },
  { name: "complete-protocol", domain: "agent-protocol", text: COMPLETE_PROTOCOL, expect_gaps: [] },
  {
    name: "partial-protocol",
    domain: "agent-protocol",
    text: PARTIAL_PROTOCOL,
    expect_gaps: ["entry-size-budget"],
  },
];

const manifest = controls.map((c) => {
  const file = join(OUT, `${c.name}.md`);
  writeFileSync(file, c.text, "utf8");
  return {
    name: c.name,
    file,
    domain: c.domain,
    kind: c.name.startsWith("complete") ? "complete" : "partial",
    expect_gaps: c.expect_gaps,
  };
});

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`wrote ${manifest.length} controls -> ${OUT}\n`);
for (const m of manifest)
  process.stdout.write(`  ${m.name.padEnd(22)} ${m.kind.padEnd(9)} expect gaps: ${m.expect_gaps.length === 0 ? "none" : m.expect_gaps.join(", ")}\n`);