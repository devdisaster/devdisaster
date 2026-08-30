// Shared status → presentation maps derived from the R1 schema unions.

export const AMBER_DOT = "bg-amber-500";
export const RED_DOT = "bg-red-500";
export const GREEN_DOT = "bg-emerald-500";
export const NEUTRAL_DOT = "bg-neutral-300 dark:bg-neutral-600";

export const INCIDENT_STATUS: Record<string, { label: string; dot: string }> = {
  detected: { label: "Detected", dot: RED_DOT },
  gathering_context: { label: "Gathering context", dot: AMBER_DOT },
  diagnosing: { label: "Diagnosing", dot: AMBER_DOT },
  not_impacted: { label: "Not impacted", dot: NEUTRAL_DOT },
  needs_review: { label: "Needs review", dot: AMBER_DOT },
  repair_queued: { label: "Repair queued", dot: AMBER_DOT },
  repairing: { label: "Repairing", dot: AMBER_DOT },
  validating: { label: "Validating", dot: AMBER_DOT },
  repair_proposed: { label: "Repair proposed", dot: GREEN_DOT },
  repair_failed: { label: "Repair failed", dot: RED_DOT },
};

export const VERDICT_LABEL: Record<string, string> = {
  impacted: "Impacted",
  not_impacted: "Not impacted",
  uncertain: "Uncertain",
};

export const CLUSTER_STATUS: Record<string, { label: string; dot: string }> = {
  open: { label: "Open", dot: NEUTRAL_DOT },
  triggered: { label: "Triggered", dot: AMBER_DOT },
  pr_open: { label: "PR open", dot: GREEN_DOT },
  dismissed: { label: "Dismissed", dot: NEUTRAL_DOT },
};

export const SESSION_STATUS_LABEL: Record<string, string> = {
  launching: "Launching",
  working: "Working",
  blocked: "Blocked",
  resumed: "Resumed",
  finished: "Finished",
  expired: "Expired",
  stopped: "Stopped",
  launch_failed: "Launch failed",
};

export function incidentStatus(status: string) {
  return INCIDENT_STATUS[status] ?? { label: status, dot: NEUTRAL_DOT };
}

export function clusterStatus(status: string) {
  return CLUSTER_STATUS[status] ?? { label: status, dot: NEUTRAL_DOT };
}

export function sessionStatusLabel(status: string) {
  return SESSION_STATUS_LABEL[status] ?? status;
}

export function testDot(testStatus: "passed" | "failed" | "unknown" | undefined) {
  return testStatus === "passed"
    ? GREEN_DOT
    : testStatus === "failed"
      ? RED_DOT
      : NEUTRAL_DOT;
}
