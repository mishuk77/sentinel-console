import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ShieldAlert, Activity, Target, ArrowRight, BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FraudOverview() {
    const { systemId } = useParams<{ systemId: string }>();
    const navigate = useNavigate();

    const { data: allModels } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const { data: tierConfig } = useQuery({
        queryKey: ["fraud-tiers", systemId],
        queryFn: async () => {
            const res = await api.get(`/fraud/tiers`, { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const fraudModels = allModels?.filter(m => (m.metrics as any)?.model_context === "fraud") || [];
    const activeModel = fraudModels.find(m => m.status === "ACTIVE");
    const candidateCount = fraudModels.filter(m => m.status === "CANDIDATE").length;

    const calibration = activeModel?.metrics?.calibration as any[] | undefined;
    const auc = activeModel?.metrics?.auc;
    const gini = activeModel?.metrics?.gini;
    const binCount = calibration?.length || 0;

    // Compute tier distribution from calibration
    const tierDistribution = (() => {
        if (!calibration || !tierConfig) return null;
        const { low_max, medium_max, high_max } = tierConfig;
        const maxDecile = Math.max(...calibration.map((b: any) => b.decile));
        let low = 0, med = 0, high = 0, crit = 0;
        calibration.forEach((bin: any) => {
            const score = bin.decile / maxDecile;
            if (score <= low_max) low += bin.count;
            else if (score <= medium_max) med += bin.count;
            else if (score <= high_max) high += bin.count;
            else crit += bin.count;
        });
        const total = low + med + high + crit;
        return { low, med, high, crit, total };
    })();

    const chartData = calibration?.map((bin: any) => ({
        decile: bin.decile,
        fraud_rate: +(bin.actual_rate * 100).toFixed(2),
        count: bin.count,
    })) || [];

    return (
        <div className="page">
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <ShieldAlert className="h-6 w-6 text-warn" />
                    Fraud Overview
                </h1>
                <p className="page-desc">At-a-glance fraud detection status for this system.</p>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="kpi">
                    <div className="kpi-label">Active Model</div>
                    <div className="kpi-value">{activeModel ? "1" : "—"}</div>
                    <div className="kpi-sub">{activeModel?.algorithm?.replace("_", " ") || "None activated"}</div>
                </div>
                <div className="kpi">
                    <div className="kpi-label">AUC</div>
                    <div className={cn("kpi-value", auc && auc > 0.8 ? "text-up" : "")}>
                        {auc ? `${(auc * 100).toFixed(1)}%` : "—"}
                    </div>
                    <div className="kpi-sub">{gini ? `Gini ${(gini * 100).toFixed(1)}%` : "No model"}</div>
                </div>
                <div className="kpi">
                    <div className="kpi-label">Risk Bins</div>
                    <div className="kpi-value">{binCount || "—"}</div>
                    <div className="kpi-sub">Calibration deciles</div>
                </div>
                <div className="kpi">
                    <div className="kpi-label">Candidates</div>
                    <div className="kpi-value">{candidateCount}</div>
                    <div className="kpi-sub">{fraudModels.length} total fraud models</div>
                </div>
            </div>

            {/* Tier Distribution */}
            {tierDistribution && (
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title">Tier Distribution</h3>
                        <span className="text-2xs text-muted-foreground">{tierDistribution.total.toLocaleString()} scored observations</span>
                    </div>
                    <div className="p-5">
                        <div className="flex gap-3 mb-4">
                            {[
                                { label: "Low", count: tierDistribution.low, color: "bg-up", textColor: "text-up" },
                                { label: "Medium", count: tierDistribution.med, color: "bg-warn", textColor: "text-warn" },
                                { label: "High", count: tierDistribution.high, color: "bg-[hsl(25,95%,53%)]", textColor: "text-[hsl(25,95%,53%)]" },
                                { label: "Critical", count: tierDistribution.crit, color: "bg-down", textColor: "text-down" },
                            ].map(t => (
                                <div key={t.label} className="flex-1 text-center">
                                    <div className="text-xs text-muted-foreground mb-1">{t.label}</div>
                                    <div className={cn("text-lg font-bold", t.textColor)}>{t.count.toLocaleString()}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                        {((t.count / tierDistribution.total) * 100).toFixed(1)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="h-3 flex rounded-full overflow-hidden">
                            <div className="bg-up" style={{ width: `${(tierDistribution.low / tierDistribution.total) * 100}%` }} />
                            <div className="bg-warn" style={{ width: `${(tierDistribution.med / tierDistribution.total) * 100}%` }} />
                            <div className="bg-[hsl(25,95%,53%)]" style={{ width: `${(tierDistribution.high / tierDistribution.total) * 100}%` }} />
                            <div className="bg-down" style={{ width: `${(tierDistribution.crit / tierDistribution.total) * 100}%` }} />
                        </div>
                    </div>
                </div>
            )}

            {/* Chart */}
            {chartData.length > 0 && (
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title">Fraud Rate by Risk Decile</h3>
                    </div>
                    <div className="p-4 h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="decile"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false} axisLine={false} />
                                <YAxis
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                    formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(2)}%`, "Fraud Rate"]}
                                    labelFormatter={(l) => `Decile ${l}`}
                                />
                                <Bar dataKey="fraud_rate" fill="hsl(0,68%,52%)" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* No model state */}
            {!activeModel && (
                <div className="panel p-10 text-center">
                    <div className="bg-muted/30 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                        <BrainCircuit className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-base font-semibold mb-2">No Active Fraud Model</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                        Train and activate a fraud model to see performance metrics and tier distribution here.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        <button onClick={() => navigate(`/systems/${systemId}/fraud/training`)} className="btn-primary btn-sm">
                            <BrainCircuit className="h-3.5 w-3.5" /> Train Models
                        </button>
                        {candidateCount > 0 && (
                            <button onClick={() => navigate(`/systems/${systemId}/fraud/models`)} className="btn-outline btn-sm">
                                View Candidates <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Quick links */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button onClick={() => navigate(`/systems/${systemId}/fraud/data`)}
                    className="panel p-4 text-left hover:shadow-md transition-shadow group">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-info/10"><Activity className="h-4 w-4 text-info" /></div>
                        <div>
                            <p className="text-sm font-semibold group-hover:text-primary transition-colors">Fraud Data</p>
                            <p className="text-xs text-muted-foreground">Manage datasets</p>
                        </div>
                    </div>
                </button>
                <button onClick={() => navigate(`/systems/${systemId}/fraud/training`)}
                    className="panel p-4 text-left hover:shadow-md transition-shadow group">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-warn/10"><BrainCircuit className="h-4 w-4 text-warn" /></div>
                        <div>
                            <p className="text-sm font-semibold group-hover:text-primary transition-colors">Train Models</p>
                            <p className="text-xs text-muted-foreground">Start training runs</p>
                        </div>
                    </div>
                </button>
                <button onClick={() => navigate(`/systems/${systemId}/fraud/tiers`)}
                    className="panel p-4 text-left hover:shadow-md transition-shadow group">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-down/10"><Target className="h-4 w-4 text-down" /></div>
                        <div>
                            <p className="text-sm font-semibold group-hover:text-primary transition-colors">Risk Tiers</p>
                            <p className="text-xs text-muted-foreground">Configure thresholds</p>
                        </div>
                    </div>
                </button>
            </div>
        </div>
    );
}
