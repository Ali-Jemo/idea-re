#!/usr/bin/env python3
"""Benchmark SupersonicLabs/Julia-1 on idea-re's domain classification.

The question this answers: does a 144.3M-parameter decision model beat the
keyword heuristic on real specifications? Nothing gets wired in without the
numbers.

Setup:
    python3.11 -m venv .venv && .venv/bin/pip install torch --index-url \\
        https://download.pytorch.org/whl/cpu
    .venv/bin/pip install huggingface_hub
    .venv/bin/python -c "from huggingface_hub import snapshot_download; \\
        snapshot_download('SupersonicLabs/Julia-1', local_dir='Julia-1')"
    .venv/bin/pip install -e ./Julia-1

Run:
    .venv/bin/python eval/julia-bench/run-julia.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "eval" / "data" / "julia-cases" / "cases.json"
OUT = ROOT / "eval" / "data" / "julia-cases" / "julia-results.json"
MODEL = ROOT / "Julia-1"

# What each domain means to Julia, in its own words. A decision model reads the
# descriptions of the options, so these carry the meaning rather than the slug.
DESCRIPTIONS = {
    "distributed-systems": (
        "A protocol for replicas, consensus, leaders, quorums, elections, ordering "
        "guarantees, replication, or failure recovery across multiple nodes."
    ),
    "data-format": (
        "A specification of a data format, wire format, serialization, encoding, "
        "ABNF grammar, registry file, record layout, or structured document syntax."
    ),
    "agent-protocol": (
        "A protocol where AI agents, sessions, and memory repositories exchange, "
        "store, or reconcile persistent state across sessions."
    ),
    "generic": (
        "A transport, security, cryptographic, or general protocol that is neither "
        "a data format nor a distributed-systems protocol nor an agent protocol."
    ),
}


def load_cases():
    cases = json.loads(CASES.read_text())
    if not cases:
        sys.exit(f"no cases at {CASES} — run: node eval/julia-bench/make-cases.mjs")
    return cases


def predict(engine, cases):
    results = []
    for case in cases:
        options = {name: DESCRIPTIONS[name] for name in case["options"]}
        try:
            answer = engine.predict(
                state=case["excerpt"],
                questions={
                    "domain": {
                        "type": "choice",
                        "instructions": (
                            "Which subject area does this specification belong to? "
                            "Choose exactly one."
                        ),
                        "criteria": options,
                    }
                },
            )
            chosen = answer["answers"]["domain"]["choice"]
            confidence = answer["answers"]["domain"].get("max_probability")
            results.append(
                {
                    "id": case["id"],
                    "label": case["label"],
                    "predicted": chosen,
                    "confidence": confidence,
                    "correct": chosen == case["label"],
                }
            )
            print(f"  {case['id']}: label={case['label']} julia={chosen} p={confidence}", flush=True)
        except Exception as exc:  # noqa: BLE001 — a failure is a result, not a crash
            print(f"  {case['id']}: ERROR {exc}", flush=True)
            results.append(
                {"id": case["id"], "label": case["label"], "predicted": None,
                 "confidence": None, "correct": False, "error": str(exc)}
            )
    return results


def main() -> int:
    sys.path.insert(0, str(MODEL))
    try:
        from julia import load_model
    except ImportError:
        sys.exit(
            f"cannot import julia from {MODEL}.\n"
            "Install per the module docstring, then rerun."
        )

    cases = load_cases()
    # load_model resolves a bare name against the cwd, so pass the absolute path.
    checkpoint = str(MODEL)
    if not Path(checkpoint, "encoder", "config.json").exists():
        sys.exit(f"incomplete download at {checkpoint} — rerun snapshot_download")

    print(f"loading Julia-1 from {checkpoint} (CPU)…", flush=True)
    engine = load_model(checkpoint, device="cpu", strict_encoding=True, max_length=8192)

    results = predict(engine, cases)
    correct = sum(1 for r in results if r["correct"])
    report = {
        "model": "SupersonicLabs/Julia-1",
        "parameters": "144.3M",
        "device": "cpu",
        "cases": len(results),
        "correct": correct,
        "accuracy": round(correct / len(results), 4) if results else 0,
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))

    baseline = json.loads((OUT.parent / "heuristic-baseline.json").read_text())
    base_correct = sum(1 for b in baseline if b["predicted"] == b["label"])
    print(f"\nJulia-1 : {correct}/{len(results)} = {report['accuracy']}")
    print(f"heuristic: {base_correct}/{len(baseline)} = {round(base_correct / len(baseline), 4)}")
    print(f"\nwritten {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())