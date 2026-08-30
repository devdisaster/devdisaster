// Frontend data-contract boundary: every dashboard region reads Convex
// exclusively through these hooks, so backend renames stay one-line fixes.
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type Overview = FunctionReturnType<typeof api.dashboard.overview>;
export type Signal = FunctionReturnType<
  typeof api.dashboard.listSignals
>[number];
export type IncidentRow = FunctionReturnType<
  typeof api.dashboard.listIncidents
>[number];
export type ClusterRow = FunctionReturnType<
  typeof api.dashboard.listClusters
>[number];
export type SessionSummary = NonNullable<IncidentRow["session"]>;

export type IncidentDetail = {
  incident: {
    _id: Id<"incidents">;
    title: string;
    status: string;
    verdict?: string;
    reason?: string;
    endpoint?: string;
    docsEvidence: string[];
    codeEvidence: string[];
    createdAt: number;
  };
  integration: {
    name: string;
    provider: string;
    endpoint: string;
    integrationPath: string;
    expectedContract: string;
  } | null;
  triggers: { _id: string; source: "docs" | "runtime"; summary: string; at: number }[];
  docChanges: {
    _id: string;
    summary: string;
    url: string;
    isBreaking: boolean;
    affectedEndpoints: string[];
    at: number;
  }[];
  errors: {
    _id: string;
    message: string;
    endpoint?: string;
    statusCode?: number;
    contractVersion?: string;
    at: number;
  }[];
  timeline: {
    _id: string;
    message: string;
    level: "info" | "warn" | "critical";
    sentinel: string;
    at: number;
  }[];
  session: SessionSummary | null;
} | null;

export type ClusterDetail = {
  cluster: {
    _id: Id<"clusters">;
    title: string;
    summary: string;
    kind: string;
    count: number;
    threshold: number;
    status: string;
    createdAt: number;
  };
  reviews: {
    _id: string;
    source: "reddit" | "board" | "seed";
    author: string;
    rating?: number;
    text: string;
    url?: string;
    at: number;
  }[];
  session: SessionSummary | null;
} | null;

export function useOverview() {
  return useQuery(api.dashboard.overview, {});
}

export function useSignals() {
  return useQuery(api.dashboard.listSignals, {});
}

export function useIncidents() {
  return useQuery(api.dashboard.listIncidents, {});
}

export function useIncidentDetail(incidentId: Id<"incidents"> | null) {
  return useQuery(
    api.dashboard.incidentDetail,
    incidentId ? { incidentId } : "skip",
  ) as IncidentDetail | undefined;
}

export function useClusters() {
  return useQuery(api.dashboard.listClusters, {});
}

export function useClusterDetail(clusterId: Id<"clusters"> | null) {
  return useQuery(
    api.dashboard.clusterDetail,
    clusterId ? { clusterId } : "skip",
  ) as ClusterDetail | undefined;
}
