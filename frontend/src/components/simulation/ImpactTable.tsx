/**
 * ImpactTable — TASK-3 full impact table.
 *
 * Renders a 3-stage comparison table (Baseline / Policy Cuts / Cuts + Ladder)
 * with all 10 metrics from the spec, plus a Δ vs Baseline column. Pulls
 * data from POST /simulate/portfolio. Adds CSV export and the audit info
 * panel.
 *
 * Used by:
 *   - ExposureControl page (TASK-3 — primary use)
 *   - Future TASK-7 reuse with different column labels
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, AlertTriangle, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { ComparisonTable } from "@/components/ui/ComparisonTable";
import type {
    ComparisonColumn,
    ComparisonRow,
} from "@/components/ui/ComparisonTable";
import { AuditInfo } from "@/components/ui/AuditInfo";
import type { AuditMeta } from "@/components/ui/AuditInfo";
import { MetricValue, formatMetric } from "@/components/ui/MetricValue";
import { cn } from "@/lib/utils";

interface SimulateResponse {
    baseline: any;
    policy_cuts: any;
    policy_cuts_ladder: any;
    deltas_vs_baseline: any[];
    n_rows_total: number;
    n_rows_unscoreable: number;
    has_dollar_metrics: boolean;
    meta: AuditMeta;
}

interface ImpactTableProps {
    datasetId: string;
    modelId: string;
    cutoff: number;
    amountLadder?: Record<string, number> | null;
    /** Title shown above the table. */
    title?: string;
    /** Optional helper text below the title. */
    description?: string;
    /** TASK-11F: list of segmenting dimensions tagged on the dataset.
     *  When provided, shows a "Break out by segment" dropdown that
     *  expands the table to per-segment rows. */
    segmentingDimensions?: string[] | null;
    className?: string;
}

export function ImpactTable({
    datasetId,
    modelId,
    cutoff,
    amountLadder,
    title = "Full Impact Analysis",
    description,
    segmentingDimensions,
    className,
}: ImpactTableProps) {
    const [breakoutDimension, setBreakoutDimension] = useState<string>("");
    const enabled = !!datasetId && !!modelId && cutoff !== undefined && cutoff !== null;

    const { data, isLoading, isFetching, error } = useQuery<SimulateResponse>({
        queryKey: ["simulate", datasetId, modelId, cutoff, amountLadder],
        queryFn: async () => {
            const res = await api.post("/simulate/portfolio", {
                dataset_id: datasetId,
                model_id: modelId,
                cutoff,
                amount_ladder: amountLadder || null,
            });
            return res.data;
        },
        enabled,
        // Treat the first 60s as fresh — same inputs return cached on the
        // server side anyway, so this just avoids client double-requests.
        staleTime: 60 * 1000,
    });

    // TASK-11F: per-segment breakout data, fetched only when the user
    // toggles a dimension via the dropdown.
    const { data: breakoutData, isFetching: breakoutFetching } = useQuery<{
        dimension: string;
        stage: string;
        segments: Array<{
            segment_label: string;
            segment_value: string;
            n_applications: number;
            metrics: any;
        }>;
    }>({
        queryKey: ["simulate-breakout", datasetId, modelId, cutoff, amountLadder, breakoutDimension],
        queryFn: async () => {
            const res = await api.post("/simulate/breakout", {
                dataset_id: datasetId,
                model_id: modelId,
                cutoff,
                amount_ladder: amountLadder || null,
                dimension: breakoutDimension,
                stage: "policy_cuts_ladder",
            });
            return res.data;
        },
        enabled: enabled && !!breakoutDimension,
        staleTime: 60 * 1000,
    });

    const handleExportCsv = () => {
        if (!data) return;
        downloadCsv(data, title);
    };

    if (!enabled) {
        return (
            <div className={cn("panel p-6 text-center text-muted-foreground text-sm", className)}>
                Select a dataset and model to view the impact analysis.
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={cn("panel p-12 flex flex-col items-center gap-3 text-muted-foreground", className)}>
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Scoring rows and computing simulation...</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className={cn("panel p-6 border-down/30 bg-down/5 flex items-start gap-3", className)}>
                <AlertTriangle className="h-5 w-5 text-down shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-semibold text-down">Simulation failed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {(error as any)?.response?.data?.detail || "Unable to compute impact metrics."}
                    </p>
                </div>
            </div>
        );
    }

    const columns: ComparisonColumn[] = [
        { label: "Baseline", sublabel: "approve all at requested" },
        { label: "After Policy Cuts", sublabel: "cutoff applied" },
        {
            label: "After Policy + Ladder",
            sublabel: "cuts + amount caps",
            highlighted: true,
        },
    ];

    const rows = buildRows(data);

    return (
        <div className={cn("panel", className)}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">{title}</h3>
                    {description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* TASK-11F: segment breakout toggle */}
                    {segmentingDimensions && segmentingDimensions.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                            <select
                                value={breakoutDimension}
                                onChange={(e) => setBreakoutDimension(e.target.value)}
                                className="text-xs bg-background border rounded px-2 py-1"
                                title="Break out the production-equivalent stage by a segmenting dimension"
                            >
                                <option value="">No breakout</option>
                                {segmentingDimensions.map((d) => (
                                    <option key={d} value={d}>By {d}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {(isFetching || breakoutFetching) && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                    <button
                        onClick={handleExportCsv}
                        className="btn-ghost btn-xs flex items-center gap-1.5"
                        title="Download CSV with audit metadata header"
                    >
                        <Download className="h-3.5 w-3.5" />
                        CSV
                    </button>
                </div>
            </div>
            <div className="p-5 space-y-4">
                <ComparisonTable columns={columns} rows={rows} />
                <p className="text-[10px] text-muted-foreground italic">
                    {data.meta.loss_mode_footnote}
                    {!data.has_dollar_metrics &&
                        " Dollar metrics show as '—' until you tag an approved-amount column on the dataset."}
                </p>

                {/* TASK-11F: per-segment breakdown (production-equivalent stage) */}
                {breakoutDimension && breakoutData && (
                    <SegmentBreakoutPanel data={breakoutData} />
                )}

                <AuditInfo meta={data.meta} />
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// SegmentBreakoutPanel — per-segment metric grid
// ────────────────────────────────────────────────────────────────────────

function SegmentBreakoutPanel({ data }: {
    data: {
        dimension: string;
        stage: string;
        segments: Array<{
            segment_label: string;
            segment_value: string;
            n_applications: number;
            metrics: any;
        }>;
    };
}) {
    const segments = data.segments;
    if (!segments.length) {
        return (
            <div className="panel p-4 text-sm text-muted-foreground">
                No data for breakout dimension '{data.dimension}'.
            </div>
        );
    }

    // Sum row for reconciliation visibility (TASK-11B)
    const totals = {
        n_applications: segments.reduce((s, r) => s + r.n_applications, 0),
        approval_count: segments.reduce((s, r) => s + (r.metrics.approval_count || 0), 0),
        total_approved_dollars: segments.reduce((s, r) => s + (r.metrics.total_approved_dollars || 0), 0),
        total_predicted_loss_dollars: segments.reduce((s, r) => s + (r.metrics.total_predicted_loss_dollars || 0), 0),
    };

    return (
        <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    Production-equivalent metrics by {data.dimension}
                </p>
                <p className="text-2xs text-muted-foreground">
                    Σ segment metrics = portfolio total (TASK-11B reconciliation rule)
                </p>
            </div>
            <table className="dt text-xs">
                <thead>
                    <tr>
                        <th>{data.dimension}</th>
                        <th className="text-right">Apps</th>
                        <th className="text-right">Approvals</th>
                        <th className="text-right">Approval rate</th>
                        <th className="text-right">Approved $</th>
                        <th className="text-right">Predicted loss $</th>
                        <th className="text-right">Loss rate ($)</th>
                    </tr>
                </thead>
                <tbody>
                    {segments.map((seg) => (
                        <tr key={seg.segment_value}>
                            <td className="font-medium">{seg.segment_value}</td>
                            <td className="text-right">
                                <MetricValue type="count" value={seg.n_applications} />
                            </td>
                            <td className="text-right">
                                <MetricValue type="count" value={seg.metrics.approval_count} />
                            </td>
                            <td className="text-right">
                                <MetricValue type="percent" value={seg.metrics.approval_rate} />
                            </td>
                            <td className="text-right">
                                <MetricValue type="currency" value={seg.metrics.total_approved_dollars} />
                            </td>
                            <td className="text-right">
                                <MetricValue type="currency" value={seg.metrics.total_predicted_loss_dollars} />
                            </td>
                            <td className="text-right">
                                <MetricValue type="percent" value={seg.metrics.predicted_loss_rate_dollars} />
                            </td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-foreground/20 font-semibold bg-muted/20">
                        <td>Total</td>
                        <td className="text-right">
                            <MetricValue type="count" value={totals.n_applications} />
                        </td>
                        <td className="text-right">
                            <MetricValue type="count" value={totals.approval_count} />
                        </td>
                        <td className="text-right">—</td>
                        <td className="text-right">
                            <MetricValue type="currency" value={totals.total_approved_dollars} />
                        </td>
                        <td className="text-right">
                            <MetricValue type="currency" value={totals.total_predicted_loss_dollars} />
                        </td>
                        <td className="text-right">—</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Build rows from the simulation response
// ────────────────────────────────────────────────────────────────────────

function buildRows(data: SimulateResponse): ComparisonRow[] {
    const b = data.baseline;
    const c = data.policy_cuts;
    const l = data.policy_cuts_ladder;

    return [
        {
            label: "Total Applications",
            type: "count",
            values: [b.total_applications, c.total_applications, l.total_applications],
            suppressDelta: true,
        },
        {
            label: "Total Approvals",
            type: "count",
            values: [b.approval_count, c.approval_count, l.approval_count],
            // Lower approvals after cuts is intentional / by design
            deltaPolarity: "neutral",
        },
        {
            label: "Approval Rate",
            type: "percent",
            values: [b.approval_rate, c.approval_rate, l.approval_rate],
            deltaPolarity: "neutral",
        },
        {
            label: "Total Approved $",
            type: "currency",
            values: [
                b.total_approved_dollars,
                c.total_approved_dollars,
                l.total_approved_dollars,
            ],
            deltaPolarity: "neutral", // intentional reduction
        },
        {
            label: "Avg Approved $",
            type: "currency",
            values: [
                b.avg_approved_dollars,
                c.avg_approved_dollars,
                l.avg_approved_dollars,
            ],
            deltaPolarity: "neutral",
        },
        {
            label: "Total Predicted Loss (count)",
            type: "count",
            values: [
                Math.round(b.predicted_loss_count),
                Math.round(c.predicted_loss_count),
                Math.round(l.predicted_loss_count),
            ],
            deltaPolarity: "favorable_when_lower",
        },
        {
            label: "Predicted Loss Rate (count)",
            type: "percent",
            values: [
                b.predicted_loss_rate_count,
                c.predicted_loss_rate_count,
                l.predicted_loss_rate_count,
            ],
            deltaPolarity: "favorable_when_lower",
        },
        {
            label: "Total Predicted Loss $",
            type: "currency",
            values: [
                b.total_predicted_loss_dollars,
                c.total_predicted_loss_dollars,
                l.total_predicted_loss_dollars,
            ],
            deltaPolarity: "favorable_when_lower",
        },
        {
            label: "Predicted Loss Rate ($)",
            type: "percent",
            values: [
                b.predicted_loss_rate_dollars,
                c.predicted_loss_rate_dollars,
                l.predicted_loss_rate_dollars,
            ],
            deltaPolarity: "favorable_when_lower",
        },
        {
            label: "Net Risk-Adjusted $",
            type: "currency",
            values: [
                b.net_risk_adjusted_dollars,
                c.net_risk_adjusted_dollars,
                l.net_risk_adjusted_dollars,
            ],
            deltaPolarity: "favorable_when_higher",
        },
    ];
}

// ────────────────────────────────────────────────────────────────────────
// CSV export — TASK-11I format (audit metadata header, then data)
// ────────────────────────────────────────────────────────────────────────

function downloadCsv(data: SimulateResponse, title: string) {
    const meta = data.meta;
    const lines: string[] = [];

    // Per TASK-11I: first 5 rows are metadata, then blank line, then column
    // headers, then data.
    lines.push(`# Sentinel ${title} — exported ${meta.computed_at}`);
    lines.push(
        `# Dataset: ${meta.dataset_filename || "?"} (${meta.dataset_row_count || "?"} rows, hash ${meta.dataset_content_hash || "?"})`,
    );
    lines.push(`# Model: ${meta.model_name || "?"} · ${meta.model_algorithm || "?"}`);
    lines.push(
        `# Policy: cutoff=${meta.policy_cutoff?.toFixed(3)} · ladder=${meta.policy_has_ladder ? "yes" : "no"}`,
    );
    lines.push(
        `# Loss mode: ${meta.loss_mode} (${meta.loss_mode_footnote || ""})`,
    );
    lines.push(""); // blank separator

    lines.push(["Metric", "Baseline", "Policy Cuts", "Policy + Ladder", "Δ vs Baseline"].join(","));

    const rows = buildRows(data);
    for (const row of rows) {
        const cells = [
            row.label,
            ...row.values.map((v) => formatMetric(row.type, v ?? null, "full") || ""),
        ];
        // Δ
        const baseline = row.values[0];
        const final = row.values[row.values.length - 1];
        if (
            baseline !== null && baseline !== undefined &&
            final !== null && final !== undefined &&
            !row.suppressDelta
        ) {
            cells.push(formatMetric(row.type === "percent" ? "percent-points" : row.type,
                final - baseline, "full") || "");
        } else {
            cells.push("");
        }
        // Quote any cell containing a comma
        lines.push(cells.map((c) => (c.includes(",") ? `"${c}"` : c)).join(","));
    }

    const filename = `sentinel_impact_${meta.dataset_id?.slice(0, 8) || "x"}_${
        meta.computed_at?.replace(/[:.]/g, "-").slice(0, 19) || "now"
    }.csv`;

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
