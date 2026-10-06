#!/usr/bin/env node
import { analyzeIdea } from "./pipeline.mjs";
import { renderReport } from "./report.mjs";
import { DOMAINS } from "./domains.mjs";
import { findContradictions } from "./contradictions.mjs";
import { verifyClaim } from "./verify.mjs";
import { TAXONOMY, taxonomyNote } from "./taxonomy.mjs";
import { refute, DISMISSAL_CRITERIA } from "./refute.mjs";

/**
 * Minimal MCP stdio server. ponytail: hand-rolled rather than pulling the SDK —
 * the surface is a handful of tools, and JSON-RPC over stdio is the whole protocol.
 */

const sourceArg = {
  type: "array",
  items: { type: "string" },
  description:
    "Sources: absolute URLs, absolute file paths, or a directory of markdown files. A directory is read as one source set.",
};

const TOOLS = [
  {
    name: "idea_analyze",
    description:
      "Reverse engineer an idea, mechanism, or specification. Returns provenance-bound claims, the decisions the source leaves unstated, cross-source contradictions, and a rebuildability verdict. Use this instead of summarizing a page when the question is 'can we rebuild this?'",
    inputSchema: {
      type: "object",
      required: ["sources"],
      properties: {
        sources: sourceArg,
        domain: { type: "string", enum: [...DOMAINS, "generic"], description: "Override the automatic domain classification." },
      },
    },
  },
  {
    name: "idea_report",
    description: "Render an idea reconstruction as a self-contained HTML report with a decision-coverage map.",
    inputSchema: {
      type: "object",
      required: ["sources"],
      properties: { sources: sourceArg, title: { type: "string" }, domain: { type: "string" } },
    },
  },
  {
    name: "idea_check_claim",
    description:
      "Verify one claim against a source you already have in context. Returns 'verified', 'paraphrased', 'unsupported', or 'unverifiable'. Use before reporting any claim the user will act on.",
    inputSchema: {
      type: "object",
      required: ["claim", "sourceText"],
      properties: {
        claim: { type: "string", description: "The exact quoted text." },
        sourceText: { type: "string", description: "The source text it should appear in." },
      },
    },
  },
  {
    name: "idea_find_contradictions",
    description:
      "Find pairs of claims that describe the same subject with opposite polarity. Takes claims you extracted yourself; use when several sources disagree.",
    inputSchema: {
      type: "object",
      required: ["claims"],
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            required: ["text", "source"],
            properties: { text: { type: "string" }, source: { type: "string" } },
          },
        },
      },
    },
  },
  {
    name: "idea_domains",
    description: "List the decision-class domains available for classification, with the decisions each one examines.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "idea_taxonomy",
    description:
      "The ambiguity taxonomy: 7 subtypes (I-1..I-2, I-3, U-1..U-4) for classifying a finding as a contradiction or an underspecification. Adapted from RFCScope, ASE 2025.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "idea_refute",
    description:
      "Apply the conservative dismissal gate to findings before reporting them. Pass the flags you can determine: implementation_detail, implied, style_or_improvement, divergent. Anything flagged is dismissed with the criterion that fired. Use this after you review idea_analyze output.",
    inputSchema: {
      type: "object",
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "decision"],
            properties: {
              id: { type: "string" },
              decision: { type: "string" },
              implementation_detail: { type: "boolean" },
              implied: { type: "boolean" },
              style_or_improvement: { type: "boolean" },
              divergent: { type: "boolean" },
            },
          },
        },
      },
    },
  },
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const text = (value) => ({ content: [{ type: "text", text: value }] });
const json = (value) => text(JSON.stringify(value, null, 2));

const callTool = async (name, args) => {
  switch (name) {
    case "idea_analyze":
      return json(await analyzeIdea(args.sources, { domain: args.domain }));

    case "idea_report": {
      const result = await analyzeIdea(args.sources, { domain: args.domain });
      return text(renderReport(result, { title: args.title ?? "Idea Reconstruction" }));
    }

    case "idea_check_claim": {
      const claim = { claim_id: "adhoc", quote: args.claim, text: args.claim, source: "adhoc" };
      return json(verifyClaim(claim, args.sourceText));
    }

    case "idea_find_contradictions": {
      const claims = args.claims.map((c, i) => ({ claim_id: `clm_${i}`, quote: c.text, text: c.text, source: c.source }));
      return json(findContradictions(claims));
    }

    case "idea_domains":
      return json({ domains: DOMAINS, note: "idea_analyze classifies automatically; pass domain to override." });

    case "idea_taxonomy":
      return json({ taxonomy: Object.values(TAXONOMY), attribution: taxonomyNote });

    case "idea_refute": {
      const { survived, dismissed, survival_rate } = refute(args.findings, { full: args.context ?? "" });
      return json({
        survived: survived.map((f) => f.gap_id ?? f.id),
        dismissed,
        survival_rate: Number(survival_rate.toFixed(2)),
        criteria: DISMISSAL_CRITERIA.map((c) => ({ id: c.id, question: c.question })),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length === 0) continue;
    handle(JSON.parse(line));
  }
});

const handle = async (message) => {
  const { id, method, params } = message;

  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "idea-re", version: "0.2.0" },
    });
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    try {
      reply(id, await callTool(params.name, params.arguments ?? {}));
    } catch (cause) {
      fail(id, -32603, String(cause.message ?? cause));
    }
    return;
  }
  if (id !== undefined) fail(id, -32601, `Unknown method: ${method}`);
};