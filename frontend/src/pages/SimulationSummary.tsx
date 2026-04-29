/**
 * SimulationSummary — TASK-7 projected simulation summary page.
 *
 * Three-column comparison:
 *   1. Baseline (input file)        — historical metrics from source data
 *   2. Score Distribution            — decile histogram of model predictions
 *   3. Simulated Outcomes            — production-equivalent (cuts + ladder)
 *
 * Plus a "Lift Summary" section at the bottom.
 *
 * Per spec note: "A previous draft included a 'Model-Only Outcomes'
 * column. That doesn't make sense — a model produces a probability score,
 * it doesn't approve or deny anyone. The honest middle column is the
 * score distribution view."
 *
 * Reuses <ImpactTable /> for the comparison and <AuditInfo /> for
 * traceability. Deciles are read from model.metrics.calibration which is
 * already computed at training time.
 */
import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSystem } from "@/lib/hooks";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import {
    BarChart3, ArrowRight, Layers, ChevronRight,
} from "lucide-react";
import { Bar, BarChart, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { MetricValue } from "@/components/ui/MetricValue";
import { ImpactTable } from "@/components/simulation/ImpactTable";

const CHART_GREEN = "hsl(142,68%,40%)";
const CHART_AMBER = "hsl(38,92%,50%)";
const CHART_RED = "hsl(0,68%,52%)";

const decileColor = (decile: number, total: number) => {
    const ratio = (decile - 1) / Math.max(total - 1, 1);
    if (ratio < 0.35) return CHART_GREEN;
    if (ratio < 0.65) return CHART_AMBER;
    return CHART_RED;
};

export default function SimulationSummary() {
    const { systemId } = useParams<{ systemId: string }>();
    const { system } = useSystem();

    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
    });

    const { data: policies } = useQuery<any[]>({
        queryKey: ["policies", systemId],
        queryFn: async () => {
            const res = await api.get("/policies/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
    });

    const activeModel = useMemo(
        () => models?.find((m) => m.id === (system as any)?.active_model_id),
        [models, system],
    );
    const activePolicy = useMemo(
        () => policies?.find((p: any) => p.is_active),
        [policies],
    );

    if (!system) {
        return <div className="page"><p className="text-muted-foreground">Loading system...</p></div>;
    }
    if (!activeModel || !activePolicy) {
        return (
            <div className="page space-y-4">
                <h1 className="page-title flex items-center gap-3">
                    <BarChart3 className="h-6 w-6 text-info" />
                    Projected Simulation Summary
                </h1>
                <div className="panel p-8 text-center text-muted-foreground">
                    <p className="text-sm mb-4">
                        Need an active model and a published policy to run a simulation.
                    </p>
                    <Link
                        to={`/systems/${systemId}/policy`}
                        className="text-info hover:underline text-sm inline-flex items-center gap-1"
                    >
                        Configure policy <ChevronRight className="h-3 w-3" />
                    </Link>
                </div>
            </div>
        );
    }

    const calibration: any[] = (activeModel.metrics as any)?.calibration || [];
    const sortedDeciles = [...calibration].sort((a, b) => a.decile - b.decile);
    const maxDecile = sortedDeciles.length || 10;

    // Score distribution chart data
    const distributionData = sortedDeciles.map((bin: any) => ({
        decile: bin.decile,
        count: bin.count || 0,
        // Score range
        score_range: `${(bin.min_score ?? 0).toFixed(3)}–${(bin.max_score ?? 0).toFixed(3)}`,
        avg_score: bin.predicted_rate ?? bin.actual_rate ?? 0,
        observed_rate_pct: ((bin.actual_rate ?? 0) * 100),
    }));

    return (
        <div className="page space-y-6">
            {/* Header */}
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <BarChart3 className="h-6 w-6 text-info" />
                    Projected Simulation Summary
                </h1>
                <p className="page-desc">
                    Forward-looking forecast of portfolio impact. Computed from the model's
                    aggregate score distribution against the active policy. For row-level
                    replay against the production code path, see{" "}
                    <Link to={`/systems/${systemId}/backtest`} className="text-info hover:underline">
                        Engine Backtest
                    </Link>.
                </p>
            </div>

            {/* Three-column layout — production-equivalent column is visually
                 dominant (1.5x width on lg screens) since it's the actionable view */}
            <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
                {/* Column 1: Baseline (input file) — 2/7 cols on lg */}
                <div className="panel lg:col-span-2">
                    <div className="panel-head">
                        <span className="panel-title">Baseline</span>
                        <span className="text-2xs text-muted-foreground">input file counterfactual</span>
                    </div>
                    <div className="p-5 space-y-3 text-sm">
                        <p className="text-xs text-muted-foreground">
                            Population metrics assuming approve everyone at requested amount.
                            This is what the population <em>would do</em> without any policy.
                        </p>
                        <BaselineCard
                            activeModel={activeModel}
                            activePolicy={activePolicy}
                        />
                    </div>
                </div>

                {/* Column 2: Score Distribution — 2/7 cols on lg */}
                <div className="panel lg:col-span-2">
                    <div className="panel-head">
                        <span className="panel-title">Score Distribution</span>
                        <span className="text-2xs text-muted-foreground">model view</span>
                    </div>
                    <div className="p-5 space-y-3">
                        <p className="text-xs text-muted-foreground">
                            What the model "sees" without taking action. Decile 1 = lowest risk,
                            decile {maxDecile} = highest risk. Bars are application counts.
                        </p>
                        {distributionData.length > 0 ? (
                            <div className="h-[180px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={distributionData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                        <XAxis
                                            dataKey="decile"
                                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            tickLine={false} axisLine={false}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            tickLine={false} axisLine={false}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                background: "hsl(var(--popover))",
                                                border: "1px solid hsl(var(--border))",
                                                borderRadius: "var(--radius)",
                                                fontSize: "11px",
                                            }}
                                            labelFormatter={(v) => `Decile ${v}`}
                                        />
                                        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                                            {distributionData.map((d, i) => (
                                                <Cell key={i} fill={decileColor(d.decile, maxDecile)} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No calibration data available.</p>
                        )}
                        <table className="dt text-xs">
                            <thead>
                                <tr>
                                    <th>Decile</th>
                                    <th className="text-right">Count</th>
                                    <th className="text-right">Bad rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {distributionData.slice(0, 5).map((d) => (
                                    <tr key={d.decile}>
                                        <td>D{d.decile}</td>
                                        <td className="text-right">
                                            <MetricValue type="count" value={d.count} />
                                        </td>
                                        <td className="text-right">
                                            <MetricValue type="percent" value={d.observed_rate_pct} />
                                        </td>
                                    </tr>
                                ))}
                                {distributionData.length > 5 && (
                                    <tr>
                                        <td colSpan={3} className="text-center text-muted-foreground">
                                            …and {distributionData.length - 5} more deciles
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Column 3: Simulated Outcomes — 3/7 cols on lg, accented border
                     to signal this is the actionable / production-equivalent view */}
                <div className="panel lg:col-span-3 border-info/40 bg-info/[0.03]">
                    <div className="panel-head">
                        <div>
                            <span className="panel-title text-info">Simulated Outcomes</span>
                            <span className="ml-2 text-2xs uppercase tracking-wider text-info/70 font-bold">
                                Production-equivalent
                            </span>
                        </div>
                        <span className="text-2xs text-muted-foreground">cuts + ladder applied</span>
                    </div>
                    <div className="p-5 space-y-3 text-sm">
                        <p className="text-xs text-muted-foreground">
                            Production-equivalent projection: model + policy cutoff + amount ladder.
                            See <Link to={`/systems/${systemId}/exposure-control`} className="text-info hover:underline">
                                Exposure Control
                            </Link> for the full 3-stage breakdown.
                        </p>
                        <SimulatedOutcomesCard
                            activeModel={activeModel}
                            activePolicy={activePolicy}
                        />
                    </div>
                </div>
            </div>

            {/* Full impact comparison (reused from TASK-3) */}
            <ImpactTable
                datasetId={activeModel.dataset_id}
                modelId={activeModel.id}
                cutoff={activePolicy.threshold}
                amountLadder={activePolicy.amount_ladder}
                title="Lift Summary — Baseline → Simulated"
                description="Side-by-side comparison of the metrics from columns 1 and 3 above, plus the delta vs baseline."
            />

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Layers className="h-4 w-4" />
                Want row-level evidence?
                <Link
                    to={`/systems/${systemId}/backtest`}
                    className="text-info hover:underline inline-flex items-center gap-1"
                >
                    Run an Engine Backtest <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Side cards — just KPI snapshots; the heavy comparison is in ImpactTable
// ────────────────────────────────────────────────────────────────────────

function BaselineCard({ activeModel, activePolicy }: any) {
    // For the side card view, we display approximate baseline numbers
    // pulled from the cached simulation. The detailed lift table below
    // is the source of truth for actual numbers.
    const { data } = useQuery<any>({
        queryKey: ["sim-summary-card", activeModel?.dataset_id, activeModel?.id, activePolicy?.threshold],
        queryFn: async () => {
            const res = await api.post("/simulate/portfolio", {
                dataset_id: activeModel.dataset_id,
                model_id: activeModel.id,
                cutoff: activePolicy.threshold,
                amount_ladder: activePolicy.amount_ladder || null,
            });
            return res.data;
        },
        enabled: !!activeModel && !!activePolicy,
        staleTime: 60 * 1000,
    });

    const b = data?.baseline;
    return (
        <div className="space-y-2">
            <KPI label="Total applications" value={b?.total_applications} type="count" />
            <KPI label="Total approved $" value={b?.total_approved_dollars} type="currency" />
            <KPI label="Predicted loss $" value={b?.total_predicted_loss_dollars} type="currency" />
            <KPI label="Predicted loss rate ($)" value={b?.predicted_loss_rate_dollars} type="percent" />
        </div>
    );
}

function SimulatedOutcomesCard({ activeModel, activePolicy }: any) {
    const { data } = useQuery<any>({
        queryKey: ["sim-summary-card", activeModel?.dataset_id, activeModel?.id, activePolicy?.threshold, activePolicy?.amount_ladder],
        queryFn: async () => {
            const res = await api.post("/simulate/portfolio", {
                dataset_id: activeModel.dataset_id,
                model_id: activeModel.id,
                cutoff: activePolicy.threshold,
                amount_ladder: activePolicy.amount_ladder || null,
            });
            return res.data;
        },
        enabled: !!activeModel && !!activePolicy,
        staleTime: 60 * 1000,
    });

    const s = data?.policy_cuts_ladder;
    return (
        <div className="space-y-2">
            <KPI label="Approval rate" value={s?.approval_rate} type="percent" />
            <KPI label="Approved $" value={s?.total_approved_dollars} type="currency" />
            <KPI label="Predicted loss $" value={s?.total_predicted_loss_dollars} type="currency" />
            <KPI label="Net risk-adjusted $" value={s?.net_risk_adjusted_dollars} type="currency" highlight />
        </div>
    );
}

function KPI({ label, value, type, highlight }: any) {
    return (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/20 rounded">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={highlight ? "font-bold text-up" : "font-semibold"}>
                <MetricValue type={type} value={value ?? null} />
            </span>
        </div>
    );
}
