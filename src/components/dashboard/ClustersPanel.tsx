import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo, timestampLabel } from "@/lib/format";
import { useClusterDetail, useClusters, type ClusterRow } from "./hooks";
import {
  clusterStatus,
  sessionStatusLabel,
  AMBER_DOT,
  GREEN_DOT,
} from "./status";
import {
  Drawer,
  DrawerSection,
  PanelEmpty,
  PanelLoading,
  Pill,
  StatusDot,
} from "./primitives";

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature request",
  other: "Other",
};

function ThresholdMeter({ count, threshold }: { count: number; threshold: number }) {
  const ratio = threshold > 0 ? Math.min(count / threshold, 1) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={Math.min(count, threshold)}
        aria-label="Complaints toward threshold"
        className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div
          className={`h-full rounded-full ${ratio >= 1 ? "bg-amber-500" : "bg-neutral-400 dark:bg-neutral-500"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-neutral-500">
        {count}/{threshold}
      </span>
    </div>
  );
}

function ClusterDrawerBody({ clusterId }: { clusterId: Id<"clusters"> }) {
  const detail = useClusterDetail(clusterId);
  if (detail === undefined) return <PanelLoading rows={4} />;
  if (detail === null) return <PanelEmpty title="This cluster no longer exists." />;
  const { cluster, reviews, session } = detail;

  return (
    <>
      <DrawerSection title="Cluster">
        <div className="flex flex-wrap items-center gap-2">
          <Pill dot={clusterStatus(cluster.status).dot}>
            {clusterStatus(cluster.status).label}
          </Pill>
          <Pill>{KIND_LABEL[cluster.kind] ?? cluster.kind}</Pill>
          <ThresholdMeter count={cluster.count} threshold={cluster.threshold} />
        </div>
        <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
          {cluster.summary}
        </p>
      </DrawerSection>

      <DrawerSection title={`Complaint evidence (${reviews.length})`}>
        {reviews.length === 0 ? (
          <p className="text-[13px] text-neutral-500">
            No complaints are linked to this cluster yet.
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review._id} className="rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-500">
                  {review.author} · {review.source}
                  {review.rating !== undefined ? ` · ${review.rating}★` : ""}
                </span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {timestampLabel(review.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-neutral-700 dark:text-neutral-300">
                {review.text}
              </p>
              {review.url ? (
                <a
                  href={review.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  View source
                  <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Devin session">
        {session ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Pill dot={session.prUrl ? GREEN_DOT : AMBER_DOT}>
                {sessionStatusLabel(session.status)}
              </Pill>
              {session.prUrl ? (
                <a
                  href={session.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600"
                >
                  {session.prNumber ? `PR #${session.prNumber}` : "View PR"}
                  <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-[13px] text-neutral-500">No PR yet</span>
              )}
            </div>
            {session.devinUrl ? (
              <a
                href={session.devinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-neutral-600 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Open Devin session
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-neutral-500">
            No Devin session yet — one launches when the cluster crosses its
            complaint threshold.
          </p>
        )}
      </DrawerSection>
    </>
  );
}

function ClusterRowItem({
  cluster,
  onOpen,
}: {
  cluster: ClusterRow;
  onOpen: () => void;
}) {
  const status = clusterStatus(cluster.status);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-h-11 cursor-pointer items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-neutral-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800/50 dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
      >
        <StatusDot className={`mt-1.5 ${status.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
            {cluster.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {status.label} · {KIND_LABEL[cluster.kind] ?? cluster.kind} ·{" "}
            {timeAgo(cluster.createdAt)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ThresholdMeter count={cluster.count} threshold={cluster.threshold} />
            {cluster.session ? (
              <Pill dot={cluster.session.prUrl ? GREEN_DOT : AMBER_DOT}>
                Devin: {sessionStatusLabel(cluster.session.status)}
              </Pill>
            ) : null}
          </div>
        </div>
        {cluster.session?.prUrl ? (
          <a
            href={cluster.session.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 self-center text-[13px] text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600"
          >
            {cluster.session.prNumber
              ? `PR #${cluster.session.prNumber}`
              : "View PR"}
            <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        ) : null}
      </button>
    </li>
  );
}

export function ClustersPanel() {
  const clusters = useClusters();
  const [openId, setOpenId] = useState<Id<"clusters"> | null>(null);
  const openCluster = clusters?.find((cluster) => cluster._id === openId);

  return (
    <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-12 items-center justify-between bg-neutral-50 px-4 dark:bg-neutral-900/60">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Feedback clusters
        </h2>
        {clusters !== undefined ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {clusters.length}
          </span>
        ) : null}
      </div>
      {clusters === undefined ? (
        <PanelLoading rows={3} />
      ) : clusters.length === 0 ? (
        <PanelEmpty
          title="No feedback clusters yet"
          hint="Scraped complaints will be clustered here once the feedback agent runs."
        />
      ) : (
        <ul className="flex flex-col gap-1.5 p-1.5">
          {clusters.map((cluster) => (
            <ClusterRowItem
              key={cluster._id}
              cluster={cluster}
              onOpen={() => setOpenId(cluster._id)}
            />
          ))}
        </ul>
      )}
      <Drawer
        open={openId !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        title={openCluster?.title ?? "Feedback cluster"}
        subtitle={
          openCluster ? (
            <span className="inline-flex items-center gap-1.5">
              <StatusDot className={clusterStatus(openCluster.status).dot} />
              {clusterStatus(openCluster.status).label} ·{" "}
              {timestampLabel(openCluster.createdAt)}
            </span>
          ) : undefined
        }
      >
        {openId ? <ClusterDrawerBody clusterId={openId} /> : null}
      </Drawer>
    </div>
  );
}
