/**
 * PolicyDiff — TASK-11G + TASK-11H.
 *
 * Renders a row-level diff between two policy configurations applied to
 * the same population:
 *
 *   - Applications newly approved (count + $ + clickable IDs)
 *   - Applications newly denied (count + $ + clickable IDs)
 *   - Applications with reduced approved amount (count + total reduction $ + IDs)
 *
 * Used in two contexts:
 *   - TASK-11G: live diff while the user adjusts policy parameters
 *     (compare current saved config vs proposed-in-UI config)
 *   - TASK-11H: compare a draft policy against the currently published
 *     policy on the Exposure Control / Projected Simulation pages
 *
 * Backend: POST /simulate/diff
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { MetricValue } from "@/components/ui/MetricValue";
import { cn } from "@/lib/utils";

interface PolicyParams {
    cutoff: number;
    amount_ladder?: Record<string, number> | null;
    label?: string;
}

interface PolicyDiffProps {
    datasetId: string;
    modelId: string;
    policyA: PolicyParams;
    policyB: PolicyParams;
    /** Suppress the panel if both policies are identical (saves an API call) */
    skipIfIdentical?: boolean;
    /** Override the panel title */
    title?: string;
    className?: string;
}

interface DiffResponse {
    newly_approved_count: number;
    newly_approved_dollars: number | null;
    newly_approved_ids: string[];
    newly_denied_count: number;
    newly_denied_dollars: number | null;
    newly_denied_ids: string[];
    reduced_amount_count: number;
    reduced_amount_total_reduction: number | null;
    reduced_amount_ids: string[];
    policy_a: any;
    policy_b: any;
    policy_a_label: string;
    policy_b_label: string;
    id_column?: string | null;
    has_real_ids?: boolean;
}

export function PolicyDiff({
    datasetId,
    modelId,
    policyA,
    policyB,
    skipIfIdentical = true,
    title = "What changed",
    className,
}: PolicyDiffProps) {
    const [expandedBucket, setExpandedBucket] = useState<string | null>(null);

    const identical =
        policyA.cutoff === policyB.cutoff &&
        JSON.stringify(policyA.amount_ladder || {}) === JSON.stringify(policyB.amount_ladder || {});

    const enabled = !!datasetId && !!modelId && !(skipIfIdentical && identical);

    const { data, isLoading, error } = useQuery<DiffResponse>({
        queryKey: ["policy-diff", datasetId, modelId, policyA, policyB],
        queryFn: async () => {
            const res = await api.post("/simulate/diff", {
                dataset_id: datasetId,
                model_id: modelId,
                policy_a: policyA,
                policy_b: policyB,
            });
            return res.data;
        },
        enabled,
        staleTime: 30 * 1000,
    });

    if (skipIfIdentical && identical) {
        return null;
    }

    if (isLoading) {
        return (
            <div className={cn("panel p-4 flex items-center gap-3 text-muted-foreground text-sm", className)}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Computing diff...
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className={cn("panel p-4 border-down/30 bg-down/5 flex items-start gap-2", className)}>
                <AlertTriangle className="h-4 w-4 text-down shrink-0 mt-0.5" />
                <p className="text-sm text-down">
                    {(error as any)?.response?.data?.detail || "Failed to compute diff."}
                </p>
            </div>
        );
    }

    const totalChanges =
        data.newly_approved_count + data.newly_denied_count + data.reduced_amount_count;

    return (
        <div className={cn("panel border-info/20 bg-info/[0.02]", className)}>
            <div className="panel-head">
                <div>
                    <span className="panel-title">{title}</span>
                    <p className="text-2xs text-muted-foreground mt-0.5">
                        {data.policy_a_label} <ArrowRight className="inline h-3 w-3 mx-1" /> {data.policy_b_label}
                        {totalChanges === 0 && " — no applicants moved"}
                    </p>
                </div>
                {totalChanges > 0 && (
                    <span className="badge badge-blue text-xs">
                        <MetricValue type="count" value={totalChanges} /> applicants moved
                    </span>
                )}
            </div>

            {totalChanges === 0 ? (
                <div className="p-5 text-center text-sm text-muted-foreground">
                    No applicants change decision between these two configurations.
                </div>
            ) : (
                <div className="p-3 space-y-2">
                    <DiffBucket
                        kind="newly_approved"
                        icon={<TrendingUp className="h-4 w-4" />}
                        label="Newly approved"
                        helper="approved by proposed, denied by current"
                        count={data.newly_approved_count}
                        dollars={data.newly_approved_dollars}
                        ids={data.newly_approved_ids}
                        polarity="favorable_when_higher"
                        expanded={expandedBucket === "newly_approved"}
                        onToggle={() => setExpandedBucket(expandedBucket === "newly_approved" ? null : "newly_approved")}
                        idColumn={data.id_column}
                        hasRealIds={data.has_real_ids}
                    />
                    <DiffBucket
                        kind="newly_denied"
                        icon={<TrendingDown className="h-4 w-4" />}
                        label="Newly denied"
                        helper="approved by current, denied by proposed"
                        count={data.newly_denied_count}
                        dollars={data.newly_denied_dollars}
                        ids={data.newly_denied_ids}
                        polarity="favorable_when_lower"
                        expanded={expandedBucket === "newly_denied"}
                        onToggle={() => setExpandedBucket(expandedBucket === "newly_denied" ? null : "newly_denied")}
                        idColumn={data.id_column}
                        hasRealIds={data.has_real_ids}
                    />
                    <DiffBucket
                        kind="reduced_amount"
                        icon={<Minus className="h-4 w-4" />}
                        label="Reduced approved amount"
                        helper="approved by both, but lower amount under proposed"
                        count={data.reduced_amount_count}
                        dollars={data.reduced_amount_total_reduction}
                        dollarLabel="total reduction"
                        ids={data.reduced_amount_ids}
                        polarity="neutral"
                        expanded={expandedBucket === "reduced_amount"}
                        onToggle={() => setExpandedBucket(expandedBucket === "reduced_amount" ? null : "reduced_amount")}
                        idColumn={data.id_column}
                        hasRealIds={data.has_real_ids}
                    />
                </div>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// DiffBucket — one row of the diff panel
// ────────────────────────────────────────────────────────────────────────

function DiffBucket({
    icon,
    label,
    helper,
    count,
    dollars,
    dollarLabel,
    ids,
    polarity,
    expanded,
    onToggle,
    idColumn,
    hasRealIds,
}: {
    kind: string;
    icon: React.ReactNode;
    label: string;
    helper: string;
    count: number;
    dollars: number | null;
    dollarLabel?: string;
    ids: string[];
    polarity: "favorable_when_lower" | "favorable_when_higher" | "neutral";
    expanded: boolean;
    onToggle: () => void;
    idColumn?: string | null;
    hasRealIds?: boolean;
}) {
    const tone =
        count === 0 ? "muted" :
        polarity === "favorable_when_higher" ? "up" :
        polarity === "favorable_when_lower" ? "down" : "info";

    return (
        <div className={cn(
            "rounded border",
            count === 0
                ? "border-border bg-muted/10"
                : tone === "up"   ? "border-up/30 bg-up/5" :
                  tone === "down" ? "border-down/30 bg-down/5" :
                                    "border-info/30 bg-info/5",
        )}>
            <button
                onClick={onToggle}
                disabled={count === 0}
                className="w-full p-3 flex items-center justify-between text-left disabled:cursor-default"
            >
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "icon-box-sm",
                        tone === "up"   ? "bg-up/15 text-up" :
                        tone === "down" ? "bg-down/15 text-down" :
                        tone === "info" ? "bg-info/15 text-info" :
                                          "bg-muted text-muted-foreground"
                    )}>
                        {icon}
                    </div>
                    <div>
                        <p className="text-sm font-semibold">{label}</p>
                        <p className="text-2xs text-muted-foreground">{helper}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-sm font-bold">
                            <MetricValue type="count" value={count} />
                        </p>
                        {dollars !== null && (
                            <p className="text-2xs text-muted-foreground">
                                <MetricValue type="currency" value={dollars} /> {dollarLabel || ""}
                            </p>
                        )}
                    </div>
                    {count > 0 && (
                        expanded
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                </div>
            </button>
            {expanded && count > 0 && (
                <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-border/50">
                    <p className="text-2xs text-muted-foreground">
                        {hasRealIds
                            ? <>Showing first {ids.length} of {count} (column: <span className="font-mono">{idColumn}</span>)</>
                            : <>Showing first {ids.length} of {count} (no ID column tagged — using row index. Tag one on the dataset for real IDs.)</>}
                    </p>
                    <div className="flex flex-wrap gap-1 font-mono text-2xs">
                        {ids.map((id) => (
                            <span key={id} className="px-1.5 py-0.5 rounded bg-background border">
                                {id}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
