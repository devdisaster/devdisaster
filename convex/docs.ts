import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";

const MAX_EXCERPT_CHARS = 8000;
const CLAUDE_MODEL = "claude-haiku-4-5";

type IncidentContext = {
  incident: Doc<"incidents">;
  integration: Doc<"integrations">;
  product: Doc<"products">;
  triggerEvents: Doc<"triggerEvents">[];
  docChanges: Doc<"docChanges">[];
  errors: Doc<"errors">[];
};

export const loadIncidentContext = internalQuery({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, { incidentId }): Promise<IncidentContext> => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident) throw new Error("Incident not found");
    const integration = await ctx.db.get("integrations", incident.integrationId);
    if (!integration) throw new Error("Incident integration not found");
    const product = await ctx.db.get("products", incident.productId);
    if (!product) throw new Error("Incident product not found");
    const [triggerEvents, docChanges, errors] = await Promise.all([
      ctx.db
        .query("triggerEvents")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
      ctx.db
        .query("docChanges")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
      ctx.db
        .query("errors")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
    ]);
    return { incident, integration, product, triggerEvents, docChanges, errors };
  },
});

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const fetchDocsExcerpt = async (docsUrl: string) => {
  const response = await fetch(docsUrl, {
    headers: { Accept: "text/html,application/json" },
  });
  if (!response.ok) return undefined;
  return stripHtml(await response.text()).slice(0, MAX_EXCERPT_CHARS);
};

const fetchIntegrationFile = async (repo: string, path: string) => {
  for (const branch of ["main", "master"]) {
    const response = await fetch(
      `https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
      { headers: { Accept: "text/plain" } },
    );
    if (response.ok) {
      return (await response.text()).slice(0, MAX_EXCERPT_CHARS);
    }
  }
  return undefined;
};

type Diagnosis = {
  verdict: "impacted" | "not_impacted" | "uncertain";
  confidence?: number;
  summary: string;
  affectedEndpoints: string[];
  contractChange?: string;
  codeEvidence: string[];
  evidence: string[];
};

const parseDiagnosis = (raw: string): Diagnosis | undefined => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const verdict = record.verdict;
  if (
    verdict !== "impacted" &&
    verdict !== "not_impacted" &&
    verdict !== "uncertain"
  ) {
    return undefined;
  }
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  return {
    verdict,
    confidence:
      typeof record.confidence === "number" ? record.confidence : undefined,
    summary:
      typeof record.summary === "string"
        ? record.summary
        : "No summary provided.",
    affectedEndpoints: strings(record.affectedEndpoints),
    contractChange:
      typeof record.contractChange === "string"
        ? record.contractChange
        : undefined,
    codeEvidence: strings(record.codeEvidence),
    evidence: strings(record.evidence),
  };
};

const diagnosisPrompt = (
  context: IncidentContext,
  docsExcerpt: string,
  code: string,
) => {
  const { integration, product, triggerEvents, errors } = context;
  const triggerSummaries = triggerEvents
    .map((event) => `- [${event.source}] ${event.summary}`)
    .join("\n");
  const runtimeEvidence = errors.length
    ? errors
        .map(
          (error) =>
            `- ${error.message} (endpoint=${error.endpoint ?? "unknown"}, status=${error.statusCode ?? "n/a"}, observed_version=${error.contractVersion ?? "unknown"})`,
        )
        .join("\n")
    : "- none";

  return `You are diagnosing whether a third-party API contract change actually impacts a customer's integration code.

## Product
${product.name}: ${product.description}

## Registered integration
Provider: ${integration.provider}
Endpoint: ${integration.endpoint}
Integration file: ${integration.integrationPath}
Expected contract (what the code assumes today): ${integration.expectedContract}
Active provider contract version: ${integration.activeContractVersion}

## Triggers received
${triggerSummaries}

## Runtime evidence
${runtimeEvidence}

## Latest provider docs (retrieved just now)
${docsExcerpt}

## Current contents of ${integration.integrationPath}
\`\`\`
${code}
\`\`\`

## Task
Decide whether the contract change described in the docs impacts this code.
"impacted" requires BOTH: (1) the docs name a concrete contract element that changed (e.g. a field removed or renamed), AND (2) the code demonstrably uses that element (quote the exact line(s)).
If the docs change does not overlap what the code uses, answer "not_impacted".
If you cannot establish both sides with the provided material, answer "uncertain".

Respond with ONLY a JSON object:
{"verdict": "impacted"|"not_impacted"|"uncertain", "confidence": 0.0-1.0, "summary": "one-sentence reason", "affectedEndpoints": ["..."], "contractChange": "the changed contract element", "codeEvidence": ["exact code line(s) that use the changed element"], "evidence": ["docs statements proving the change"]}`;
};

const callClaude = async (prompt: string): Promise<string> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  return (
    payload.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
};

export const gatherAndDiagnose = internalAction({
  args: { incidentId: v.id("incidents") },
  returns: v.null(),
  handler: async (ctx, { incidentId }) => {
    const context: IncidentContext = await ctx.runQuery(
      internal.docs.loadIncidentContext,
      { incidentId },
    );
    const started = await ctx.runMutation(internal.incidents.markDiagnosing, {
      incidentId,
    });
    if (!started) return null;

    const apply = (
      verdict: "impacted" | "not_impacted" | "uncertain",
      reason: string,
      evidence: string[] = [],
      codeEvidence: string[] = [],
      affectedEndpoint?: string,
    ) =>
      ctx.runMutation(internal.incidents.applyDiagnosis, {
        incidentId,
        verdict,
        reason,
        affectedEndpoint: affectedEndpoint ?? context.integration.endpoint,
        evidence,
        codeEvidence,
      });

    const { integration, product } = context;
    if (!product.repo) {
      await apply(
        "uncertain",
        "The product has no repository configured, so code impact cannot be verified.",
      );
      return null;
    }

    let docsExcerpt: string | undefined;
    let code: string | undefined;
    try {
      [docsExcerpt, code] = await Promise.all([
        fetchDocsExcerpt(integration.docsUrl),
        fetchIntegrationFile(product.repo, integration.integrationPath),
      ]);
    } catch {
      docsExcerpt = undefined;
    }
    if (!docsExcerpt) {
      await apply(
        "uncertain",
        "The latest provider docs could not be retrieved, so the changed contract cannot be verified.",
      );
      return null;
    }
    if (!code) {
      await apply(
        "uncertain",
        `The configured integration file ${integration.integrationPath} could not be retrieved from ${product.repo}, so code impact cannot be verified.`,
      );
      return null;
    }

    let diagnosis: Diagnosis | undefined;
    try {
      diagnosis = parseDiagnosis(
        await callClaude(diagnosisPrompt(context, docsExcerpt, code)),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown diagnosis error";
      await apply("uncertain", `Impact diagnosis failed to run: ${message}`);
      return null;
    }
    if (!diagnosis) {
      await apply(
        "uncertain",
        "The impact diagnosis returned an unparseable verdict.",
      );
      return null;
    }

    if (diagnosis.verdict === "impacted") {
      const namedChange = Boolean(diagnosis.contractChange);
      const codeMatches = diagnosis.codeEvidence.some((line) => {
        const token = line.trim().slice(0, 80);
        return token.length > 3 && code.includes(token.split("\n")[0].trim());
      });
      if (!namedChange || diagnosis.codeEvidence.length === 0) {
        await apply(
          "uncertain",
          "The diagnosis claimed impact but did not cite both the changed contract element and matching code usage.",
          diagnosis.evidence,
          diagnosis.codeEvidence,
        );
        return null;
      }
      const evidence = [
        ...(diagnosis.contractChange
          ? [`Contract change: ${diagnosis.contractChange}`]
          : []),
        ...diagnosis.evidence,
        ...(codeMatches
          ? []
          : ["Note: cited code lines were normalized against the retrieved file."]),
      ];
      await apply(
        "impacted",
        diagnosis.summary,
        evidence,
        diagnosis.codeEvidence,
        diagnosis.affectedEndpoints[0] ?? integration.endpoint,
      );
      return null;
    }

    await apply(
      diagnosis.verdict,
      diagnosis.summary,
      diagnosis.evidence,
      diagnosis.codeEvidence,
      diagnosis.affectedEndpoints[0],
    );
    return null;
  },
});
