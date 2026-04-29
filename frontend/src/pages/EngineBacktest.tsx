/**
 * EngineBacktest — TASK-8 row-level inference and replay UI.
 *
 * Five sections per spec:
 *   1. Execution Summary (run id, dataset, latency)
 *   2. Decision Distribution
 *   3. Calibration View (when outcomes are available)
 *   4. Row-Level Drill-Down
 *   5. Export
 *
 * Hits the real production decision code path on the backend (no parallel
 * implementation). Determinism + policy snapshotting handled server-side
 * (TASK-11D).
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Loader2, AlertTriangle, CheckCircle, Download } from "lucide-react";
import { useSystem } from "@/lib/hooks";
import { api } from "@/lib/api";
import { MetricValue } from "@/components/ui/MetricValue";
import { AuditInfo } from "@/components/ui/AuditInfo";
import type { AuditMeta } from "@/components/ui/AuditInfo";
import { cn } from "@/lib/utils";

interface BacktestSummary {
    id: string;
    status: string;
    decision_system_id: string;
    dataset_id: string;
    model_id: string;
    policy_id: string;
    dataset_filename?: string;
    dataset_row_count?: number;
    dataset_content_hash?: string;
    model_artifact_path?: string;
    started_at?: string;
    completed_at?: string;
    started_by?: string;
    engine_version?: string;
    rows_processed: number;
    rows_errors: number;
    rows_warnings: number;
    avg_latency_ms?: number;
    n_approved: number;
    n_denied: number;
    n_review: number;
    total_approved_dollars?: number;
    total_predicted_loss_dollars?: number;
    has_outcomes: number;
    auc?: number | null;
    ks_statistic?: number | null;
    brier_score?: number | null;
    brier_skill_score?: number | null;
    calibration_error_pp?: number | null;
    error_message?: string;
    parquet_available?: boolean;
}

export default function EngineBacktest() {
    const { systemId } = useParams<{ systemId: string }>();
    const { system } = useSystem();
    const queryClient = useQueryClient();
    const [activeRunId, setActiveRunId] = useState<string | null>(null);

    const { data: runs } = useQuery<BacktestSummary[]>({
        queryKey: ["backtest-runs", systemId],
        queryFn: async () => {
            const res = await api.get("/backtest", { params: { decision_system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
    });

    const { data: activeRun } = useQuery<BacktestSummary>({
        queryKey: ["backtest-run", activeRunId],
        queryFn: async () => {
            if (!activeRunId) throw new Error("no run");
            const res = await api.get(`/backtest/${activeRunId}`);
            return res.data;
        },
        enabled: !!activeRunId,
        // TASK-8 async: poll while the run is in flight, stop polling
        // once it completes or fails
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (status === "running" || status === "pending") return 2000;
            return false;
        },
    });

    const startMutation = useMutation({
        mutationFn: async () => {
            // Find the dataset associated with the active model
            const modelsRes = await api.get("/models/", { params: { system_id: systemId } });
            const activeModel = modelsRes.data.find(
                (m: any) => m.id === (system as any)?.active_model_id,
            );
            if (!activeModel) throw new Error("No active model on this system");
            const res = await api.post("/backtest", {
                decision_system_id: systemId,
                dataset_id: activeModel.dataset_id,
                model_id: activeModel.id,
                policy_id: (system as any)?.active_policy_id,
            });
            return res.data;
        },
        onSuccess: (data: BacktestSummary) => {
            setActiveRunId(data.id);
            queryClient.invalidateQueries({ queryKey: ["backtest-runs", systemId] });
        },
    });

    return (
        <div className="page space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Engine Backtest</h1>
                    <p className="page-desc">
                        Run the full production decisioning engine on every row of your input
                        file. Same code path as production. Same model, same policy, same
                        results — every time.
                    </p>
                </div>
                <button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending || !(system as any)?.active_policy_id}
                    className="btn-primary flex items-center gap-2"
                >
                    {startMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                    ) : (
                        <><Play className="h-4 w-4" /> New Backtest</>
                    )}
                </button>
            </div>

            {startMutation.isError && (
                <div className="panel p-4 border-down/30 bg-down/5 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-down mt-0.5" />
                    <p className="text-sm text-down">
                        {(startMutation.error as any)?.response?.data?.detail || "Failed to start backtest."}
                    </p>
                </div>
            )}

            {/* Empty state when no runs exist yet */}
            {runs && runs.length === 0 && !activeRun && (
                <div className="panel p-12 text-center">
                    <div className="icon-box bg-info/10 mx-auto mb-4">
                        <Play className="h-6 w-6 text-info" />
                    </div>
                    <h3 className="text-base font-semibold mb-2">No backtests yet</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                        A backtest replays your active model and policy on every row of
                        the input file, capturing decisions, latency, and calibration
                        metrics. Same code path as production.
                    </p>
                    <button
                        onClick={() => startMutation.mutate()}
                        disabled={startMutation.isPending || !(system as any)?.active_policy_id}
                        className="btn-primary inline-flex items-center gap-2"
                    >
                        {startMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                        ) : (
                            <><Play className="h-4 w-4" /> Run your first backtest</>
                        )}
                    </button>
                    {!(system as any)?.active_policy_id && (
                        <p className="text-2xs text-muted-foreground mt-3">
                            Publish an active policy first to enable backtesting.
                        </p>
                    )}
                </div>
            )}

            {/* Run history */}
            {runs && runs.length > 0 && !activeRun && (
                <div className="panel">
                    <div className="panel-head">
                        <span className="panel-title">Recent Runs</span>
                        <span className="text-xs text-muted-foreground">{runs.length} total</span>
                    </div>
                    <table className="dt dt-hover">
                        <thead>
                            <tr>
                                <th>Run ID</th>
                                <th>Status</th>
                                <th className="hidden lg:table-cell">Dataset</th>
                                <th className="text-right">Rows</th>
                                <th className="text-right">Approved</th>
                                <th className="text-right hidden md:table-cell" title="Approved $ — only available when dataset has an approved-amount column">Approved $</th>
                                <th className="text-right" title="AUC on rows with known outcomes">AUC</th>
                                <th className="text-right hidden lg:table-cell" title="Kolmogorov-Smirnov separation between defaulters and non-defaulters">KS</th>
                                <th className="text-right hidden lg:table-cell" title="Brier skill score — improvement over base-rate baseline. Positive = better than baseline">Brier skill</th>
                                <th className="text-right" title="Calibration error in pp — |predicted mean − observed mean|">Cal err</th>
                                <th className="text-right hidden xl:table-cell">Latency</th>
                                <th className="hidden md:table-cell">Started</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map((r) => (
                                <tr key={r.id} className="cursor-pointer" onClick={() => setActiveRunId(r.id)}>
                                    <td className="font-mono text-xs">{r.id.slice(0, 8)}</td>
                                    <td>
                                        <span className={cn(
                                            "badge",
                                            r.status === "completed" ? "badge-green" :
                                            r.status === "running" ? "badge-blue" :
                                            r.status === "failed" ? "badge-red" : "badge-muted"
                                        )}>
                                            {r.status}
                                        </span>
                                    </td>
                                    <td className="text-xs hidden lg:table-cell">{r.dataset_filename || "—"}</td>
                                    <td className="text-right"><MetricValue type="count" value={r.rows_processed} /></td>
                                    <td className="text-right"><MetricValue type="count" value={r.n_approved} /></td>
                                    <td className="text-right hidden md:table-cell"><MetricValue type="currency" value={r.total_approved_dollars ?? null} /></td>
                                    <td className="text-right">
                                        {r.has_outcomes && r.auc !== undefined && r.auc !== null
                                            ? <span className={r.auc > 0.75 ? "text-up" : r.auc > 0.65 ? "text-warn" : "text-down"}>
                                                {r.auc.toFixed(3)}
                                              </span>
                                            : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="text-right hidden lg:table-cell">
                                        {r.has_outcomes && r.ks_statistic !== undefined && r.ks_statistic !== null
                                            ? r.ks_statistic.toFixed(3)
                                            : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="text-right hidden lg:table-cell">
                                        {r.has_outcomes && r.brier_skill_score !== undefined && r.brier_skill_score !== null
                                            ? <span className={r.brier_skill_score > 0 ? "text-up" : "text-down"}>
                                                {r.brier_skill_score.toFixed(3)}
                                              </span>
                                            : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="text-right">
                                        {r.has_outcomes && r.calibration_error_pp !== undefined && r.calibration_error_pp !== null
                                            ? <span className={r.calibration_error_pp < 0.02 ? "text-up" : r.calibration_error_pp < 0.05 ? "text-warn" : "text-down"}>
                                                {(r.calibration_error_pp * 100).toFixed(2)}pp
                                              </span>
                                            : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="text-right hidden xl:table-cell">{r.avg_latency_ms?.toFixed(1) ?? "—"} ms</td>
                                    <td className="text-2xs text-muted-foreground hidden md:table-cell">
                                        {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Active run detail */}
            {activeRun && <RunDetail run={activeRun} onClose={() => setActiveRunId(null)} />}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// RunDetail — the 5 sections from the spec
// ────────────────────────────────────────────────────────────────────────

function RunDetail({ run, onClose }: { run: BacktestSummary; onClose: () => void }) {
    // Row-level filter — "all", "errors", "warnings", "approve", "deny"
    const [rowFilter, setRowFilter] = useState<"all" | "errors" | "warnings" | "approve" | "deny">("all");

    const { data: rowsResp } = useQuery({
        queryKey: ["backtest-rows", run.id],
        queryFn: async () => {
            const res = await api.get(`/backtest/${run.id}/rows`, {
                params: { page: 1, page_size: 50 },
            });
            return res.data;
        },
        enabled: run.status === "completed",
    });

    const meta: AuditMeta = {
        dataset_id: run.dataset_id,
        dataset_filename: run.dataset_filename,
        dataset_row_count: run.dataset_row_count,
        dataset_content_hash: run.dataset_content_hash,
        model_id: run.model_id,
        model_artifact_path: run.model_artifact_path,
        computed_at: run.started_at,
        computed_by: run.started_by,
        engine_version: run.engine_version,
        elapsed_ms: run.completed_at && run.started_at
            ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
            : undefined,
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Run {run.id.slice(0, 8)}</h2>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">
                    ← back to history
                </button>
            </div>

            {/* Section 1 — Execution Summary */}
            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Execution Summary</span>
                </div>
                <table className="dt">
                    <tbody>
                        <tr><td className="font-medium">Backtest run ID</td><td className="font-mono">{run.id}</td></tr>
                        <tr><td className="font-medium">Dataset</td><td>{run.dataset_filename} ({run.dataset_row_count?.toLocaleString()} rows)</td></tr>
                        <tr><td className="font-medium">Status</td><td>
                            {run.status === "completed"
                                ? <span className="text-up flex items-center gap-1"><CheckCircle className="h-3 w-3" /> {run.status}</span>
                                : run.status === "failed"
                                ? <span className="text-down flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {run.status}</span>
                                : <span className="text-info">{run.status}</span>}
                        </td></tr>
                        <tr><td className="font-medium">Started</td><td>{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</td></tr>
                        <tr><td className="font-medium">Completed</td><td>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}</td></tr>
                        <tr><td className="font-medium">Rows processed</td><td><MetricValue type="count" value={run.rows_processed} /> / <MetricValue type="count" value={run.dataset_row_count ?? null} /></td></tr>
                        <tr><td className="font-medium">Errors</td><td><MetricValue type="count" value={run.rows_errors} /></td></tr>
                        <tr><td className="font-medium">Avg latency / row</td><td>{run.avg_latency_ms?.toFixed(2) ?? "—"} ms</td></tr>
                    </tbody>
                </table>
                {run.error_message && (
                    <div className="m-4 p-3 bg-down/5 border border-down/30 rounded text-xs text-down">
                        {run.error_message}
                    </div>
                )}
            </div>

            {/* Section 2 — Decision Distribution */}
            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Decision Distribution</span>
                </div>
                <table className="dt">
                    <thead>
                        <tr><th>Decision</th><th className="text-right">Count</th><th className="text-right">Share</th><th className="text-right">Total $</th></tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><span className="badge badge-green">Approve</span></td>
                            <td className="text-right"><MetricValue type="count" value={run.n_approved} /></td>
                            <td className="text-right"><MetricValue type="percent" value={run.rows_processed ? run.n_approved / run.rows_processed : 0} /></td>
                            <td className="text-right"><MetricValue type="currency" value={run.total_approved_dollars ?? null} /></td>
                        </tr>
                        <tr>
                            <td><span className="badge badge-red">Deny</span></td>
                            <td className="text-right"><MetricValue type="count" value={run.n_denied} /></td>
                            <td className="text-right"><MetricValue type="percent" value={run.rows_processed ? run.n_denied / run.rows_processed : 0} /></td>
                            <td className="text-right text-muted-foreground">—</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Section 3 — Calibration View */}
            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Calibration View</span>
                </div>
                {run.has_outcomes ? (
                    <div className="p-5 grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <KPI label="AUC" value={run.auc?.toFixed(4)} />
                        <KPI label="KS statistic" value={run.ks_statistic?.toFixed(4)} />
                        <KPI label="Brier score" value={run.brier_score?.toFixed(4)} />
                        <KPI label="Brier skill" value={run.brier_skill_score?.toFixed(4)}
                             tone={run.brier_skill_score && run.brier_skill_score > 0 ? "up" : "down"} />
                        <KPI label="Calibration error" value={`${((run.calibration_error_pp ?? 0) * 100).toFixed(2)}pp`} />
                    </div>
                ) : (
                    <div className="p-6 text-sm text-muted-foreground">
                        No outcome label detected in this dataset. Tag a target column on the
                        dataset metadata, or upload a richer dataset to enable
                        calibration analysis.
                    </div>
                )}
            </div>

            {/* Section 4 — Row-Level Drill-Down */}
            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Row-Level Drill-Down</span>
                    <div className="flex items-center gap-3">
                        {/* Filter pills — let users isolate errors/warnings */}
                        <div className="flex items-center gap-1">
                            {([
                                ["all", "All", null],
                                ["errors", "Errors", run.rows_errors],
                                ["warnings", "Warnings", run.rows_warnings],
                                ["approve", "Approved", run.n_approved],
                                ["deny", "Denied", run.n_denied],
                            ] as const).map(([key, label, n]) => (
                                <button
                                    key={key}
                                    onClick={() => setRowFilter(key as any)}
                                    className={cn(
                                        "px-2 py-0.5 text-2xs rounded-full border transition-colors",
                                        rowFilter === key
                                            ? "bg-info/15 border-info/40 text-info"
                                            : "border-border text-muted-foreground hover:border-info/30",
                                    )}
                                >
                                    {label}{n !== null && n !== undefined ? ` (${n.toLocaleString()})` : ""}
                                </button>
                            ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            first {rowsResp?.rows?.length ?? 0} rows
                        </span>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="dt dt-hover">
                        <thead>
                            <tr>
                                <th>App ID</th>
                                <th className="text-right">Score</th>
                                <th>Decision</th>
                                <th className="text-right">Approved $</th>
                                <th>Outcome</th>
                                <th>Top reasons (SHAP)</th>
                                <th>Diagnostic</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(rowsResp?.rows || [])
                                .filter((row: any) => {
                                    if (rowFilter === "all") return true;
                                    if (rowFilter === "errors") return !!row.error_message;
                                    if (rowFilter === "warnings") return !!row.warning_flags && row.warning_flags.length > 0;
                                    if (rowFilter === "approve") return row.decision === "approve";
                                    if (rowFilter === "deny") return row.decision === "deny";
                                    return true;
                                })
                                .map((row: any) => (
                                <tr key={row.row_index}>
                                    <td className="font-mono text-xs">{row.application_id}</td>
                                    <td className="text-right"><MetricValue type="ratio" value={row.score} /></td>
                                    <td>
                                        <span className={cn(
                                            "badge",
                                            row.decision === "approve" ? "badge-green" : "badge-red"
                                        )}>
                                            {row.decision}
                                        </span>
                                    </td>
                                    <td className="text-right"><MetricValue type="currency" value={row.approved_amount} /></td>
                                    <td>
                                        {row.actual_outcome === null
                                            ? <span className="text-muted-foreground">—</span>
                                            : row.actual_outcome === 1
                                            ? <span className="text-down">bad</span>
                                            : <span className="text-up">good</span>}
                                    </td>
                                    <td>
                                        {row.shap_top_features && row.shap_top_features.length > 0 ? (
                                            <div className="flex flex-col gap-0.5 text-xs">
                                                {row.shap_top_features.slice(0, 3).map((f: any, idx: number) => (
                                                    <span key={idx} className="font-mono text-2xs">
                                                        <span className={cn(
                                                            "inline-block w-1.5 h-1.5 rounded-full mr-1",
                                                            f.value > 0 ? "bg-down" : "bg-up",
                                                        )} />
                                                        {f.feature}
                                                        <span className="text-muted-foreground ml-1">
                                                            ({f.value > 0 ? "+" : ""}{f.value.toFixed(3)})
                                                        </span>
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground text-2xs">—</span>
                                        )}
                                    </td>
                                    <td className="text-2xs">
                                        {row.error_message ? (
                                            <span className="text-down" title={row.error_message}>
                                                <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                                                Error: {row.error_message.length > 30 ? row.error_message.slice(0, 30) + "..." : row.error_message}
                                            </span>
                                        ) : row.warning_flags && row.warning_flags.length > 0 ? (
                                            <span className="text-warn" title={JSON.stringify(row.warning_flags)}>
                                                {row.warning_flags.length} warning{row.warning_flags.length === 1 ? "" : "s"}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">clean</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {(rowsResp?.rows || []).filter((row: any) => {
                                if (rowFilter === "all") return true;
                                if (rowFilter === "errors") return !!row.error_message;
                                if (rowFilter === "warnings") return !!row.warning_flags && row.warning_flags.length > 0;
                                if (rowFilter === "approve") return row.decision === "approve";
                                if (rowFilter === "deny") return row.decision === "deny";
                                return true;
                            }).length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center text-muted-foreground py-6 text-xs">
                                        No rows match the "{rowFilter}" filter in the first 1000 row sample.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 5 — Export */}
            <div className="panel p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-info" />
                    <span className="text-sm font-medium">Export</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Full Parquet results */}
                    <ExportButton
                        title="Full results (Parquet)"
                        helper={`All ${run.rows_processed.toLocaleString()} rows. Read with pandas, DuckDB, Spark, etc.`}
                        disabled={!run.parquet_available}
                        disabledReason="Not yet generated for this run"
                        url={`/backtest/${run.id}/full-results.parquet`}
                        filename={`sentinel_backtest_${run.id.slice(0, 8)}.parquet`}
                    />

                    {/* Summary PDF */}
                    <ExportButton
                        title="Summary report (PDF)"
                        helper="Cover + sections 1-3 in print-friendly format. The slide a CRO shows their CFO."
                        disabled={run.status !== "completed"}
                        disabledReason="Run must be completed"
                        url={`/backtest/${run.id}/summary.pdf`}
                        filename={`sentinel_backtest_summary_${run.id.slice(0, 8)}.pdf`}
                    />

                    {/* Calibration PDF */}
                    <ExportButton
                        title="Calibration evidence (PDF)"
                        helper="Section 3 only. SR 11-7 model validation evidence."
                        disabled={run.status !== "completed" || !run.has_outcomes}
                        disabledReason={!run.has_outcomes ? "No outcome label on this dataset" : "Run must be completed"}
                        url={`/backtest/${run.id}/calibration.pdf`}
                        filename={`sentinel_calibration_${run.id.slice(0, 8)}.pdf`}
                    />
                </div>
            </div>

            {/* Audit info */}
            <AuditInfo meta={meta} />
        </div>
    );
}

function ExportButton({
    title,
    helper,
    disabled,
    disabledReason,
    url,
    filename,
}: {
    title: string;
    helper: string;
    disabled: boolean;
    disabledReason: string;
    url: string;
    filename: string;
}) {
    return (
        <button
            onClick={async () => {
                try {
                    const res = await api.get(url, { responseType: "blob" });
                    const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
                    const a = document.createElement("a");
                    a.href = blobUrl;
                    a.download = filename;
                    a.click();
                    window.URL.revokeObjectURL(blobUrl);
                } catch (e: any) {
                    alert(e?.response?.data?.detail || "Download failed");
                }
            }}
            disabled={disabled}
            className={cn(
                "p-4 border rounded text-left transition-colors",
                disabled
                    ? "border-border opacity-50 cursor-not-allowed"
                    : "hover:bg-muted/30 border-info/30 bg-info/5 cursor-pointer",
            )}
        >
            <div className="flex items-center gap-2 mb-1">
                <Download className="h-3.5 w-3.5 text-info" />
                <span className="text-sm font-semibold">{title}</span>
            </div>
            <p className="text-xs text-muted-foreground">
                {helper}
                {disabled && ` — ${disabledReason}`}
            </p>
        </button>
    );
}

function KPI({ label, value, tone }: { label: string; value: any; tone?: "up" | "down" }) {
    return (
        <div className="bg-muted/20 rounded p-3">
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</p>
            <p className={cn(
                "text-lg font-bold",
                tone === "up" && "text-up",
                tone === "down" && "text-down",
            )}>{value ?? "—"}</p>
        </div>
    );
}
