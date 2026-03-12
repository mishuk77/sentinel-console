import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { getFraudCases, generateFraudAnalytics } from "@/lib/fraudData";
import {
    ShieldAlert,
    AlertTriangle,
    ArrowRight,
    Users,
    Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    Legend
} from "recharts";

const QUEUE_COLORS = {
    critical: "#dc2626",
    high: "#f97316",
    medium: "#eab308",
    low: "#22c55e",
};

export default function FraudOperations() {
    const { systemId } = useParams<{ systemId: string }>();

    const cases = useMemo(() => getFraudCases(systemId || ""), [systemId]);
    const analytics = useMemo(() => generateFraudAnalytics(cases), [cases]);

    const queueData = [
        { name: "Critical", value: analytics.queue_depth.critical, color: QUEUE_COLORS.critical },
        { name: "High", value: analytics.queue_depth.high, color: QUEUE_COLORS.high },
        { name: "Medium", value: analytics.queue_depth.medium, color: QUEUE_COLORS.medium },
        { name: "Low", value: analytics.queue_depth.low, color: QUEUE_COLORS.low },
    ].filter(d => d.value > 0);

    return (
        <div className="page">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title flex items-center gap-3">
                        <ShieldAlert className="h-6 w-6 text-warn" />
                        Fraud Operations
                    </h1>
                    <p className="page-desc">
                        Monitor fraud cases, review queues, and manage day-to-day fraud investigation workflows.
                    </p>
                </div>
                <Link
                    to={`/systems/${systemId}/fraud/queue`}
                    className="btn-primary btn-sm inline-flex items-center gap-2"
                >
                    View Queue <ArrowRight className="h-4 w-4" />
                </Link>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="kpi">
                    <p className="kpi-label">Cases Today</p>
                    <p className="kpi-value">{analytics.cases_today}</p>
                    <p className="kpi-sub">{analytics.cases_pending} pending review</p>
                </div>

                <div className="kpi">
                    <p className="kpi-label">SLA Compliance</p>
                    <p className={cn(
                        "kpi-value",
                        analytics.sla_compliance >= 90 ? "text-up" :
                            analytics.sla_compliance >= 70 ? "text-warn" : "text-down"
                    )}>
                        {analytics.sla_compliance}%
                    </p>
                    <p className="kpi-sub">Cases resolved within SLA</p>
                </div>

                <div className="kpi">
                    <p className="kpi-label">Approval Rate</p>
                    <p className="kpi-value text-up">
                        {analytics.approval_rate}%
                    </p>
                    <p className="kpi-sub">Of reviewed cases approved</p>
                </div>

                <div className="kpi">
                    <p className="kpi-label">Avg Review Time</p>
                    <p className="kpi-value">{analytics.avg_review_time_minutes}m</p>
                    <p className="kpi-sub">Average time to resolution</p>
                </div>
            </div>

            {/* Queue Alerts */}
            {analytics.queue_depth.critical > 0 && (
                <div className="panel border-down/30 p-4 flex items-center gap-4">
                    <div className="bg-down/10 p-2 rounded-full">
                        <AlertTriangle className="h-5 w-5 text-down" />
                    </div>
                    <div className="flex-1">
                        <p className="font-bold text-foreground">
                            {analytics.queue_depth.critical} Critical Cases Require Immediate Attention
                        </p>
                        <p className="text-sm text-muted-foreground">
                            SLA deadline: 15 minutes. These cases have fraud scores above 800.
                        </p>
                    </div>
                    <Link
                        to={`/systems/${systemId}/fraud/queue?queue=critical`}
                        className="btn-danger btn-sm"
                    >
                        Review Now
                    </Link>
                </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Queue Depth */}
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title">Queue Depth</h3>
                    </div>
                    <div className="panel-body">
                        <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={queueData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value}`}
                                    >
                                        {queueData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex justify-center gap-4 mt-4">
                            {Object.entries(QUEUE_COLORS).map(([level, color]) => (
                                <div key={level} className="flex items-center gap-1 text-xs">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                                    <span className="capitalize">{level}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Score Distribution */}
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title">Score Distribution</h3>
                    </div>
                    <div className="panel-body">
                        <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={analytics.score_distribution}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis dataKey="range" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} />
                                    <Bar
                                        dataKey="count"
                                        fill="#6366f1"
                                        radius={[4, 4, 0, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            {/* Daily Trend */}
            <div className="panel">
                <div className="panel-head">
                    <h3 className="panel-title">Daily Case Trend (Last 7 Days)</h3>
                </div>
                <div className="panel-body">
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analytics.daily_trend}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { weekday: "short" })}
                                />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <Tooltip
                                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="total"
                                    stroke="#6366f1"
                                    strokeWidth={2}
                                    name="Total Cases"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="approved"
                                    stroke="#22c55e"
                                    strokeWidth={2}
                                    name="Approved"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="declined"
                                    stroke="#ef4444"
                                    strokeWidth={2}
                                    name="Declined"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Top Triggered Signals */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div>
                        <h3 className="panel-title">Top Triggered Signals</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Most common fraud indicators across all cases</p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="dt dt-hover">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="h-10 px-6 text-left font-medium text-muted-foreground">Signal</th>
                                <th className="h-10 px-6 text-right font-medium text-muted-foreground">Trigger Count</th>
                                <th className="h-10 px-6 text-right font-medium text-muted-foreground">Avg Risk Contribution</th>
                                <th className="h-10 px-6 text-left font-medium text-muted-foreground">Impact</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics.top_signals.slice(0, 8).map((signal, index) => (
                                <tr key={index} className="border-b last:border-0 hover:bg-muted/30">
                                    <td className="px-6 py-3 font-medium">
                                        <code className="bg-muted px-2 py-1 rounded text-xs">
                                            {signal.signal_name}
                                        </code>
                                    </td>
                                    <td className="px-6 py-3 text-right font-mono">
                                        {signal.trigger_count}
                                    </td>
                                    <td className="px-6 py-3 text-right font-mono">
                                        {signal.avg_risk_contribution}%
                                    </td>
                                    <td className="px-6 py-3">
                                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={cn(
                                                    "h-full rounded-full",
                                                    signal.avg_risk_contribution > 60 ? "bg-down" :
                                                        signal.avg_risk_contribution > 40 ? "bg-warn" :
                                                            "bg-warn/70"
                                                )}
                                                style={{ width: `${signal.avg_risk_contribution}%` }}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bottom Row - Analyst Performance & Quick Links */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Analyst Performance */}
                <div className="lg:col-span-2 panel overflow-hidden">
                    <div className="panel-head">
                        <div>
                            <h3 className="panel-title flex items-center gap-2">
                                <Users className="h-4 w-4 text-info" />
                                Analyst Performance
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">Review metrics by team member</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="dt dt-hover">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="h-10 px-6 text-left font-medium text-muted-foreground">Analyst</th>
                                    <th className="h-10 px-6 text-right font-medium text-muted-foreground">Cases Reviewed</th>
                                    <th className="h-10 px-6 text-right font-medium text-muted-foreground">Avg Time</th>
                                    <th className="h-10 px-6 text-right font-medium text-muted-foreground">Approval Rate</th>
                                    <th className="h-10 px-6 text-right font-medium text-muted-foreground">SLA Compliance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analytics.analyst_performance?.map((analyst) => (
                                    <tr key={analyst.analyst_id} className="border-b last:border-0 hover:bg-muted/30">
                                        <td className="px-6 py-3 font-medium">{analyst.analyst_name}</td>
                                        <td className="px-6 py-3 text-right font-mono">{analyst.cases_reviewed}</td>
                                        <td className="px-6 py-3 text-right font-mono">{analyst.avg_review_time_minutes}m</td>
                                        <td className="px-6 py-3 text-right">
                                            <span className={cn(
                                                "font-mono",
                                                analyst.approval_rate >= 70 ? "text-up" :
                                                    analyst.approval_rate >= 50 ? "text-warn" : "text-down"
                                            )}>
                                                {analyst.approval_rate}%
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <span className={cn(
                                                "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                                analyst.sla_compliance >= 90 ? "badge badge-green" :
                                                    analyst.sla_compliance >= 70 ? "badge badge-amber" :
                                                        "badge badge-red"
                                            )}>
                                                {analyst.sla_compliance}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="panel p-5">
                    <h3 className="panel-title mb-4 flex items-center gap-2">
                        <Zap className="h-4 w-4 text-info" />
                        Quick Actions
                    </h3>
                    <div className="space-y-3">
                        <Link
                            to={`/systems/${systemId}/fraud/queue?queue=critical`}
                            className="flex items-center justify-between panel p-3 border-down/20 hover:bg-down/5 transition-colors"
                        >
                            <span className="text-sm font-medium text-foreground">Review Critical Cases</span>
                            <span className="badge badge-red">
                                {analytics.queue_depth.critical}
                            </span>
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/queue?queue=high`}
                            className="flex items-center justify-between panel p-3 border-warn/20 hover:bg-warn/5 transition-colors"
                        >
                            <span className="text-sm font-medium text-foreground">Review High Priority</span>
                            <span className="badge badge-amber">
                                {analytics.queue_depth.high}
                            </span>
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/queue?queue=medium`}
                            className="flex items-center justify-between panel p-3 border-warn/20 hover:bg-warn/5 transition-colors"
                        >
                            <span className="text-sm font-medium text-foreground">Review Medium Priority</span>
                            <span className="badge badge-amber">
                                {analytics.queue_depth.medium}
                            </span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
