import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { getFraudCases, generateFraudAnalytics } from "@/lib/fraudData";
import {
    ShieldAlert,
    Clock,
    CheckCircle2,
    AlertTriangle,
    TrendingUp,
    ArrowRight,
    Activity,
    Users,
    Zap,
    Brain,
    Radio,
    Settings,
    Scale
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

export default function FraudDashboard() {
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
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        <ShieldAlert className="h-8 w-8 text-orange-500" />
                        Fraud Management
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Monitor fraud cases, review queues, and manage verification workflows.
                    </p>
                </div>
                <Link
                    to={`/systems/${systemId}/fraud/queue`}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
                >
                    View Queue <ArrowRight className="h-4 w-4" />
                </Link>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Cases Today</p>
                        <Activity className="h-5 w-5 text-blue-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{analytics.cases_today}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {analytics.cases_pending} pending review
                    </p>
                </div>

                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">SLA Compliance</p>
                        <Clock className="h-5 w-5 text-green-500" />
                    </div>
                    <p className={cn(
                        "text-3xl font-bold mt-2",
                        analytics.sla_compliance >= 90 ? "text-green-600" :
                            analytics.sla_compliance >= 70 ? "text-yellow-600" : "text-red-600"
                    )}>
                        {analytics.sla_compliance}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Cases resolved within SLA
                    </p>
                </div>

                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Approval Rate</p>
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2 text-emerald-600">
                        {analytics.approval_rate}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Of reviewed cases approved
                    </p>
                </div>

                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Avg Review Time</p>
                        <TrendingUp className="h-5 w-5 text-purple-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">
                        {analytics.avg_review_time_minutes}m
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Average time to resolution
                    </p>
                </div>
            </div>

            {/* Queue Alerts */}
            {analytics.queue_depth.critical > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-4">
                    <div className="bg-red-100 p-2 rounded-full">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                    </div>
                    <div className="flex-1">
                        <p className="font-bold text-red-900">
                            {analytics.queue_depth.critical} Critical Cases Require Immediate Attention
                        </p>
                        <p className="text-sm text-red-700">
                            SLA deadline: 15 minutes. These cases have fraud scores above 800.
                        </p>
                    </div>
                    <Link
                        to={`/systems/${systemId}/fraud/queue?queue=critical`}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors"
                    >
                        Review Now
                    </Link>
                </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Queue Depth */}
                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <h3 className="font-semibold mb-4">Queue Depth</h3>
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
                                <Tooltip />
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

                {/* Score Distribution */}
                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <h3 className="font-semibold mb-4">Score Distribution</h3>
                    <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analytics.score_distribution}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                                <YAxis />
                                <Tooltip />
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

            {/* Daily Trend */}
            <div className="bg-card border rounded-xl p-6 shadow-sm">
                <h3 className="font-semibold mb-4">Daily Case Trend (Last 7 Days)</h3>
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={analytics.daily_trend}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12 }}
                                tickFormatter={(value) => new Date(value).toLocaleDateString("en-US", { weekday: "short" })}
                            />
                            <YAxis />
                            <Tooltip
                                labelFormatter={(value) => new Date(value).toLocaleDateString()}
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

            {/* Top Triggered Signals */}
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold">Top Triggered Signals</h3>
                    <p className="text-sm text-muted-foreground">Most common fraud indicators across all cases</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
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
                                                    signal.avg_risk_contribution > 60 ? "bg-red-500" :
                                                        signal.avg_risk_contribution > 40 ? "bg-orange-500" :
                                                            "bg-yellow-500"
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
                <div className="lg:col-span-2 bg-card border rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-500" />
                                Analyst Performance
                            </h3>
                            <p className="text-sm text-muted-foreground">Review metrics by team member</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
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
                                                analyst.approval_rate >= 70 ? "text-green-600" :
                                                    analyst.approval_rate >= 50 ? "text-yellow-600" : "text-red-600"
                                            )}>
                                                {analyst.approval_rate}%
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <span className={cn(
                                                "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                                analyst.sla_compliance >= 90 ? "bg-green-100 text-green-700" :
                                                    analyst.sla_compliance >= 70 ? "bg-yellow-100 text-yellow-700" :
                                                        "bg-red-100 text-red-700"
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
                <div className="bg-card border rounded-xl p-6 shadow-sm">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <Zap className="h-5 w-5 text-purple-500" />
                        Quick Actions
                    </h3>
                    <div className="space-y-3">
                        <Link
                            to={`/systems/${systemId}/fraud/queue?queue=critical`}
                            className="flex items-center justify-between p-3 border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                        >
                            <span className="text-sm font-medium text-red-900 dark:text-red-200">Review Critical Cases</span>
                            <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                                {analytics.queue_depth.critical}
                            </span>
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/queue?queue=high`}
                            className="flex items-center justify-between p-3 border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors"
                        >
                            <span className="text-sm font-medium text-orange-900 dark:text-orange-200">Review High Priority</span>
                            <span className="bg-orange-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                                {analytics.queue_depth.high}
                            </span>
                        </Link>

                        <div className="border-t my-3 pt-3">
                            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Configuration</p>
                        </div>

                        <Link
                            to={`/systems/${systemId}/fraud/rules`}
                            className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                            <Scale className="h-4 w-4 text-indigo-500" />
                            <span className="text-sm font-medium">Manage Rules</span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" />
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/models`}
                            className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                            <Brain className="h-4 w-4 text-purple-500" />
                            <span className="text-sm font-medium">ML Models</span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" />
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/signals`}
                            className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                            <Radio className="h-4 w-4 text-teal-500" />
                            <span className="text-sm font-medium">Signal Providers</span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" />
                        </Link>
                        <Link
                            to={`/systems/${systemId}/fraud/settings`}
                            className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                            <Settings className="h-4 w-4 text-gray-500" />
                            <span className="text-sm font-medium">Automation Settings</span>
                            <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
