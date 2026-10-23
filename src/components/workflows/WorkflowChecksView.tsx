/**
 * Regression checks for one workflow.
 *
 * A dataset is a saved trigger payload plus what the run should produce, so a
 * change can be validated before it is published. Rebuilt on the platform's
 * shared skeleton, empty and error treatments so this tab reads like the rest
 * of the module rather than a third card style.
 */
import { useState } from "react";
import { ClipboardCheck, CircleAlert, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowEvaluationCase } from "@/lib/workflows";
import { cn } from "@/lib/utils";

export type WorkflowCheckDataset = {
  id: string;
  workflowId: string;
  name: string;
  cases: WorkflowEvaluationCase[];
  lastRun?: { score: number } | null;
};

const scoreTone = (score: number) =>
  score >= 100
    ? "text-emerald-700 dark:text-emerald-400"
    : score >= 60
      ? "text-amber-700 dark:text-amber-400"
      : "text-destructive";

export function WorkflowChecksView({
  workflowName,
  datasets,
  loading,
  error,
  onRefresh,
  onSave,
  onRun,
}: {
  workflowName: string;
  datasets: WorkflowCheckDataset[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onSave: (input: {
    id?: string;
    name: string;
    cases: WorkflowEvaluationCase[];
  }) => Promise<void>;
  onRun: (datasetId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [payload, setPayload] = useState('{"email":"test@example.com"}');
  const [assertion, setAssertion] = useState("completedNodes");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [payloadError, setPayloadError] = useState("");

  const createDataset = async () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
      setPayloadError("");
    } catch {
      // Shown on the field rather than only as a toast, so the invalid value
      // and the reason it is invalid are visible together.
      setPayloadError("This is not valid JSON.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim() || `${workflowName} checks`,
        cases: [
          {
            id: `case-${Math.random().toString(36).slice(2, 10)}`,
            name: "Happy path",
            input: parsed,
            assertions: [{ path: assertion.trim() || "completedNodes", operator: "exists" }],
          },
        ],
      });
      setName("");
      toast.success("Check saved.");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : "This check could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const runDataset = async (datasetId: string) => {
    setRunning(datasetId);
    try {
      await onRun(datasetId);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-semibold">Regression checks</h3>
            <p className="text-[12px] text-muted-foreground">
              Replay a saved payload without side effects before publishing a change.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          {error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <CircleAlert className="h-5 w-5 text-destructive" />
              <p className="text-[13px] font-medium">Checks could not be loaded</p>
              <p className="text-[12px] text-muted-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                Try again
              </Button>
            </div>
          ) : loading ? (
            <div className="space-y-2 p-3" aria-hidden="true">
              {[0, 1].map((index) => (
                <div key={index} className="flex items-center gap-3 px-2 py-2">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-44" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
              ))}
            </div>
          ) : datasets.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <ClipboardCheck className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[13px] font-medium">No checks yet</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Add a sample payload alongside to record the first one.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {datasets.map((dataset) => (
                <li
                  key={dataset.id}
                  className="flex flex-wrap items-center gap-3 px-3.5 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">
                      {dataset.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {dataset.cases.length} case
                      {dataset.cases.length === 1 ? "" : "s"}
                      {dataset.lastRun
                        ? " · last scored "
                        : " · not run yet"}
                      {dataset.lastRun && (
                        <span className={cn("font-medium", scoreTone(dataset.lastRun.score))}>
                          {dataset.lastRun.score}%
                        </span>
                      )}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0"
                    disabled={running === dataset.id}
                    onClick={() => void runDataset(dataset.id)}
                  >
                    {running === dataset.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Run
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <aside className="space-y-3 rounded-lg border border-border p-3.5">
        <div>
          <h3 className="text-[13px] font-semibold">New check</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Runs in dry-run mode, so no action leaves the workspace.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium" htmlFor="workflow-check-name">
            Name
          </label>
          <Input
            id="workflow-check-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`${workflowName} checks`}
            className="h-9 text-[12.5px]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium" htmlFor="workflow-check-payload">
            Sample trigger payload
          </label>
          <Textarea
            id="workflow-check-payload"
            value={payload}
            onChange={(event) => {
              setPayload(event.target.value);
              if (payloadError) setPayloadError("");
            }}
            rows={5}
            spellCheck={false}
            aria-invalid={payloadError ? true : undefined}
            aria-describedby={payloadError ? "workflow-check-payload-error" : undefined}
            className={cn(
              "font-mono text-[11.5px]",
              payloadError && "border-destructive focus-visible:ring-destructive/30",
            )}
          />
          {payloadError && (
            <p
              id="workflow-check-payload-error"
              className="text-[11.5px] text-destructive"
            >
              {payloadError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium" htmlFor="workflow-check-assertion">
            Output field that must exist
          </label>
          <Input
            id="workflow-check-assertion"
            value={assertion}
            onChange={(event) => setAssertion(event.target.value)}
            placeholder="completedNodes"
            className="h-9 font-mono text-[12.5px]"
          />
        </div>

        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={saving}
          onClick={() => void createDataset()}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save check
        </Button>
      </aside>
    </div>
  );
}

export default WorkflowChecksView;
