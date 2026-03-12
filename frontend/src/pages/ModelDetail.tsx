import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { ArrowLeft, BarChart2, Shield, FileDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

export default function ModelDetail() {
    const { systemId, id } = useParams<{ systemId: string, id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [docLoading, setDocLoading] = useState(false);

    const { data: model, isLoading } = useQuery<MLModel>({
        queryKey: ["model", id],
        queryFn: async () => {
            const res = await api.get(`/models/${id}`);
            return res.data;
        },
        enabled: !!id
    });

    const activateMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/models/${id}/activate`, {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["model", id] });
            queryClient.invalidateQueries({ queryKey: ["models", systemId] });
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
        },
    });

    const handleDownloadDoc = async () => {
        if (!id) return;
        setDocLoading(true);
        try {
            const res = await api.get(`/models/${id}/documentation`, { responseType: 'blob' });
            const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `sentinel_model_doc_${model?.name || id}.docx`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 200);
        } catch (e) {
            console.error('Documentation generation failed', e);
        } finally {
            setDocLoading(false);
        }
    };

    if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading model details...</div>;
    if (!model) return <div className="p-12 text-center text-red-500">Model not found.</div>;

    const featureImportance = model.metrics?.feature_importance || [];
    const calibration = model.metrics?.calibration || [];
    const auc = model.metrics?.auc || 0;
    const gini = model.metrics?.gini ?? (2 * auc - 1);
    const cvMean = model.metrics?.cv_auc_mean;
    const cvStd = model.metrics?.cv_auc_std;
    const dataProfile = model.metrics?.data_profile;

    // Average bad rate for reference line
    const avgBadRate = calibration.length > 0
        ? calibration.reduce((sum: number, d: any) => sum + d.actual_rate * d.count, 0) /
          calibration.reduce((sum: number, d: any) => sum + d.count, 0)
        : null;

    return (
        <div className="page animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/models`)}
                        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Model Registry
                    </button>
                    <h1 className="page-title flex items-center gap-3">
                        {model.name || "Untitled Model"}
                        {model.status === "ACTIVE" && (
                            <span className="badge badge-green">
                                <Shield className="h-3 w-3" /> ACTIVE CHAMPION
                            </span>
                        )}
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                        ID: {model.id} • Algorithm: <span className="capitalize text-foreground font-medium">{model.algorithm?.replace("_", " ")}</span>
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleDownloadDoc}
                        disabled={docLoading}
                        className="btn-outline gap-2"
                    >
                        {docLoading
                            ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                            : <><FileDown className="h-4 w-4" /> Generate Model Documentation</>
                        }
                    </button>
                    {model.status !== "ACTIVE" && (
                        <button
                            onClick={() => activateMutation.mutate()}
                            disabled={activateMutation.isPending}
                            className="btn-primary gap-2"
                        >
                            {activateMutation.isPending ? "Activating..." : "Activate for Decisioning"}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Col: Performance */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="panel p-5">
                        <h3 className="panel-title flex items-center gap-2 mb-3">
                            <BarChart2 className="h-5 w-5 text-blue-500" />
                            Performance
                        </h3>

                        <div className="space-y-5">
                            {/* AUC */}
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">AUC — Discrimination</p>
                                <div className="flex items-end gap-2 mt-1">
                                    <span className={cn(
                                        "text-3xl font-bold num",
                                        auc > 0.8 ? "text-up" : "text-warn"
                                    )}>
                                        {(auc * 100).toFixed(2)}%
                                    </span>
                                </div>
                                {cvMean != null && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        5-fold CV: <span className="font-mono font-medium text-foreground">{(cvMean * 100).toFixed(1)}%</span>
                                        {cvStd != null && <span className="text-muted-foreground"> ± {(cvStd * 100).toFixed(1)}%</span>}
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                    How well the model separates good vs. bad loans.
                                </p>
                            </div>

                            {/* Gini */}
                            <div className="pt-3 border-t">
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Gini Coefficient</p>
                                <p className={cn(
                                    "text-2xl font-bold mt-1",
                                    gini > 0.6 ? "text-up" : "text-warn"
                                )}>
                                    {(gini * 100).toFixed(1)}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Gini = 2 × AUC − 1. Industry benchmark: &gt;60%.</p>
                            </div>

                            {/* Data Profile */}
                            <div className="pt-3 border-t">
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">Training Data</p>
                                <div className="text-sm space-y-1">
                                    {dataProfile ? (
                                        <>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Total observations</span>
                                                <span className="font-medium">{dataProfile.total_rows?.toLocaleString()}</span>
                                            </div>
                                            {dataProfile.sampled && (
                                                <div className="flex justify-between py-0.5">
                                                    <span className="text-muted-foreground">Used in training</span>
                                                    <span className="font-medium text-warn">{dataProfile.total_rows_used?.toLocaleString()} (sampled)</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Train sample</span>
                                                <span className="font-medium">{dataProfile.train_rows?.toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Test sample</span>
                                                <span className="font-medium">{dataProfile.test_rows?.toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Target column</span>
                                                <span className="font-mono bg-muted px-1 rounded text-xs">{dataProfile.target_col}</span>
                                            </div>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Features</span>
                                                <span className="font-medium">{dataProfile.feature_count}</span>
                                            </div>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Default rate</span>
                                                <span className="font-medium">{((dataProfile.class_balance || 0) * 100).toFixed(1)}%</span>
                                            </div>
                                            {dataProfile.missing_pct > 0 && (
                                                <div className="flex justify-between py-0.5">
                                                    <span className="text-muted-foreground">Missing values</span>
                                                    <span className="font-medium text-warn">{dataProfile.missing_pct.toFixed(1)}%</span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between py-0.5">
                                                <span className="text-muted-foreground">Train / Test split</span>
                                                <span className="font-medium">80% / 20%</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground pt-1">Retrain to see observation counts and target column.</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Col: Feature Importance & Lift Chart */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Feature Importance — SHAP-colored bars, no table */}
                    <div className="panel p-5">
                        <h3 className="text-sm font-semibold mb-1">Top Risk Drivers</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            SHAP-based importance. <span className="text-down font-medium">Red</span> = increases charge-off risk, <span className="text-up font-medium">green</span> = decreases it.
                        </p>

                        {featureImportance.length > 0 ? (
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        layout="vertical"
                                        data={featureImportance}
                                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="feature" type="category" width={150} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                                        <Tooltip
                                            formatter={(value: any, _name: any, props: any) => [
                                                `${value.toFixed(4)} (${props.payload.impact})`,
                                                "SHAP Importance"
                                            ]}
                                            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                        />
                                        <Bar dataKey="importance" radius={[0, 4, 4, 0]} barSize={20}>
                                            {featureImportance.map((feat: any, index: number) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={feat.impact?.includes("Increases") ? "#ef4444" : "#22c55e"}
                                                    fillOpacity={1 - index * 0.04}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg">
                                Feature importance not available for this model.
                            </div>
                        )}
                    </div>

                    {/* Lift / Decile Chart */}
                    <div className="panel p-5">
                        <div className="flex items-start justify-between mb-1">
                            <h3 className="text-sm font-semibold">Risk by Decile</h3>
                            <span className="badge badge-muted text-xs">Out-of-sample (test set only)</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                            Actual default rate per score decile. A steep slope from left to right indicates strong model lift.
                            Dashed line shows the population average.
                        </p>
                        {dataProfile?.test_rows && (
                            <p className="text-xs text-muted-foreground mb-4">
                                Based on <span className="font-medium text-foreground">{dataProfile.test_rows.toLocaleString()}</span> held-out test observations (20% of training data, never seen by the model).
                            </p>
                        )}
                        {!dataProfile?.test_rows && <div className="mb-4" />}

                        {calibration.length > 0 ? (
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={calibration}
                                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                        <XAxis
                                            dataKey="decile"
                                            label={{ value: 'Score Decile (Low Risk → High Risk)', position: 'insideBottom', offset: -5 }}
                                            tickLine={false}
                                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                                        />
                                        <YAxis
                                            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                                            label={{ value: 'Default Rate', angle: -90, position: 'insideLeft' }}
                                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                                        />
                                        <Tooltip
                                            cursor={{ fill: 'transparent' }}
                                            content={({ active, payload, label }) => {
                                                if (active && payload && payload.length) {
                                                    const data = payload[0].payload;
                                                    return (
                                                        <div style={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", padding: "8px 12px" }} className="text-xs">
                                                            <p className="font-bold mb-1">Decile {label}</p>
                                                            <p className="text-info">Default Rate: {(data.actual_rate * 100).toFixed(2)}%</p>
                                                            <p className="text-muted-foreground mt-1">Count: {data.count} | Score: {data.min_score?.toFixed(3)}–{data.max_score?.toFixed(3)}</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        {avgBadRate != null && (
                                            <ReferenceLine
                                                y={avgBadRate}
                                                stroke="#f97316"
                                                strokeDasharray="5 5"
                                                label={{ value: `Avg ${(avgBadRate * 100).toFixed(1)}%`, position: 'right', fontSize: 10, fill: '#f97316' }}
                                            />
                                        )}
                                        <Bar dataKey="actual_rate" radius={[4, 4, 0, 0]}>
                                            {calibration.map((entry: any, index: number) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.actual_rate > (avgBadRate ?? 0) ? "#ef4444" : "#3b82f6"}
                                                    fillOpacity={0.85}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg">
                                Calibration data not available.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
