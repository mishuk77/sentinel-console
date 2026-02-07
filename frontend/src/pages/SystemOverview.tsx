import { useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DecisionSystem } from "@/lib/api";
import {
    BarChart3,
    Database,
    ShieldAlert,
    DollarSign,
    BrainCircuit,
    Sliders,
    ArrowRight,
} from "lucide-react";
import {
    AreaChart,
    Area,
    XAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import {
    MODULE_REGISTRY,
    MODULE_ORDER,
    isModuleEnabled,
    type SystemModule,
} from "@/lib/modules";

export default function SystemOverview() {
    const { system } = useOutletContext<{ system: DecisionSystem }>();
    const enabledModules = (system.enabled_modules as SystemModule[]) || MODULE_ORDER;

    // Fetch Stats
    const { data: stats } = useQuery({
        queryKey: ["stats", system.id],
        queryFn: async () => {
            const res = await api.get("/decisions/stats/overview", {
                params: { system_id: system.id },
            });
            return res.data;
        },
        refetchInterval: 5000,
    });

    const hasHistory = stats?.history && stats.history.length > 0;

    // Module status checks
    const hasCreditScoring = isModuleEnabled(enabledModules, "credit_scoring");
    const hasPolicyEngine = isModuleEnabled(enabledModules, "policy_engine");
    const hasFraudDetection = isModuleEnabled(enabledModules, "fraud_detection");
    const hasExposureControl = isModuleEnabled(enabledModules, "exposure_control");

    return (
        <div className="p-8 space-y-8 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold mb-1">System Overview</h2>
                    <p className="text-muted-foreground">
                        {system.description || "No description provided."}
                    </p>
                </div>
                {/* Stats Summary */}
                <div className="flex gap-4">
                    <div className="bg-card border px-4 py-2 rounded-lg shadow-sm">
                        <div className="text-xs text-muted-foreground font-medium uppercase">
                            24h Volume
                        </div>
                        <div className="text-xl font-bold">
                            {stats?.total_volume_24h || 0}
                        </div>
                    </div>
                    <div className="bg-card border px-4 py-2 rounded-lg shadow-sm">
                        <div className="text-xs text-muted-foreground font-medium uppercase">
                            Approval Rate
                        </div>
                        <div className="text-xl font-bold">
                            {((stats?.approval_rate_24h || 0) * 100).toFixed(1)}%
                        </div>
                    </div>
                </div>
            </div>

            {/* Module Cards Grid - Adaptive based on enabled modules */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Credit Scoring Card */}
                {hasCreditScoring && (
                    <Link
                        to={`/systems/${system.id}/models`}
                        className="group bg-card border rounded-xl p-6 shadow-sm hover:shadow-md hover:border-blue-300 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                                    <BrainCircuit className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <span className="font-semibold text-sm uppercase tracking-wider">
                                    Active Model
                                </span>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                        </div>
                        {system.active_model_summary ? (
                            <div>
                                <div className="text-xl font-bold text-foreground mb-1">
                                    {system.active_model_summary.name}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono truncate">
                                    {system.active_model_summary.id}
                                </div>
                                <div className="mt-2 text-green-600 font-bold text-sm">
                                    AUC: {(system.active_model_summary.auc * 100).toFixed(1)}%
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground text-sm">
                                No active model. Train your first model to get started.
                            </div>
                        )}
                    </Link>
                )}

                {/* Policy Engine Card */}
                {hasPolicyEngine && (
                    <Link
                        to={`/systems/${system.id}/policy`}
                        className="group bg-card border rounded-xl p-6 shadow-sm hover:shadow-md hover:border-purple-300 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <div className="p-2 bg-purple-50 dark:bg-purple-900/30 rounded-lg">
                                    <Sliders className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                </div>
                                <span className="font-semibold text-sm uppercase tracking-wider">
                                    Active Policy
                                </span>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-purple-600 transition-colors" />
                        </div>
                        {system.active_policy_summary ? (
                            <div>
                                <div className="text-2xl font-bold text-foreground mb-1">
                                    <span className="text-sm text-muted-foreground mr-1">
                                        Threshold:
                                    </span>
                                    {system.active_policy_summary.threshold}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    Est. Approval:{" "}
                                    {(system.active_policy_summary.approval_rate * 100).toFixed(1)}%
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground text-sm">
                                No active policy. Configure a threshold to start decisioning.
                            </div>
                        )}
                    </Link>
                )}

                {/* Fraud Detection Card */}
                {hasFraudDetection && (
                    <Link
                        to={`/systems/${system.id}/fraud`}
                        className="group bg-card border rounded-xl p-6 shadow-sm hover:shadow-md hover:border-orange-300 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <div className="p-2 bg-orange-50 dark:bg-orange-900/30 rounded-lg">
                                    <ShieldAlert className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                </div>
                                <span className="font-semibold text-sm uppercase tracking-wider">
                                    Fraud Detection
                                </span>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-orange-600 transition-colors" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Open Cases</span>
                                <span className="text-xl font-bold">
                                    {stats?.fraud_open_cases || 0}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">24h Flagged</span>
                                <span className="text-lg font-semibold text-orange-600">
                                    {stats?.fraud_flagged_24h || 0}
                                </span>
                            </div>
                        </div>
                    </Link>
                )}

                {/* Exposure Control Card */}
                {hasExposureControl && (
                    <Link
                        to={`/systems/${system.id}/exposure`}
                        className="group bg-card border rounded-xl p-6 shadow-sm hover:shadow-md hover:border-green-300 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg">
                                    <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="font-semibold text-sm uppercase tracking-wider">
                                    Exposure Control
                                </span>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-green-600 transition-colors" />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Utilization</span>
                                <span className="text-xl font-bold">
                                    {((stats?.exposure_utilization || 0) * 100).toFixed(1)}%
                                </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                                <div
                                    className={cn(
                                        "h-2 rounded-full transition-all",
                                        (stats?.exposure_utilization || 0) > 0.8
                                            ? "bg-red-500"
                                            : (stats?.exposure_utilization || 0) > 0.6
                                            ? "bg-yellow-500"
                                            : "bg-green-500"
                                    )}
                                    style={{
                                        width: `${Math.min((stats?.exposure_utilization || 0) * 100, 100)}%`,
                                    }}
                                />
                            </div>
                        </div>
                    </Link>
                )}

                {/* Volume Chart Card - Always visible */}
                <div
                    className={cn(
                        "bg-card border rounded-xl p-6 shadow-sm flex flex-col",
                        enabledModules.length <= 2 ? "md:col-span-2" : "lg:col-span-2"
                    )}
                >
                    <div className="flex items-center gap-2 mb-4 text-muted-foreground">
                        <BarChart3 className="h-5 w-5" />
                        <span className="font-semibold text-sm uppercase tracking-wider">
                            Volume Trend (7 Days)
                        </span>
                    </div>
                    <div className="flex-1 w-full min-h-[120px]">
                        {hasHistory ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats.history}>
                                    <defs>
                                        <linearGradient
                                            id="colorVolume"
                                            x1="0"
                                            y1="0"
                                            x2="0"
                                            y2="1"
                                        >
                                            <stop
                                                offset="5%"
                                                stopColor="#3b82f6"
                                                stopOpacity={0.1}
                                            />
                                            <stop
                                                offset="95%"
                                                stopColor="#3b82f6"
                                                stopOpacity={0}
                                            />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        vertical={false}
                                        stroke="#E5E7EB"
                                    />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: "8px",
                                            border: "none",
                                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                                        }}
                                        labelStyle={{ fontSize: "12px", color: "#6B7280" }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="volume"
                                        stroke="#3b82f6"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorVolume)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/20 rounded-lg">
                                Not enough data to display trends.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Active Modules Summary */}
            <div className="border rounded-xl p-6 bg-muted/20">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold">Active Modules</h3>
                    <Link
                        to={`/systems/${system.id}/modules`}
                        className="text-sm text-primary hover:underline"
                    >
                        Manage Modules
                    </Link>
                </div>
                <div className="flex flex-wrap gap-2">
                    {MODULE_ORDER.filter((m) => enabledModules.includes(m)).map(
                        (moduleId) => {
                            const mod = MODULE_REGISTRY[moduleId];
                            const Icon = mod.icon;
                            return (
                                <div
                                    key={moduleId}
                                    className={cn(
                                        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium",
                                        mod.badgeClasses
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {mod.name}
                                </div>
                            );
                        }
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <div className="border-t pt-8">
                <h3 className="font-semibold mb-4">Quick Actions</h3>
                <div className="flex flex-wrap gap-4">
                    {hasCreditScoring && (
                        <Link
                            to={`/systems/${system.id}/data`}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-card border shadow-sm rounded-md hover:bg-gray-50 dark:hover:bg-muted text-sm font-medium transition-colors"
                        >
                            <Database className="h-4 w-4 text-blue-500" /> Upload Data
                        </Link>
                    )}
                    {hasCreditScoring && (
                        <Link
                            to={`/systems/${system.id}/training`}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-card border shadow-sm rounded-md hover:bg-gray-50 dark:hover:bg-muted text-sm font-medium transition-colors"
                        >
                            <BrainCircuit className="h-4 w-4 text-blue-500" /> Train Model
                        </Link>
                    )}
                    {hasPolicyEngine && (
                        <Link
                            to={`/systems/${system.id}/policy`}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-card border shadow-sm rounded-md hover:bg-gray-50 dark:hover:bg-muted text-sm font-medium transition-colors"
                        >
                            <Sliders className="h-4 w-4 text-purple-500" /> Configure Policy
                        </Link>
                    )}
                    {hasFraudDetection && (
                        <Link
                            to={`/systems/${system.id}/fraud/queue`}
                            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-card border shadow-sm rounded-md hover:bg-gray-50 dark:hover:bg-muted text-sm font-medium transition-colors"
                        >
                            <ShieldAlert className="h-4 w-4 text-orange-500" /> Review Cases
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
