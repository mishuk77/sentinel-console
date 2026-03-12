import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Activity, CheckCircle2, XCircle, Clock, BarChart3 } from "lucide-react";
import {
    LineChart, Line, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const CHART_GREEN  = "hsl(142,68%,40%)";
const CHART_RED    = "hsl(0,68%,52%)";
const CHART_BLUE   = "hsl(210,100%,58%)";
const CHART_PURPLE = "hsl(270,60%,65%)";

const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "var(--radius)",
    fontSize: "11px",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.15)",
};
const labelStyle = { color: "hsl(var(--muted-foreground))", marginBottom: 4 };

export default function Monitoring() {
    const { systemId } = useParams<{ systemId: string }>();

    const { data: stats } = useQuery({
        queryKey: ["decision-stats", systemId],
        queryFn: async () => {
            const r = await api.get("/decisions/stats/overview", { params: { system_id: systemId } });
            return r.data;
        },
        enabled: !!systemId,
    });

    const { data: volumeData } = useQuery({
        queryKey: ["dashboard-volume", systemId],
        queryFn: async () => {
            const r = await api.get("/dashboard/volume", { params: { system_id: systemId } });
            return r.data;
        },
        enabled: !!systemId,
    });

    return (
        <div className="page">
            <div>
                <h1 className="page-title flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Monitoring
                </h1>
                <p className="page-desc">Real-time operational metrics and performance insights</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Total Decisions</p>
                        <Activity className="h-3.5 w-3.5 text-info" />
                    </div>
                    <p className="kpi-value">{(stats?.total_decisions ?? 0).toLocaleString()}</p>
                    <p className="kpi-sub">All time</p>
                </div>
                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Approval Rate</p>
                        <CheckCircle2 className="h-3.5 w-3.5 text-up" />
                    </div>
                    <p className="kpi-value text-up">
                        {stats?.approval_rate ? `${stats.approval_rate.toFixed(1)}%` : "0%"}
                    </p>
                    <p className="kpi-sub">Of all decisions</p>
                </div>
                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Decline Rate</p>
                        <XCircle className="h-3.5 w-3.5 text-down" />
                    </div>
                    <p className="kpi-value text-down">
                        {stats?.decline_rate ? `${stats.decline_rate.toFixed(1)}%` : "0%"}
                    </p>
                    <p className="kpi-sub">Of all decisions</p>
                </div>
                <div className="kpi">
                    <div className="flex items-center justify-between mb-2">
                        <p className="kpi-label">Avg Response</p>
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="kpi-value">
                        {stats?.avg_response_time_ms ? `${stats.avg_response_time_ms.toFixed(0)}ms` : "—"}
                    </p>
                    <p className="kpi-sub">API latency</p>
                </div>
            </div>

            <div className="panel">
                <div className="panel-head">
                    <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                        <span className="panel-title">Decision Volume — Last 30 Days</span>
                    </div>
                </div>
                <div className="panel-body">
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={volumeData ?? []} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false} axisLine={false}
                                    tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle} labelFormatter={(v) => new Date(v).toLocaleDateString()} />
                                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                                <Line type="monotone" dataKey="approve" stroke={CHART_GREEN} strokeWidth={2} dot={false} name="Approved" />
                                <Line type="monotone" dataKey="decline" stroke={CHART_RED}   strokeWidth={2} dot={false} name="Declined" />
                                <Line type="monotone" dataKey="total"   stroke={CHART_BLUE}  strokeWidth={2} dot={false} name="Total" strokeDasharray="4 2" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Risk Score Distribution</span>
                </div>
                <div className="panel-body">
                    <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats?.score_distribution ?? []} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={labelStyle} />
                                <Bar dataKey="count" fill={CHART_PURPLE} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {stats?.model_performance && (
                <div className="panel">
                    <div className="panel-head">
                        <div>
                            <span className="panel-title">Active Model Performance</span>
                            <p className="text-xs text-muted-foreground mt-0.5">Key metrics for the currently deployed model</p>
                        </div>
                    </div>
                    <div className="panel-body grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            { label: "Accuracy",  value: stats.model_performance.accuracy  },
                            { label: "Precision", value: stats.model_performance.precision },
                            { label: "Recall",    value: stats.model_performance.recall    },
                        ].map(({ label, value }) => (
                            <div key={label} className="kpi">
                                <p className="kpi-label">{label}</p>
                                <p className="kpi-value">{value ? `${(value * 100).toFixed(1)}%` : "—"}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
