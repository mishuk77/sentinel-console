import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Activity, TrendingUp, CheckCircle, Server, ChevronDown, BarChart2, Table2, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import {
    ComposedChart, Line, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { cn } from "@/lib/utils";

interface DecisionSystem {
    id: string;
    name: string;
    active_model_id?: string;
    active_policy_id?: string;
}

const CHART_BLUE  = "hsl(210,100%,58%)";
const CHART_GREEN = "hsl(142,68%,40%)";

export default function Dashboard() {
    const [selectedSystemId, setSelectedSystemId] = useState<string>("");

    const { data: systems } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => { const r = await api.get("/systems/"); return r.data; }
    });

    if (systems?.length && !selectedSystemId) setSelectedSystemId(systems[0].id);

    const selectedSystem = systems?.find(s => s.id === selectedSystemId);

    const { data: stats } = useQuery({
        queryKey: ["dashboard-stats", selectedSystemId],
        queryFn: async () => {
            const r = await api.get("/dashboard/stats", { params: selectedSystemId ? { system_id: selectedSystemId } : {} });
            return r.data;
        },
        refetchInterval: 5000,
        enabled: !!selectedSystemId || systems?.length === 0,
    });

    const { data: status } = useQuery({
        queryKey: ["deployment-status", selectedSystemId],
        queryFn: async () => {
            const r = await api.get("/dashboard/deployment-status", { params: selectedSystemId ? { system_id: selectedSystemId } : {} });
            return r.data;
        },
        enabled: !!selectedSystemId || systems?.length === 0,
    });

    const { data: volume } = useQuery({
        queryKey: ["dashboard-volume", selectedSystemId],
        queryFn: async () => {
            const r = await api.get("/dashboard/volume", { params: selectedSystemId ? { system_id: selectedSystemId } : {} });
            return r.data;
        },
        refetchInterval: 5000,
        enabled: !!selectedSystemId || systems?.length === 0,
    });

    // Daily breakdown
    const { data: dailyBreakdown } = useQuery<any[]>({
        queryKey: ["dashboard-daily", selectedSystemId],
        queryFn: async () => {
            const r = await api.get("/dashboard/daily-breakdown", { params: selectedSystemId ? { system_id: selectedSystemId } : {} });
            return r.data;
        },
        refetchInterval: 10000,
        enabled: !!selectedSystemId || systems?.length === 0,
    });

    type DailySortField = "date" | "applications" | "avg_credit_score" | "avg_fraud_score" | "approvals" | "approval_rate" | "avg_approved_amount" | "fraud_low_pct" | "fraud_medium_pct" | "fraud_high_pct" | "fraud_critical_pct";
    const [dailySortField, setDailySortField] = useState<DailySortField>("date");
    const [dailySortDir, setDailySortDir] = useState<"asc" | "desc">("desc");

    const sortedDaily = useMemo(() => {
        if (!dailyBreakdown) return [];
        return [...dailyBreakdown].sort((a, b) => {
            let aVal = a[dailySortField];
            let bVal = b[dailySortField];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            if (aVal < bVal) return dailySortDir === "asc" ? -1 : 1;
            if (aVal > bVal) return dailySortDir === "asc" ? 1 : -1;
            return 0;
        });
    }, [dailyBreakdown, dailySortField, dailySortDir]);

    const toggleDailySort = (field: DailySortField) => {
        if (dailySortField === field) {
            setDailySortDir(d => d === "asc" ? "desc" : "asc");
        } else {
            setDailySortField(field);
            setDailySortDir(field === "date" ? "desc" : "desc");
        }
    };

    const isLive = !!status?.model?.name;

    return (
        <div className="page">
            {/* Header row */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="page-title">Dashboard</h1>
                    <p className="page-desc">Operational overview · Sentinel decisioning engine</p>
                </div>

                {systems && systems.length > 0 && (
                    <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <div className="relative">
                            <select
                                value={selectedSystemId}
                                onChange={(e) => setSelectedSystemId(e.target.value)}
                                className={cn(
                                    "appearance-none bg-card border rounded pl-3 pr-7 py-1.5 text-xs font-medium",
                                    "focus:outline-none focus:ring-2 focus:ring-ring/30 min-w-[180px]"
                                )}
                            >
                                {systems.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                        </div>
                    </div>
                )}
            </div>

            {/* System status banner */}
            <div className={cn(
                "panel card-highlight",
                isLive ? "" : "opacity-80"
            )}>
                <div className="p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className={isLive ? "dot-live" : "dot-warn"} />
                            <span className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                                {isLive ? "System Active" : "Pending Setup"}
                            </span>
                        </div>
                        {selectedSystem && (
                            <span className="badge badge-blue">{selectedSystem.name}</span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <p className="kpi-label">Active Model</p>
                            <p className="text-base font-bold truncate" title={status?.model?.name}>
                                {status?.model?.name || "—"}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                {status?.model?.algorithm && (
                                    <span className="badge badge-muted">{status.model.algorithm}</span>
                                )}
                                {status?.model?.version && (
                                    <span className="text-2xs text-muted-foreground font-mono">v{status.model.version}</span>
                                )}
                            </div>
                        </div>

                        <div>
                            <p className="kpi-label">Active Policy</p>
                            <p className="text-base font-bold">
                                {status?.policy?.target_decile
                                    ? `Decile ${status.policy.target_decile} — Top ${status.policy.target_decile * 10}%`
                                    : "—"}
                            </p>
                            {status?.policy?.projected_loss != null && (
                                <p className="text-xs mt-1">
                                    Proj. loss:{" "}
                                    <span className={status.policy.projected_loss > 10 ? "text-down font-semibold" : "text-up font-semibold"}>
                                        {Number(status.policy.projected_loss).toFixed(2)}%
                                    </span>
                                </p>
                            )}
                        </div>

                        <div className="flex items-start justify-end">
                            <div className="text-right">
                                <p className="kpi-label">Status</p>
                                <p className={cn(
                                    "text-sm font-semibold",
                                    isLive ? "text-up" : "text-warn"
                                )}>
                                    {isLive ? "Operational" : "Inactive"}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Total Decisions</p>
                        <div className="icon-box-sm bg-info/10">
                            <Activity className="h-3.5 w-3.5 text-info" />
                        </div>
                    </div>
                    <p className="kpi-value">{(stats?.volume ?? 0).toLocaleString()}</p>
                    <p className="kpi-sub">All time</p>
                </div>

                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Approval Rate</p>
                        <div className="icon-box-sm bg-up/10">
                            <TrendingUp className="h-3.5 w-3.5 text-up" />
                        </div>
                    </div>
                    <p className="kpi-value text-up">
                        {stats ? (stats.approval_rate * 100).toFixed(1) : "0.0"}%
                    </p>
                    <p className="kpi-sub">Of all decisions</p>
                </div>

                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Total Approved</p>
                        <div className="icon-box-sm bg-up/10">
                            <CheckCircle className="h-3.5 w-3.5 text-up" />
                        </div>
                    </div>
                    <p className="kpi-value">{(stats?.approvals ?? 0).toLocaleString()}</p>
                    <p className="kpi-sub">Applications</p>
                </div>
            </div>

            {/* Volume chart */}
            <div className="panel">
                <div className="panel-head">
                    <div className="flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-muted-foreground" />
                        <span className="panel-title">Decision Volume & Approval Trend</span>
                    </div>
                </div>
                <div className="panel-body">
                    {volume && volume.length > 0 ? (
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={volume} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        yAxisId="left"
                                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        unit="%"
                                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: "hsl(var(--popover))",
                                            border: "1px solid hsl(var(--border))",
                                            borderRadius: "var(--radius)",
                                            fontSize: "12px",
                                            boxShadow: "0 4px 12px rgb(0 0 0 / 0.15)",
                                        }}
                                        labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                                    />
                                    <Legend
                                        wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                                    />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="total"
                                        fill={CHART_BLUE}
                                        fillOpacity={0.7}
                                        name="Total Volume"
                                        barSize={32}
                                        radius={[2, 2, 0, 0]}
                                    />
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey={(d) => d.total ? Math.round((d.approved / d.total) * 100) : 0}
                                        stroke={CHART_GREEN}
                                        strokeWidth={2}
                                        dot={false}
                                        name="Approval Rate %"
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-[320px] flex flex-col items-center justify-center text-center">
                            <div className="icon-box bg-muted/40 mb-3">
                                <TrendingUp className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm font-medium mb-1">No decision data yet</p>
                            <p className="text-xs text-muted-foreground max-w-xs">
                                Decision trends will appear once you start processing applications.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Daily Breakdown Table */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div className="flex items-center gap-2">
                        <Table2 className="h-4 w-4 text-muted-foreground" />
                        <span className="panel-title">Daily Breakdown</span>
                    </div>
                    {sortedDaily.length > 0 && (
                        <span className="text-2xs text-muted-foreground">{sortedDaily.length} day{sortedDaily.length !== 1 ? "s" : ""}</span>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="dt dt-hover w-full">
                        <thead>
                            <tr>
                                <DailySortTh field="date" label="Date" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} />
                                <DailySortTh field="applications" label="Applications" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="avg_credit_score" label="Avg Credit Score" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="avg_fraud_score" label="Avg Fraud Score" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="approvals" label="Approvals" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="approval_rate" label="Approval Rate" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="avg_approved_amount" label="Avg Approved Amt" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="fraud_low_pct" label="Low %" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="fraud_medium_pct" label="Med %" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="fraud_high_pct" label="High %" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                                <DailySortTh field="fraud_critical_pct" label="Crit %" sortField={dailySortField} sortDir={dailySortDir} toggle={toggleDailySort} align="right" />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedDaily.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="p-8 text-center text-muted-foreground text-xs">
                                        No decision data yet. Run decisions to populate this breakdown.
                                    </td>
                                </tr>
                            ) : sortedDaily.map(row => (
                                <tr key={row.date}>
                                    <td className="text-xs font-medium">{row.date}</td>
                                    <td className="text-xs font-mono text-right">{row.applications}</td>
                                    <td className="text-xs font-mono text-right">{row.avg_credit_score != null ? (row.avg_credit_score * 100).toFixed(1) : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.avg_fraud_score != null ? (row.avg_fraud_score * 100).toFixed(1) : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.approvals}</td>
                                    <td className="text-xs font-mono text-right">
                                        <span className={row.approval_rate >= 0.5 ? "text-up" : "text-down"}>
                                            {(row.approval_rate * 100).toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="text-xs font-mono text-right">{row.avg_approved_amount != null ? `$${Math.round(row.avg_approved_amount).toLocaleString()}` : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.fraud_low_pct != null ? <span className="text-up">{row.fraud_low_pct}%</span> : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.fraud_medium_pct != null ? <span className="text-warn">{row.fraud_medium_pct}%</span> : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.fraud_high_pct != null ? <span className="text-down">{row.fraud_high_pct}%</span> : "—"}</td>
                                    <td className="text-xs font-mono text-right">{row.fraud_critical_pct != null ? <span className="text-down font-bold">{row.fraud_critical_pct}%</span> : "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// Sortable header for daily breakdown
function DailySortTh({ field, label, sortField, sortDir, toggle, align }: {
    field: string; label: string;
    sortField: string; sortDir: "asc" | "desc";
    toggle: (f: any) => void;
    align?: "right";
}) {
    return (
        <th className="text-xs">
            <button
                onClick={() => toggle(field)}
                className={cn("flex items-center gap-1 hover:text-foreground transition-colors whitespace-nowrap",
                    align === "right" && "ml-auto")}
            >
                {label}
                {sortField === field
                    ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)
                    : <ArrowUpDown className="h-3 w-3 text-muted-foreground/30" />}
            </button>
        </th>
    );
}
