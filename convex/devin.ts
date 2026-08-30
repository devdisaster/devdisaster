import {
  start,
  vResultValidator,
  vWorkflowId,
  WorkflowManager,
} from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

const launchArgs = {
  productId: v.id("products"),
  incidentId: v.optional(v.id("incidents")),
  clusterId: v.optional(v.id("clusters")),
};

const launchResult = v.object({
  status: v.union(v.literal("launched"), v.literal("duplicate"), v.literal("skipped")),
  sessionId: v.optional(v.id("sessions")),
  devinSessionId: v.optional(v.string()),
  reason: v.optional(v.string()),
});

const reservationResult = v.object({
  status: v.union(v.literal("reserved"), v.literal("duplicate"), v.literal("skipped")),
  sessionId: v.optional(v.id("sessions")),
  devinSessionId: v.optional(v.string()),
  reason: v.optional(v.string()),
  retryReservation: v.optional(v.boolean()),
});

type LaunchArgs = {
  productId: Id<"products">;
  incidentId?: Id<"incidents">;
  clusterId?: Id<"clusters">;
};

type LaunchResult = {
  status: "launched" | "duplicate" | "skipped";
  sessionId?: Id<"sessions">;
  devinSessionId?: string;
  reason?: string;
};

type IncidentPacket = {
  kind: "incident";
  product: Doc<"products">;
  incident: Doc<"incidents">;
  integration: Doc<"integrations">;
  triggerEvents: Doc<"triggerEvents">[];
  docChanges: Doc<"docChanges">[];
  errors: Doc<"errors">[];
};

type FeedbackPacket = {
  kind: "feedback";
  product: Doc<"products">;
  cluster: Doc<"clusters">;
  reviews: Doc<"reviews">[];
};

type LaunchPacket = IncidentPacket | FeedbackPacket;

type Reservation = {
  status: "reserved" | "duplicate" | "skipped";
  sessionId?: Id<"sessions">;
  devinSessionId?: string;
  reason?: string;
  retryReservation?: boolean;
};

const structuredOutputSchema = {
  type: "object",
  properties: {
    pr_url: { type: "string" },
    summary: { type: "string" },
    root_cause: { type: "string" },
    tests_passed: { type: "boolean" },
    test_summary: { type: "string" },
  },
};

const requireSingleTrigger = (
  incidentId: Id<"incidents"> | undefined,
  clusterId: Id<"clusters"> | undefined,
) => {
  if ((incidentId === undefined) === (clusterId === undefined)) {
    throw new Error("Exactly one of incidentId or clusterId is required");
  }
};

export const prepareLaunch = internalQuery({
  args: launchArgs,
  returns: v.any(),
  handler: async (ctx, { productId, incidentId, clusterId }) => {
    requireSingleTrigger(incidentId, clusterId);
    const product = await ctx.db.get("products", productId);
    if (!product) throw new Error("Product not found");

    if (incidentId) {
      const incident = await ctx.db.get("incidents", incidentId);
      if (!incident || incident.productId !== productId) {
        throw new Error("Incident does not belong to the product");
      }
      const integration = await ctx.db.get("integrations", incident.integrationId);
      if (!integration || integration.productId !== productId) {
        throw new Error("Incident integration not found");
      }
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
      return { kind: "incident" as const, product, incident, integration, triggerEvents, docChanges, errors };
    }

    const cluster = await ctx.db.get("clusters", clusterId!);
    if (!cluster || cluster.productId !== productId) {
      throw new Error("Cluster does not belong to the product");
    }
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_cluster", (q) => q.eq("clusterId", clusterId))
      .collect();
    return { kind: "feedback" as const, product, cluster, reviews };
  },
});

const incidentPrompt = (packet: {
  product: Doc<"products">;
  incident: Doc<"incidents">;
  integration: Doc<"integrations">;
  triggerEvents: Doc<"triggerEvents">[];
  docChanges: Doc<"docChanges">[];
  errors: Doc<"errors">[];
}) => {
  const sources = [...new Set(packet.triggerEvents.map((event) => event.source))];
  const sourceSummary =
    sources.length === 2 ? "docs change and runtime failure" : sources[0] ?? "incident evidence";
  const docsEvidence = packet.docChanges.length
    ? packet.docChanges
        .map(
          (change) =>
            `- Retrieved ${new Date(change._creationTime).toISOString()}: ${change.summary}\n  URL: ${change.url}\n  Affected endpoints: ${change.affectedEndpoints.join(", ") || "not specified"}`,
        )
        .join("\n")
    : `- No separate docs-change row is attached. Registered docs URL: ${packet.integration.docsUrl}`;
  const runtimeEvidence = packet.errors.length
    ? packet.errors
        .map(
          (error) =>
            `- ${error.message}; endpoint=${error.endpoint ?? "unknown"}; status=${error.statusCode ?? "unknown"}; contract_version=${error.contractVersion ?? "unknown"}`,
        )
        .join("\n")
    : "- No runtime error is attached.";
  const diagnosis = [
    packet.incident.diagnosisReason ?? "No diagnosis reason supplied.",
    ...(packet.incident.codeEvidence ?? []),
    ...(packet.incident.diagnosisEvidence ?? []),
  ]
    .map((line) => `- ${line}`)
    .join("\n");

  return `You are repairing a broken third-party API integration in the repository ${packet.product.repo}.
Work on a new branch and open a pull request. Never merge or deploy.

## Product context
${packet.product.description}

## Incident: ${packet.incident.title}
Trigger source(s): ${sourceSummary}
Provider: ${packet.integration.provider} — endpoint ${packet.integration.endpoint}
Registered integration path: ${packet.integration.integrationPath}
Expected contract (what the code assumes today): ${packet.integration.expectedContract}

## What changed (from the provider's docs)
${docsEvidence}
Affected element: ${packet.incident.affectedEndpoint ?? packet.integration.endpoint}

## Runtime evidence (if present)
${runtimeEvidence}

## Diagnosis
${diagnosis}

## Task
1. Inspect ${packet.integration.integrationPath} and confirm the diagnosis.
2. Make the smallest integration-only change so the code works with the new contract.
   Do not refactor unrelated code. Do not touch the vendor or its docs.
3. Update or add a regression test covering the NEW contract shape (fixture provided in evidence).
4. Run: ${packet.integration.testCommand}
5. Open a PR titled "fix: ${packet.incident.title}" citing this incident's evidence in the body.
6. Report pr_url, summary, root_cause, tests_passed, test_summary in your structured output.

If the evidence is insufficient or the code is not actually affected, report that instead of forcing a patch.`;
};

const feedbackPrompt = (packet: {
  product: Doc<"products">;
  cluster: Doc<"clusters">;
  reviews: Doc<"reviews">[];
}) => {
  const reviews = packet.reviews.length
    ? packet.reviews
        .map(
          (review) =>
            `- [${review.source}${review.rating === undefined ? "" : `, ${review.rating}★`}] ${review.text}`,
        )
        .join("\n")
    : `- [seed] ${packet.cluster.summary}`;

  return `You are fixing a bug in the repository ${packet.product.repo}. Work on a new branch and open a pull request. Never merge or deploy.

## Product context
${packet.product.description}

## Evidence: ${packet.cluster.count} user complaints, clustered as "${packet.cluster.title}"
${reviews}

## Task
1. Reproduce/locate the issue described above in the codebase.
2. Implement a minimal, safe fix. Do not refactor unrelated code.
3. Run the test suite if present (see README/AGENTS.md for commands).
4. Open a PR titled "fix: ${packet.cluster.title}" with a body that cites the user complaints.
5. Report pr_url, summary, and root_cause in your structured output.

Keep the diff small. If you cannot find the bug, open a draft PR documenting your investigation instead.`;
};

export const reserveLaunch = internalMutation({
  args: {
    ...launchArgs,
    prompt: v.string(),
  },
  returns: reservationResult,
  handler: async (ctx, { productId, incidentId, clusterId, prompt }) => {
    requireSingleTrigger(incidentId, clusterId);
    const product = await ctx.db.get("products", productId);
    if (!product) throw new Error("Product not found");
    if (!product.repo) {
      await ctx.db.insert("events", {
        productId,
        incidentId,
        sentinel: incidentId ? "integration" : "feedback",
        message: "Devin launch skipped because this product is in observer mode (no repository configured).",
        level: "warn",
      });
      return { status: "skipped" as const, reason: "Product has no repository configured" };
    }

    if (incidentId) {
      const incident = await ctx.db.get("incidents", incidentId);
      if (!incident || incident.productId !== productId) {
        throw new Error("Incident does not belong to the product");
      }
      if (incident.sessionId) {
        const session = await ctx.db.get("sessions", incident.sessionId);
        return {
          status: "duplicate" as const,
          sessionId: incident.sessionId,
          devinSessionId: session?.devinSessionId,
          retryReservation: session?.status === "launching",
        };
      }
      if (incident.status !== "repair_queued" || incident.diagnosisVerdict !== "impacted") {
        await ctx.db.insert("events", {
          productId,
          incidentId,
          sentinel: "integration",
          message: "Devin launch rejected: incident is not an impacted repair_queued incident.",
          level: "warn",
        });
        return { status: "skipped" as const, reason: "Incident is not eligible for repair" };
      }
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .first();
      if (existing) {
        await ctx.db.patch("incidents", incidentId, { sessionId: existing._id });
        return {
          status: "duplicate" as const,
          sessionId: existing._id,
          devinSessionId: existing.devinSessionId,
          retryReservation: existing.status === "launching",
        };
      }
      const sessionId = await ctx.db.insert("sessions", {
        productId,
        trigger: "incident",
        incidentId,
        devinSessionId: `pending:${incidentId}`,
        devinUrl: "",
        status: "launching",
        prompt,
      });
      await ctx.db.patch("incidents", incidentId, { sessionId, status: "repairing" });
      await ctx.db.insert("events", {
        productId,
        incidentId,
        sentinel: "integration",
        message: "Repair evidence accepted; launching Devin.",
        level: "info",
      });
      return { status: "reserved" as const, sessionId, retryReservation: true };
    }

    const cluster = await ctx.db.get("clusters", clusterId!);
    if (!cluster || cluster.productId !== productId) {
      throw new Error("Cluster does not belong to the product");
    }
    if (cluster.sessionId) {
      const session = await ctx.db.get("sessions", cluster.sessionId);
      return {
        status: "duplicate" as const,
        sessionId: cluster.sessionId,
        devinSessionId: session?.devinSessionId,
        retryReservation: session?.status === "launching",
      };
    }
    if (cluster.status !== "triggered") {
      await ctx.db.insert("events", {
        productId,
        sentinel: "feedback",
        message: "Devin launch rejected: feedback cluster has not been triggered.",
        level: "warn",
      });
      return { status: "skipped" as const, reason: "Cluster is not eligible for repair" };
    }
    const sessionId = await ctx.db.insert("sessions", {
      productId,
      trigger: "feedback",
      clusterId,
      devinSessionId: `pending:${clusterId}`,
      devinUrl: "",
      status: "launching",
      prompt,
    });
    await ctx.db.patch("clusters", clusterId!, { sessionId });
    await ctx.db.insert("events", {
      productId,
      sentinel: "feedback",
      message: `Feedback cluster "${cluster.title}" triggered a Devin repair.`,
      level: "info",
    });
    return { status: "reserved" as const, sessionId, retryReservation: true };
  },
});

export const completeLaunch = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    devinSessionId: v.string(),
    devinUrl: v.string(),
    status: v.string(),
  },
  returns: launchResult,
  handler: async (ctx, { sessionId, devinSessionId, devinUrl, status }) => {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) throw new Error("Reserved session not found");
    if (session.status !== "launching") {
      return {
        status: "duplicate" as const,
        sessionId,
        devinSessionId: session.devinSessionId,
      };
    }
    await ctx.db.patch("sessions", sessionId, { devinSessionId, devinUrl, status });
    await ctx.db.insert("events", {
      productId: session.productId,
      incidentId: session.incidentId,
      sentinel: session.incidentId ? "integration" : "feedback",
      message: `Devin session started (${status}).`,
      level: "info",
    });
    return { status: "launched" as const, sessionId, devinSessionId };
  },
});

export const recordLaunchError = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, message }) => {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || session.status !== "launching") return null;
    await ctx.db.patch("sessions", sessionId, { status: "launch_failed" });
    if (session.incidentId) {
      const incident = await ctx.db.get("incidents", session.incidentId);
      if (incident?.status === "repairing") {
        await ctx.db.patch("incidents", incident._id, { status: "repair_failed" });
      }
    }
    await ctx.db.insert("events", {
      productId: session.productId,
      incidentId: session.incidentId,
      sentinel: "system",
      message: `Devin launch failed: ${message}`,
      level: "critical",
    });
    return null;
  },
});

const parseLaunchResponse = (value: unknown) => {
  if (!value || typeof value !== "object") throw new Error("Devin returned an invalid launch response");
  const response = value as Record<string, unknown>;
  if (typeof response.session_id !== "string" || typeof response.url !== "string") {
    throw new Error("Devin launch response is missing session_id or url");
  }
  return { sessionId: response.session_id, url: response.url };
};

const responseError = (response: Response) =>
  `Devin API request failed (${response.status} ${response.statusText})`;

export const launchPlain = internalAction({
  args: launchArgs,
  returns: launchResult,
  handler: async (ctx, args: LaunchArgs): Promise<LaunchResult> => {
    requireSingleTrigger(args.incidentId, args.clusterId);
    const packet: LaunchPacket = await ctx.runQuery(internal.devin.prepareLaunch, args);
    const prompt: string = packet.kind === "incident" ? incidentPrompt(packet) : feedbackPrompt(packet);
    const reservation: Reservation = await ctx.runMutation(internal.devin.reserveLaunch, { ...args, prompt });
    if (reservation.status === "skipped") {
      return { status: "skipped" as const, reason: reservation.reason };
    }
    const reservedSessionId = reservation.sessionId;
    if (!reservedSessionId) throw new Error("Launch reservation did not return a session ID");
    if (reservation.status === "duplicate" && !reservation.retryReservation) {
      return {
        status: "duplicate" as const,
        sessionId: reservedSessionId,
        devinSessionId: reservation.devinSessionId,
      };
    }

    const apiKey = process.env.DEVIN_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.devin.recordLaunchError, {
        sessionId: reservedSessionId,
        message: "DEVIN_API_KEY is not configured",
      });
      throw new Error("DEVIN_API_KEY is not configured");
    }

    try {
      const response = await fetch("https://api.devin.ai/v1/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          idempotent: true,
          max_acu_limit: 5,
          title: `Sentinel: ${packet.kind === "incident" ? packet.incident.title : packet.cluster.title}`,
          structured_output_schema: structuredOutputSchema,
        }),
      });
      if (!response.ok) throw new Error(responseError(response));
      const launched = parseLaunchResponse(await response.json());

      let initialStatus = "working";
      const initial = await fetch(`https://api.devin.ai/v1/sessions/${encodeURIComponent(launched.sessionId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (initial.ok) {
        const body = (await initial.json()) as Record<string, unknown>;
        if (typeof body.status_enum === "string") initialStatus = body.status_enum;
      }

      return await ctx.runMutation(internal.devin.completeLaunch, {
        sessionId: reservedSessionId,
        devinSessionId: launched.sessionId,
        devinUrl: launched.url,
        status: initialStatus,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Devin launch error";
      await ctx.runMutation(internal.devin.recordLaunchError, {
        sessionId: reservedSessionId,
        message,
      });
      throw error;
    }
  },
});

const activeStatuses = new Set(["working", "blocked", "resumed"]);
const terminalFailureStatuses = new Set(["expired", "failed", "error", "stopped", "cancelled"]);

type StructuredOutput = {
  pr_url?: string;
  summary?: string;
  root_cause?: string;
  tests_passed?: boolean;
  test_summary?: string;
};

type PollPayload = {
  status: string;
  prUrl?: string;
  prNumber?: number;
  structuredOutput?: StructuredOutput;
  testStatus?: "passed" | "failed" | "unknown";
  testSummary?: string;
};

const structuredOutputValidator = v.object({
  pr_url: v.optional(v.string()),
  summary: v.optional(v.string()),
  root_cause: v.optional(v.string()),
  tests_passed: v.optional(v.boolean()),
  test_summary: v.optional(v.string()),
});

const sanitizeStructuredOutput = (value: unknown): StructuredOutput | undefined => {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  const sanitized: StructuredOutput = {};
  if (typeof record.pr_url === "string") sanitized.pr_url = record.pr_url;
  if (typeof record.summary === "string") sanitized.summary = record.summary.slice(0, 4000);
  if (typeof record.root_cause === "string") sanitized.root_cause = record.root_cause.slice(0, 4000);
  if (typeof record.tests_passed === "boolean") sanitized.tests_passed = record.tests_passed;
  if (typeof record.test_summary === "string") sanitized.test_summary = record.test_summary.slice(0, 4000);
  return Object.keys(sanitized).length ? sanitized : undefined;
};

const parsePollPayload = (value: unknown): PollPayload => {
  if (!value || typeof value !== "object") throw new Error("Devin returned an invalid session response");
  const response = value as Record<string, unknown>;
  if (typeof response.status_enum !== "string") {
    throw new Error("Devin session response is missing status_enum");
  }
  const pullRequest =
    response.pull_request && typeof response.pull_request === "object"
      ? (response.pull_request as Record<string, unknown>)
      : undefined;
  const structuredOutput = sanitizeStructuredOutput(response.structured_output);
  const pullRequestUrl = typeof pullRequest?.url === "string" ? pullRequest.url : undefined;
  const prUrl = pullRequestUrl ?? structuredOutput?.pr_url;
  const numberMatch = prUrl?.match(/\/pull\/(\d+)(?:\/|$)/);
  const testStatus =
    structuredOutput?.tests_passed === true
      ? "passed"
      : structuredOutput?.tests_passed === false
        ? "failed"
        : response.status_enum === "finished"
          ? "unknown"
          : undefined;
  return {
    status: response.status_enum,
    prUrl,
    prNumber: numberMatch ? Number(numberMatch[1]) : undefined,
    structuredOutput,
    testStatus,
    testSummary: structuredOutput?.test_summary,
  };
};

export const listActiveSessions = internalQuery({
  args: { sessionId: v.optional(v.id("sessions")) },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    if (sessionId) {
      const session = await ctx.db.get("sessions", sessionId);
      return session && activeStatuses.has(session.status) ? [session] : [];
    }
    return (await ctx.db.query("sessions").collect()).filter(
      (session) =>
        activeStatuses.has(session.status) &&
        sentinelMetadata(session.structuredOutput)?.workflowManaged !== true,
    );
  },
});

const sentinelMetadata = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = (value as Record<string, unknown>)._sentinel;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : undefined;
};

export const claimBlockedNudge = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || sentinelMetadata(session.structuredOutput)?.nudged === true) return false;
    const current =
      session.structuredOutput && typeof session.structuredOutput === "object" && !Array.isArray(session.structuredOutput)
        ? (session.structuredOutput as Record<string, unknown>)
        : {};
    await ctx.db.patch("sessions", sessionId, {
      structuredOutput: {
        ...current,
        _sentinel: { ...sentinelMetadata(current), nudged: true },
      },
    });
    return true;
  },
});

export const recordNudgeResult = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    sent: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, sent }) => {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) return null;
    await ctx.db.insert("events", {
      productId: session.productId,
      incidentId: session.incidentId,
      sentinel: "system",
      message: sent
        ? "Devin was blocked; Sentinel sent one controlled proceed nudge."
        : "Devin was blocked; the single controlled nudge attempt failed.",
      level: sent ? "warn" : "critical",
    });
    return null;
  },
});

export const applyPoll = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.string(),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    structuredOutput: v.optional(structuredOutputValidator),
    testStatus: v.optional(v.union(v.literal("passed"), v.literal("failed"), v.literal("unknown"))),
    testSummary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, payload) => {
    const session = await ctx.db.get("sessions", payload.sessionId);
    if (!session) return null;
    const existingMetadata = sentinelMetadata(session.structuredOutput);
    const output = payload.structuredOutput
      ? { ...(payload.structuredOutput as Record<string, unknown>), ...(existingMetadata ? { _sentinel: existingMetadata } : {}) }
      : session.structuredOutput;
    const patch: Partial<Doc<"sessions">> = {
      status: payload.status,
      structuredOutput: output,
    };
    if (payload.prUrl) patch.prUrl = payload.prUrl;
    if (payload.prNumber !== undefined) patch.prNumber = payload.prNumber;
    if (payload.testStatus) patch.testStatus = payload.testStatus;
    if (payload.testSummary) patch.testSummary = payload.testSummary;
    await ctx.db.patch("sessions", payload.sessionId, patch);

    const sentinel = session.incidentId ? "integration" : "feedback";
    if (session.status !== payload.status) {
      await ctx.db.insert("events", {
        productId: session.productId,
        incidentId: session.incidentId,
        sentinel,
        message: `Devin session status changed: ${session.status} → ${payload.status}.`,
        level: payload.status === "blocked" ? "warn" : "info",
      });
    }
    if (payload.prUrl && payload.prUrl !== session.prUrl) {
      await ctx.db.insert("events", {
        productId: session.productId,
        incidentId: session.incidentId,
        sentinel,
        message: `Devin opened pull request${payload.prNumber ? ` #${payload.prNumber}` : ""}.`,
        level: "info",
      });
    }
    if (payload.testStatus && payload.testStatus !== session.testStatus) {
      await ctx.db.insert("events", {
        productId: session.productId,
        incidentId: session.incidentId,
        sentinel,
        message: `Devin reported tests ${payload.testStatus}${payload.testSummary ? `: ${payload.testSummary}` : "."}`,
        level: payload.testStatus === "failed" ? "critical" : "info",
      });
    }

    const finished = payload.status === "finished";
    const terminalFailure = terminalFailureStatuses.has(payload.status);
    const evidenceComplete =
      Boolean(payload.prUrl) && payload.testStatus === "passed";
    if (session.incidentId) {
      const incident = await ctx.db.get("incidents", session.incidentId);
      if (!incident || incident.status === "repair_proposed" || incident.status === "repair_failed") return null;
      if ((finished || payload.status === "blocked") && evidenceComplete) {
        await ctx.db.patch("incidents", incident._id, { status: "validating" });
        await ctx.db.insert("events", {
          productId: session.productId,
          incidentId: incident._id,
          sentinel: "integration",
          message: "Repair completed with a PR; validating reported test results.",
          level: "info",
        });
        await ctx.db.patch("incidents", incident._id, { status: "repair_proposed" });
        await ctx.db.insert("events", {
          productId: session.productId,
          incidentId: incident._id,
          sentinel: "integration",
          message: "Repair PR proposed with passing tests. Human review is required; Sentinel will not merge it.",
          level: "info",
        });
      } else if (finished || terminalFailure || payload.testStatus === "failed") {
        const reason = payload.testStatus === "failed"
          ? "tests failed"
          : !payload.prUrl
            ? "no required pull request was produced"
            : payload.testStatus !== "passed"
              ? "passing tests were not reported"
              : `session ended with ${payload.status}`;
        await ctx.db.patch("incidents", incident._id, { status: "repair_failed" });
        await ctx.db.insert("events", {
          productId: session.productId,
          incidentId: incident._id,
          sentinel: "integration",
          message: `Repair failed: ${reason}.`,
          level: "critical",
        });
      }
      return null;
    }

    if (
      session.clusterId &&
      (finished || payload.status === "blocked") &&
      payload.prUrl
    ) {
      const cluster = await ctx.db.get("clusters", session.clusterId);
      if (cluster && cluster.status === "triggered") {
        await ctx.db.patch("clusters", cluster._id, { status: "pr_open" });
        await ctx.db.insert("events", {
          productId: session.productId,
          sentinel: "feedback",
          message: `Feedback repair PR opened for "${cluster.title}".`,
          level: "info",
        });
      }
    } else if (session.clusterId && (finished || terminalFailure)) {
      await ctx.db.insert("events", {
        productId: session.productId,
        sentinel: "feedback",
        message: "Feedback repair session ended without a pull request; the cluster remains triggered for review.",
        level: "critical",
      });
    }
    return null;
  },
});

export const poll = internalAction({
  args: { sessionId: v.optional(v.id("sessions")) },
  returns: v.object({ active: v.number(), polled: v.number(), failed: v.number() }),
  handler: async (ctx, { sessionId }): Promise<{ active: number; polled: number; failed: number }> => {
    const sessions: Doc<"sessions">[] = await ctx.runQuery(internal.devin.listActiveSessions, { sessionId });
    if (!sessions.length) return { active: 0, polled: 0, failed: 0 };
    const apiKey = process.env.DEVIN_API_KEY;
    if (!apiKey) throw new Error("DEVIN_API_KEY is not configured");
    let polled = 0;
    let failed = 0;

    for (const session of sessions) {
      try {
        const response = await fetch(
          `https://api.devin.ai/v1/sessions/${encodeURIComponent(session.devinSessionId)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!response.ok) throw new Error(responseError(response));
        const payload = parsePollPayload(await response.json());
        if (payload.status === "blocked") {
          const claimed: boolean = await ctx.runMutation(internal.devin.claimBlockedNudge, {
            sessionId: session._id,
          });
          if (claimed) {
            const nudge = await fetch(
              `https://api.devin.ai/v1/session/${encodeURIComponent(session.devinSessionId)}/message`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Proceed with your best judgment." }),
              },
            );
            await ctx.runMutation(internal.devin.recordNudgeResult, {
              sessionId: session._id,
              sent: nudge.ok,
            });
          }
        }
        await ctx.runMutation(internal.devin.applyPoll, { sessionId: session._id, ...payload });
        polled += 1;
      } catch {
        failed += 1;
      }
    }
    return { active: sessions.length, polled, failed };
  },
});

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 5,
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
  },
});

export const repairLifecycle = workflow
  .define({
    args: { sessionId: v.id("sessions") },
    returns: v.object({
      status: v.union(v.literal("completed"), v.literal("poll_limit_reached")),
      polls: v.number(),
    }),
  })
  .handler(async (step, { sessionId }): Promise<{ status: "completed" | "poll_limit_reached"; polls: number }> => {
    for (let polls = 1; polls <= 180; polls += 1) {
      const result = await step.runAction(
        internal.devin.poll,
        { sessionId },
        { retry: true, name: `poll-${polls}` },
      );
      if (result.active === 0) return { status: "completed", polls };
      await step.sleep(20_000, { name: `wait-${polls}` });
    }
    return { status: "poll_limit_reached", polls: 180 };
  });

export const handleLifecycleComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ sessionId: v.id("sessions") }),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, result, context }): Promise<null> => {
    const session = await ctx.db.get("sessions", context.sessionId);
    if (!session) return null;
    const current =
      session.structuredOutput && typeof session.structuredOutput === "object" && !Array.isArray(session.structuredOutput)
        ? (session.structuredOutput as Record<string, unknown>)
        : {};
    const metadata = sentinelMetadata(current);
    if (metadata?.workflowId !== workflowId) return null;
    await ctx.db.patch("sessions", session._id, {
      structuredOutput: {
        ...current,
        _sentinel: { ...metadata, workflowManaged: false },
      },
    });
    const completion = result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
    const returnValue =
      completion?.kind === "success" && completion.returnValue && typeof completion.returnValue === "object"
        ? (completion.returnValue as Record<string, unknown>)
        : undefined;
    if (
      completion?.kind === "failed" ||
      completion?.kind === "canceled" ||
      returnValue?.status === "poll_limit_reached"
    ) {
      await ctx.db.insert("events", {
        productId: session.productId,
        incidentId: session.incidentId,
        sentinel: "system",
        message:
          completion?.kind === "failed" || completion?.kind === "canceled"
            ? "Durable Devin workflow did not complete; the cron poller will continue monitoring the session."
            : "Durable Devin workflow reached its bounded poll limit; the cron poller will continue monitoring the session.",
        level: "warn",
      });
    }
    return null;
  },
});

export const startLifecycle = internalMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || !activeStatuses.has(session.status)) return false;
    const current =
      session.structuredOutput && typeof session.structuredOutput === "object" && !Array.isArray(session.structuredOutput)
        ? (session.structuredOutput as Record<string, unknown>)
        : {};
    const metadata = sentinelMetadata(current);
    if (metadata?.workflowManaged === true) return false;
    const workflowId = await start(
      ctx,
      internal.devin.repairLifecycle,
      { sessionId },
      { onComplete: internal.devin.handleLifecycleComplete, context: { sessionId } },
    );
    await ctx.db.patch("sessions", sessionId, {
      structuredOutput: {
        ...current,
        _sentinel: { ...metadata, workflowManaged: true, workflowId },
      },
    });
    return true;
  },
});

export const launch = internalAction({
  args: launchArgs,
  returns: launchResult,
  handler: async (ctx, args: LaunchArgs): Promise<LaunchResult> => {
    const result: LaunchResult = await ctx.runAction(internal.devin.launchPlain, args);
    if (result.sessionId) {
      await ctx.runMutation(internal.devin.startLifecycle, { sessionId: result.sessionId });
    }
    return result;
  },
});
