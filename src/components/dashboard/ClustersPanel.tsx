import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo, timestampLabel } from "@/lib/format";
import { useClusterDetail, useClusters, type ClusterRow } from "./hooks";
import {
  clusterStatus,
  sessionStatusLabel,
  testDot,
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
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${ratio >= 1 ? "bg-amber-500" : "bg-muted-foreground/60"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
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
        <p className="text-[13px] text-foreground">
          {cluster.summary}
        </p>
      </DrawerSection>

      <DrawerSection title={`Complaint evidence (${reviews.length})`}>
        {reviews.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No complaints are linked to this cluster yet.
          </p>
        ) : (
          reviews.map((review) => (
            <div key={review._id} className="rounded-lg bg-muted px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {review.author} · {review.source}
                  {review.rating !== undefined ? ` · ${review.rating}★` : ""}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {timestampLabel(review.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-foreground">
                {review.text}
              </p>
              {review.url ? (
                <a
                  href={review.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
              <Pill dot={testDot(session.testStatus)}>
                Tests: {session.testStatus ?? "not reported"}
              </Pill>
              <a
                href={session.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
              >
                {session.prNumber ? `PR #${session.prNumber}` : "View PR"}
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            </div>
            {session.devinUrl ? (
              <a
                href={session.devinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Open Devin session
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
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
        className={cn(
          "flex w-full min-h-11 cursor-pointer items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <StatusDot className={`mt-1.5 ${status.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground">
            {cluster.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
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
            className="inline-flex shrink-0 items-center gap-1 self-center text-[13px] text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
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
    <Card className="overflow-hidden">
      <CardHeader className="flex h-12 flex-row items-center justify-between gap-3 bg-muted/60 py-0">
        <CardTitle className="text-sm font-medium text-foreground">
          Feedback clusters
        </CardTitle>
        {clusters !== undefined ? (
          <CardAction className="inline-flex h-5 shrink-0 items-center rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
            {clusters.length}
          </CardAction>
        ) : null}
      </CardHeader>
      {clusters === undefined ? (
        <CardContent className="p-1.5">
          <PanelLoading rows={3} />
        </CardContent>
      ) : clusters.length === 0 ? (
        <CardContent className="p-0">
          <PanelEmpty
            title="No feedback clusters yet"
            hint="Scraped complaints will be clustered here once the feedback agent runs."
          />
        </CardContent>
      ) : (
        <CardContent className="p-1.5">
          <ul className="flex flex-col gap-1.5">
            {clusters.map((cluster) => (
              <ClusterRowItem
                key={cluster._id}
                cluster={cluster}
                onOpen={() => setOpenId(cluster._id)}
              />
            ))}
          </ul>
        </CardContent>
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
    </Card>
  );
}
