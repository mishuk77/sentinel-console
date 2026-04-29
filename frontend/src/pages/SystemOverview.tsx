import { useOutletContext, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DecisionSystem } from "@/lib/api";
import {
    BarChart3, Database, ShieldAlert, DollarSign,
    BrainCircuit, Sliders, ArrowRight,
} from "lucide-react";
import {
    AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { MODULE_REGISTRY, MODULE_ORDER, getModulesForSystemType } from "@/lib/modules";
import { HealthStatusBadge } from "@/components/ui/HealthStatusBadge";

const CHART_PRIMARY = "hsl(210,100%,58%)";

export default function SystemOverview() {
    const { system } = useOutletContext<{ system: DecisionSystem }>();
    const enabledModules = getModulesForSystemType(system.system_type || "full");

    const { data: stats } = useQuery({
        queryKey: ["stats", system.id],
        queryFn: async () => {
            const r = await api.get("/decisions/stats/overview", { params: { system_id: system.id } });
            return r.data;
        },
        refetchInterval: 5000,
    });

    const hasHistory = stats?.history && stats.history.length > 0;
    const hasCreditScoring   = enabledModules.includes("credit_scoring");
    const hasPolicyEngine    = enabledModules.includes("policy_engine");
    const hasFraudDetection  = enabledModules.includes("fraud_detection");
    const hasExposureControl = enabledModules.includes("exposure_control");

    return (
        <div className="page">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="page-title flex items-center gap-3">
                        System Overview
                        {/* TASK-10 Layer 3: surfaces runtime monitor verdict */}
                        <HealthStatusBadge
                            status={(system as any)?.runtime_health_status}
                            size="sm"
                            layerLabel="Layer 3 (runtime monitor)"
                        />
                    </h2>
                    <p className="page-desc">{system.description || "No description provided."}</p>
                </div>
                <div className="flex gap-3">
                    <div className="kpi min-w-[100px]">
                        <p className="kpi-label">24h Volume</p>
                        <p className="kpi-value">{(stats?.total_volume_24h ?? 0).toLocaleString()}</p>
                    </div>
                    <div className="kpi min-w-[100px]">
                        <p className="kpi-label">Approval Rate</p>
                        <p className="kpi-value text-up">
                            {((stats?.approval_rate_24h ?? 0) * 100).toFixed(1)}%
                        </p>
                    </div>
                </div>
            </div>

            {/* Module cards + chart grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Credit Scoring */}
                {hasCreditScoring && (
                    <Link
                        to={`/systems/${system.id}/models`}
                        className="group panel p-5 hover:border-primary/40 transition-colors"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="icon-box-sm bg-info/10">
                                    <BrainCircuit className="h-3.5 w-3.5 text-info" />
                                </div>
                                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Active Model
                                </span>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        {system.active_model_summary ? (
                            <div>
                                <p className="text-sm font-bold text-foreground mb-0.5 truncate">
                                    {system.active_model_summary.name}
                                </p>
                                <p className="text-2xs text-muted-foreground font-mono truncate mb-2">
                                    {system.active_model_summary.id}
                                </p>
                                <span className="badge badge-green">
                                    AUC {(system.active_model_summary.auc * 100).toFixed(1)}%
                                </span>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No active model — train your first model.</p>
                        )}
                    </Link>
                )}

                {/* Policy Engine */}
                {hasPolicyEngine && (
                    <Link
                        to={`/systems/${system.id}/policy`}
                        className="group panel p-5 hover:border-primary/40 transition-colors"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="icon-box-sm bg-primary/10">
                                    <Sliders className="h-3.5 w-3.5 text-primary" />
                                </div>
                                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Active Policy
                                </span>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        {system.active_policy_summary ? (
                            <div>
                                <p className="text-sm font-bold text-foreground mb-0.5">
                                    Threshold: <span className="font-mono">{system.active_policy_summary.threshold}</span>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Est. approval: {(system.active_policy_summary.approval_rate * 100).toFixed(1)}%
                                </p>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No active policy — configure a threshold.</p>
                        )}
                    </Link>
                )}

                {/* Fraud Detection */}
                {hasFraudDetection && (
                    <Link
                        to={`/systems/${system.id}/fraud/detection`}
                        className="group panel p-5 hover:border-primary/40 transition-colors"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="icon-box-sm bg-warn/10">
                                    <ShieldAlert className="h-3.5 w-3.5 text-warn" />
                                </div>
                                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Fraud Detection
                                </span>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-2xl font-bold num">{stats?.fraud_open_cases ?? 0}</p>
                                <p className="text-xs text-muted-foreground">Open cases</p>
                            </div>
                            <div className="text-right">
                                <p className="text-lg font-semibold text-warn num">{stats?.fraud_flagged_24h ?? 0}</p>
                                <p className="text-xs text-muted-foreground">24h flagged</p>
                            </div>
                        </div>
                    </Link>
                )}

                {/* Exposure Control */}
                {hasExposureControl && (
                    <Link
                        to={`/systems/${system.id}/exposure`}
                        className="group panel p-5 hover:border-primary/40 transition-colors"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className="icon-box-sm bg-up/10">
                                    <DollarSign className="h-3.5 w-3.5 text-up" />
                                </div>
                                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Exposure Control
                                </span>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <p className="text-2xl font-bold num">
                            {((stats?.exposure_utilization ?? 0) * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">Utilization</p>
                        <div className="w-full bg-muted rounded-full h-1.5">
                            <div
                                className={cn(
                                    "h-1.5 rounded-full transition-all",
                                    (stats?.exposure_utilization ?? 0) > 0.8 ? "bg-down"
                                        : (stats?.exposure_utilization ?? 0) > 0.6 ? "bg-warn"
                                        : "bg-up"
                                )}
                                style={{ width: `${Math.min((stats?.exposure_utilization ?? 0) * 100, 100)}%` }}
                            />
                        </div>
                    </Link>
                )}

                {/* Volume chart card */}
                <div className={cn(
                    "panel p-5 flex flex-col",
                    enabledModules.length <= 2 ? "md:col-span-2" : "lg:col-span-2"
                )}>
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Volume Trend (7 Days)
                        </span>
                    </div>
                    <div className="flex-1 min-h-[120px]">
                        {hasHistory ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats.history} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradVol" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%"  stopColor={CHART_PRIMARY} stopOpacity={0.15} />
                                            <stop offset="95%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: "hsl(var(--popover))",
                                            border: "1px solid hsl(var(--border))",
                                            borderRadius: "var(--radius)",
                                            fontSize: "11px",
                                        }}
                                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="volume"
                                        stroke={CHART_PRIMARY}
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#gradVol)"
                                        dot={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs text-muted-foreground bg-muted/20 rounded">
                                Not enough data to display trends.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Active modules */}
            <div className="panel">
                <div className="panel-head">
                    <span className="panel-title">Active Modules</span>
                    <Link to={`/systems/${system.id}/modules`} className="text-xs text-primary hover:underline">
                        Manage →
                    </Link>
                </div>
                <div className="panel-body">
                    <div className="flex flex-wrap gap-2">
                        {MODULE_ORDER.filter(m => enabledModules.includes(m)).map(moduleId => {
                            const mod = MODULE_REGISTRY[moduleId];
                            const Icon = mod.icon;
                            return (
                                <div key={moduleId} className={cn("badge", mod.badgeClasses)}>
                                    <Icon className="h-3 w-3" />
                                    {mod.name}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Quick actions */}
            <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                    {hasCreditScoring && (
                        <Link to={`/systems/${system.id}/data`} className="btn-outline btn-sm">
                            <Database className="h-3 w-3 text-info" /> Upload Data
                        </Link>
                    )}
                    {hasCreditScoring && (
                        <Link to={`/systems/${system.id}/training`} className="btn-outline btn-sm">
                            <BrainCircuit className="h-3 w-3 text-info" /> Train Model
                        </Link>
                    )}
                    {hasPolicyEngine && (
                        <Link to={`/systems/${system.id}/policy`} className="btn-outline btn-sm">
                            <Sliders className="h-3 w-3 text-primary" /> Configure Policy
                        </Link>
                    )}
                    {hasFraudDetection && (
                        <Link to={`/systems/${system.id}/fraud/queue`} className="btn-outline btn-sm">
                            <ShieldAlert className="h-3 w-3 text-warn" /> Review Cases
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
