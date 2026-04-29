import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { ArrowLeft, BarChart2, Shield, FileDown, Loader2, Cpu, Zap, ShieldCheck, Layers, ChevronDown, ChevronUp, FlaskConical, Target, Scale, Scissors, Binary, GitMerge, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HealthStatusBadge } from "@/components/ui/HealthStatusBadge";
import { HealthReportPanel } from "@/components/ui/HealthReportPanel";
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Cell, ReferenceLine, Legend
} from "recharts";

const ALGO_DISPLAY: Record<string, string> = {
    logistic_regression: "Logistic Regression",
    random_forest: "Random Forest",
    xgboost: "XGBoost",
    lightgbm: "LightGBM",
    ensemble: "Stacked Ensemble",
};

export default function ModelDetail() {
    const { systemId, id } = useParams<{ systemId: string, id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [docLoading, setDocLoading] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [showPerformance, setShowPerformance] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    const { data: model, isLoading } = useQuery<MLModel>({
        queryKey: ["model", id],
        queryFn: async () => {
            const res = await api.get(`/models/${id}`);
            return res.data;
        },
        enabled: !!id
    });

    const [activateError, setActivateError] = useState<string | null>(null);
    const activateMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/models/${id}/activate`, {});
        },
        onSuccess: () => {
            setActivateError(null);
            queryClient.invalidateQueries({ queryKey: ["model", id] });
            queryClient.invalidateQueries({ queryKey: ["models", systemId] });
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail
                || err?.message
                || "Failed to activate model.";
            setActivateError(typeof detail === "string" ? detail : JSON.stringify(detail));
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
    const classMetrics = model.metrics?.classification_metrics;
    const td = model.metrics?.training_details;
    const auc = model.metrics?.auc || 0;
    const gini = model.metrics?.gini ?? (2 * auc - 1);
    const cvMean = model.metrics?.cv_auc_mean;
    const cvStd = model.metrics?.cv_auc_std;
    const dataProfile = model.metrics?.data_profile;
    const algoDisplay = ALGO_DISPLAY[model.algorithm] || model.algorithm?.replace("_", " ");
    const curveData = model.metrics?.curve_data;

    // Average bad rate for reference line
    const avgBadRate = calibration.length > 0
        ? calibration.reduce((sum: number, d: any) => sum + d.actual_rate * d.count, 0) /
          calibration.reduce((sum: number, d: any) => sum + d.count, 0)
        : null;

    // Pipeline steps that were applied (derive from training_details)
    const pipelineSteps = td ? [
        { icon: Target, label: "Class Imbalance", value: td.class_weight ? `Balanced weights (${((dataProfile?.class_balance || 0) * 100).toFixed(1)}% minority)` : "No rebalancing needed", active: !!td.class_weight },
        { icon: Binary, label: "Target Encoding", value: td.target_encoding ? "Bayesian smoothing applied" : "No categorical features", active: !!td.target_encoding },
        { icon: Scissors, label: "Outlier Handling", value: td.outlier_handling !== "None" ? td.outlier_handling : "No outliers detected", active: td.outlier_handling !== "None" },
        { icon: Scale, label: "Feature Scaling", value: td.scaling || "None", active: td.scaling !== "None" },
        { icon: FlaskConical, label: "Hyperparameter Search", value: td.configs_searched ? `${td.configs_searched} configurations × 3-fold CV` : "Default parameters", active: (td.configs_searched || 0) > 1 },
        { icon: ShieldCheck, label: "Overfitting Check", value: td.overfit_gap != null ? `Gap: ${(td.overfit_gap * 100).toFixed(2)}% — ${td.overfit_risk} risk` : "N/A", active: true },
    ] : [];

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
                        <span className="capitalize">{algoDisplay}</span>
                        {model.status === "ACTIVE" && (
                            <span className="badge badge-green">
                                <Shield className="h-3 w-3" /> ACTIVE CHAMPION
                            </span>
                        )}
                        <HealthStatusBadge
                            status={model.health_status}
                            size="sm"
                            layerLabel="Training-time health check"
                        />
                    </h1>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {model.name} • ID: {model.id}
                        {model.target_column && (
                            <span className="ml-2">
                                · Target: <span className="text-foreground">{model.target_column}</span>
                            </span>
                        )}
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
                            : <><FileDown className="h-4 w-4" /> Model Documentation</>
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

            {activateError && (
                <div className="panel p-3 border-destructive/30 bg-destructive/5 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-destructive">Activation failed</p>
                        <p className="text-2xs text-destructive/90 break-words">{activateError}</p>
                    </div>
                    <button onClick={() => setActivateError(null)} className="text-destructive/70 hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* ── Hero KPI Row ───────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="panel p-4 text-center">
                    <p className="kpi-label">AUC</p>
                    <p className={cn("text-3xl font-bold", auc > 0.8 ? "text-up" : auc > 0.7 ? "text-warn" : "text-down")}>
                        {(auc * 100).toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">Holdout discrimination</p>
                </div>
                <div className="panel p-4 text-center">
                    <p className="kpi-label">Gini</p>
                    <p className={cn("text-3xl font-bold", gini > 0.6 ? "text-up" : gini > 0.4 ? "text-warn" : "text-down")}>
                        {(gini * 100).toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">2 × AUC − 1</p>
                </div>
                <div className="panel p-4 text-center">
                    <p className="kpi-label">3-Fold CV</p>
                    <p className="text-3xl font-bold">
                        {cvMean != null ? `${(cvMean * 100).toFixed(1)}%` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        {cvStd != null ? `± ${(cvStd * 100).toFixed(1)}% stability` : "Cross-validation"}
                    </p>
                </div>
                <div className="panel p-4 text-center">
                    <p className="kpi-label">Overfit Risk</p>
                    <p className={cn(
                        "text-3xl font-bold",
                        td?.overfit_risk === "High" ? "text-down" :
                        td?.overfit_risk === "Moderate" ? "text-warn" : "text-up"
                    )}>
                        {td?.overfit_risk || "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        {td?.overfit_gap != null ? `Train-test gap: ${(td.overfit_gap * 100).toFixed(2)}%` : "Train vs holdout"}
                    </p>
                </div>
            </div>

            {/* ── Training Pipeline Intelligence ──────────────── */}
            {td && (
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-info" />
                            Training Pipeline Intelligence
                        </h3>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {td.configs_searched || 1} configs • {dataProfile?.feature_count || "?"} features • {dataProfile?.train_rows?.toLocaleString() || "?"} training rows
                        </span>
                    </div>

                    {/* Pipeline steps grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border">
                        {pipelineSteps.map((step) => (
                            <div key={step.label} className="bg-card p-4 flex items-start gap-3">
                                <div className={cn(
                                    "icon-box-sm shrink-0 mt-0.5",
                                    step.active ? "bg-info/10 text-info" : "bg-muted/50 text-muted-foreground"
                                )}>
                                    <step.icon className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold">{step.label}</p>
                                    <p className={cn(
                                        "text-[11px] mt-0.5",
                                        step.active ? "text-foreground" : "text-muted-foreground"
                                    )}>{step.value}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Expandable best hyperparameters */}
                    {td.best_params && Object.keys(td.best_params).length > 0 && (
                        <div className="border-t">
                            <button
                                onClick={() => setShowParams(!showParams)}
                                className="w-full px-5 py-2.5 flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                            >
                                <span className="flex items-center gap-2">
                                    <Zap className="h-3.5 w-3.5 text-info" />
                                    Winning Hyperparameters — {Object.keys(td.best_params).length} parameters tuned
                                </span>
                                {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {showParams && (
                                <div className="px-5 pb-4 animate-in fade-in slide-in-from-top-2">
                                    <div className="bg-black/20 rounded-lg border border-border/50 p-3 font-mono text-[11px] space-y-1">
                                        {Object.entries(td.best_params).map(([key, val]) => (
                                            <div key={key} className="flex items-center gap-2">
                                                <span className="text-info">{key}:</span>
                                                <span className="text-foreground">
                                                    {typeof val === "number" ? (Number.isInteger(val) ? val : val.toFixed(4)) : String(val)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Classification Metrics + Data Profile row ──── */}
            {classMetrics && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Classification Metrics */}
                    <div className="panel p-5">
                        <h3 className="panel-title flex items-center gap-2 mb-4">
                            <Layers className="h-4 w-4 text-info" />
                            Classification Metrics
                            <span className="text-[10px] text-muted-foreground font-normal ml-auto">@ 0.50 threshold</span>
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { label: "Precision (PPV)", value: classMetrics.ppv, desc: "Of predicted bad, % actually bad" },
                                { label: "Recall (TPR)", value: classMetrics.tpr, desc: "Of actual bad, % caught" },
                                { label: "F1 Score", value: classMetrics.f1, desc: "Harmonic mean of precision & recall" },
                                { label: "Specificity (TNR)", value: classMetrics.tnr, desc: "Of actual good, % correctly approved" },
                                { label: "Accuracy", value: classMetrics.accuracy, desc: "Overall correct predictions" },
                                { label: "MCC", value: classMetrics.mcc, desc: "Matthew's correlation (-1 to +1)" },
                            ].map(({ label, value, desc }) => (
                                <div key={label} className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{label}</p>
                                    <p className={cn(
                                        "text-xl font-bold mt-0.5",
                                        value != null && value > 0.7 ? "text-up" : value != null && value > 0.4 ? "text-foreground" : "text-warn"
                                    )}>
                                        {value != null ? (label === "MCC" ? value.toFixed(3) : `${(value * 100).toFixed(1)}%`) : "—"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Training Data Profile */}
                    <div className="panel p-5">
                        <h3 className="panel-title flex items-center gap-2 mb-4">
                            <BarChart2 className="h-4 w-4 text-info" />
                            Training Data Profile
                        </h3>
                        <div className="text-sm space-y-2">
                            {dataProfile ? (
                                <>
                                    {[
                                        { label: "Total observations", value: dataProfile.total_rows?.toLocaleString() },
                                        ...(dataProfile.sampled ? [{ label: "Sampled to", value: `${dataProfile.total_rows_used?.toLocaleString()} rows`, warn: true }] : []),
                                        { label: "Train sample (80%)", value: dataProfile.train_rows?.toLocaleString() },
                                        { label: "Holdout test (20%)", value: dataProfile.test_rows?.toLocaleString() },
                                        { label: "Features used", value: dataProfile.feature_count },
                                        { label: "Target column", value: dataProfile.target_col, mono: true },
                                        { label: "Minority class rate", value: `${((dataProfile.class_balance || 0) * 100).toFixed(1)}%` },
                                        ...(dataProfile.missing_pct > 0 ? [{ label: "Missing values", value: `${dataProfile.missing_pct.toFixed(1)}%`, warn: true }] : []),
                                    ].map((row: any) => (
                                        <div key={row.label} className="flex justify-between py-1 border-b border-border/30 last:border-0">
                                            <span className="text-muted-foreground">{row.label}</span>
                                            <span className={cn(
                                                "font-medium",
                                                row.warn && "text-warn",
                                                row.mono && "font-mono bg-muted px-1.5 rounded text-xs"
                                            )}>{row.value}</span>
                                        </div>
                                    ))}
                                    {td?.train_auc != null && (
                                        <div className="flex justify-between py-1">
                                            <span className="text-muted-foreground">Train AUC</span>
                                            <span className="font-medium font-mono">{(td.train_auc * 100).toFixed(2)}%</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-muted-foreground">Retrain to populate data profile.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Charts: Feature Importance + Lift ────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Feature Importance */}
                <div className="lg:col-span-1 panel p-5">
                    <h3 className="text-sm font-semibold mb-4">Top Risk Drivers</h3>

                    {featureImportance.length > 0 ? (
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    layout="vertical"
                                    data={featureImportance}
                                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="feature" type="category" width={120} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                    <Tooltip
                                        formatter={(value: any) => [
                                            value.toFixed(4),
                                            "Importance"
                                        ]}
                                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                    />
                                    {/* Uniform blue across all models — feature_importances_
                                        for tree models has no directional sign, and even LR
                                        coefficients can be misleading after preprocessing
                                        (target encoding, scaling). Magnitude is what's
                                        actually being shown. */}
                                    <Bar dataKey="importance" radius={[0, 4, 4, 0]} barSize={18}>
                                        {featureImportance.map((_feat: any, index: number) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill="hsl(210,100%,58%)"
                                                fillOpacity={1 - index * 0.04}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">
                            Feature importance not available.
                        </div>
                    )}
                </div>

                {/* Lift / Decile Chart */}
                <div className="lg:col-span-2 panel p-5">
                    <div className="flex items-start justify-between mb-1">
                        <h3 className="text-sm font-semibold">Observed Bad Rate by Score Bin</h3>
                        <span className="badge badge-muted text-xs">Out-of-sample (holdout)</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                        Actual default rate per score decile. Steep slope = strong model lift.
                    </p>
                    {dataProfile?.test_rows && (
                        <p className="text-[10px] text-muted-foreground mb-4">
                            Based on <span className="font-medium text-foreground">{dataProfile.test_rows.toLocaleString()}</span> held-out observations.
                        </p>
                    )}
                    {!dataProfile?.test_rows && <div className="mb-4" />}

                    {calibration.length > 0 ? (
                        <div className="h-[320px] w-full">
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
                        <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">
                            Calibration data not available.
                        </div>
                    )}
                </div>
            </div>

            {/* ── Performance Curves (collapsible) ────────────── */}
            {curveData && (
                <div className="panel">
                    <button
                        onClick={() => setShowPerformance(!showPerformance)}
                        className="w-full panel-head cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <h3 className="panel-title flex items-center gap-2">
                            <BarChart2 className="h-4 w-4 text-info" />
                            Discrimination &amp; Separation
                        </h3>
                        <div className="flex items-center gap-3">
                            {curveData.ks_plot && (
                                <span className="badge badge-blue text-[10px]">KS: {(curveData.ks_plot.ks_statistic * 100).toFixed(1)}%</span>
                            )}
                            {showPerformance ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                    </button>
                    {showPerformance && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5 animate-in fade-in slide-in-from-top-2">
                            {/* ROC Curve */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">ROC Curve</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">True positive rate vs false positive rate — AUC: {(auc * 100).toFixed(1)}%</p>
                                {curveData.roc && curveData.roc.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={curveData.roc} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "FPR", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "TPR", angle: -90, position: "insideLeft", offset: 10, fontSize: 10 }} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any) => [(v as number).toFixed(4)]} />
                                                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={1} />
                                                <Line dataKey="tpr" stroke="hsl(210,100%,58%)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate ROC curve.</div>
                                )}
                            </div>

                            {/* Precision-Recall Curve */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Precision-Recall Curve</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Precision vs recall tradeoff — critical for imbalanced classes</p>
                                {curveData.precision_recall && curveData.precision_recall.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={curveData.precision_recall.filter(d => d.recall > 0)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="recall" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Recall", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Precision", angle: -90, position: "insideLeft", offset: 10, fontSize: 10 }} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any) => [(v as number).toFixed(4)]} />
                                                <Line dataKey="precision" stroke="hsl(142,68%,40%)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate PR curve.</div>
                                )}
                            </div>

                            {/* Cumulative Gains */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Cumulative Gains</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">% of positives captured vs % of population reviewed</p>
                                {curveData.cumulative_gains && curveData.cumulative_gains.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={curveData.cumulative_gains} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="pct_population" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} label={{ value: "% Population", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} label={{ value: "% Captured", angle: -90, position: "insideLeft", offset: 10, fontSize: 10 }} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any) => [`${((v as number) * 100).toFixed(1)}%`]} />
                                                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={1} />
                                                <Area dataKey="pct_gain" stroke="hsl(210,100%,58%)" fill="hsl(210,100%,58%)" fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate gains chart.</div>
                                )}
                            </div>

                            {/* KS Plot */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">KS Plot (Kolmogorov-Smirnov)</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Max separation between cumulative distributions{curveData.ks_plot ? ` — KS: ${(curveData.ks_plot.ks_statistic * 100).toFixed(1)}%` : ""}</p>
                                {curveData.ks_plot && curveData.ks_plot.points.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={curveData.ks_plot.points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="threshold_pct" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any, name?: string) => [`${((v as number) * 100).toFixed(1)}%`, name?.toUpperCase() ?? ""]} />
                                                <Legend wrapperStyle={{ fontSize: "10px" }} />
                                                <Line dataKey="tpr" name="TPR (Positive)" stroke="hsl(142,68%,40%)" strokeWidth={2} dot={false} />
                                                <Line dataKey="fpr" name="FPR (Negative)" stroke="hsl(0,68%,52%)" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate KS plot.</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Calibration & Threshold Analysis (collapsible) ── */}
            {curveData && (
                <div className="panel">
                    <button
                        onClick={() => setShowDiagnostics(!showDiagnostics)}
                        className="w-full panel-head cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <h3 className="panel-title flex items-center gap-2">
                            <Target className="h-4 w-4 text-info" />
                            Calibration &amp; Threshold Analysis
                        </h3>
                        <div className="flex items-center gap-3">
                            {curveData.confusion_matrix && (
                                <span className="badge badge-muted text-[10px]">
                                    {((curveData.confusion_matrix.tp + curveData.confusion_matrix.tn) / curveData.confusion_matrix.total * 100).toFixed(1)}% accuracy
                                </span>
                            )}
                            {showDiagnostics ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </div>
                    </button>
                    {showDiagnostics && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5 animate-in fade-in slide-in-from-top-2">
                            {/* Score Distribution */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Score Distribution</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Predicted probability distribution by actual class</p>
                                {curveData.score_distribution && curveData.score_distribution.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={curveData.score_distribution} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="bin_start" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Score", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} label={{ value: "Count", angle: -90, position: "insideLeft", offset: 10, fontSize: 10 }} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} />
                                                <Legend wrapperStyle={{ fontSize: "10px" }} />
                                                <Bar dataKey="negative" name="Negative (Good)" fill="hsl(210,100%,58%)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                                                <Bar dataKey="positive" name="Positive (Bad)" fill="hsl(0,68%,52%)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate distribution.</div>
                                )}
                            </div>

                            {/* Calibration Curve */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Calibration Curve</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Predicted probability vs actual event rate — perfect model follows diagonal</p>
                                {curveData.calibration_curve && curveData.calibration_curve.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={curveData.calibration_curve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="predicted" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Predicted", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Actual", angle: -90, position: "insideLeft", offset: 10, fontSize: 10 }} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any) => [(v as number).toFixed(4)]} />
                                                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={1} />
                                                <Line dataKey="actual" stroke="hsl(210,100%,58%)" strokeWidth={2} dot={{ r: 3, fill: "hsl(210,100%,58%)" }} activeDot={{ r: 5 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate calibration curve.</div>
                                )}
                            </div>

                            {/* Threshold Tuning */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Threshold Tuning</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Precision, recall, and F1 at each classification threshold</p>
                                {curveData.threshold_tuning && curveData.threshold_tuning.length > 0 ? (
                                    <div className="h-[260px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={curveData.threshold_tuning} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                                <XAxis dataKey="threshold" type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Threshold", position: "insideBottom", offset: -2, fontSize: 10 }} />
                                                <YAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                                                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }} formatter={(v: any, name?: string) => [`${((v as number) * 100).toFixed(1)}%`, name ?? ""]} />
                                                <Legend wrapperStyle={{ fontSize: "10px" }} />
                                                <Line dataKey="precision" name="Precision" stroke="hsl(210,100%,58%)" strokeWidth={2} dot={false} />
                                                <Line dataKey="recall" name="Recall" stroke="hsl(142,68%,40%)" strokeWidth={2} dot={false} />
                                                <Line dataKey="f1" name="F1 Score" stroke="hsl(270,60%,65%)" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate threshold chart.</div>
                                )}
                            </div>

                            {/* Confusion Matrix */}
                            <div>
                                <h4 className="text-xs font-semibold mb-0.5">Confusion Matrix</h4>
                                <p className="text-[10px] text-muted-foreground mb-3">Classification outcomes at 0.50 threshold</p>
                                {curveData.confusion_matrix ? (() => {
                                    const cm = curveData.confusion_matrix;
                                    const maxVal = Math.max(cm.tn, cm.fp, cm.fn, cm.tp);
                                    const cells = [
                                        { label: "True Negative", abbr: "TN", value: cm.tn, pct: cm.tn / cm.total, color: "text-info", intensity: cm.tn / maxVal },
                                        { label: "False Positive", abbr: "FP", value: cm.fp, pct: cm.fp / cm.total, color: "text-down", intensity: cm.fp / maxVal },
                                        { label: "False Negative", abbr: "FN", value: cm.fn, pct: cm.fn / cm.total, color: "text-down", intensity: cm.fn / maxVal },
                                        { label: "True Positive", abbr: "TP", value: cm.tp, pct: cm.tp / cm.total, color: "text-up", intensity: cm.tp / maxVal },
                                    ];
                                    return (
                                        <div>
                                            <div className="flex text-[10px] text-muted-foreground mb-1">
                                                <div className="w-16" />
                                                <div className="flex-1 text-center font-semibold">Predicted Negative</div>
                                                <div className="flex-1 text-center font-semibold">Predicted Positive</div>
                                            </div>
                                            <div className="grid grid-cols-[4rem_1fr_1fr] grid-rows-2 gap-1.5">
                                                <div className="flex items-center justify-center text-[10px] text-muted-foreground font-semibold [writing-mode:vertical-lr] rotate-180">Actual Negative</div>
                                                {cells.slice(0, 2).map((cell) => (
                                                    <div
                                                        key={cell.abbr}
                                                        className={cn(
                                                            "rounded-lg flex flex-col items-center justify-center py-6 border border-border/30",
                                                            cell.abbr === "TN" && "bg-blue-500/10",
                                                            cell.abbr === "FP" && "bg-red-500/10",
                                                        )}
                                                        style={{ opacity: 0.5 + cell.intensity * 0.5 }}
                                                    >
                                                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{cell.abbr}</span>
                                                        <span className={cn("text-2xl font-bold mt-0.5", cell.color)}>{cell.value.toLocaleString()}</span>
                                                        <span className="text-[10px] text-muted-foreground mt-0.5">{(cell.pct * 100).toFixed(1)}%</span>
                                                    </div>
                                                ))}
                                                <div className="flex items-center justify-center text-[10px] text-muted-foreground font-semibold [writing-mode:vertical-lr] rotate-180">Actual Positive</div>
                                                {cells.slice(2).map((cell) => (
                                                    <div
                                                        key={cell.abbr}
                                                        className={cn(
                                                            "rounded-lg flex flex-col items-center justify-center py-6 border border-border/30",
                                                            cell.abbr === "FN" && "bg-red-500/10",
                                                            cell.abbr === "TP" && "bg-green-500/10",
                                                        )}
                                                        style={{ opacity: 0.5 + cell.intensity * 0.5 }}
                                                    >
                                                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{cell.abbr}</span>
                                                        <span className={cn("text-2xl font-bold mt-0.5", cell.color)}>{cell.value.toLocaleString()}</span>
                                                        <span className="text-[10px] text-muted-foreground mt-0.5">{(cell.pct * 100).toFixed(1)}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })() : (
                                    <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg text-xs">Retrain to generate confusion matrix.</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Ensemble breakdown (only for ensemble models) ── */}
            {model.algorithm === "ensemble" && td?.best_params?.components && (() => {
                const components = td.best_params.components as string[];
                const weights = td.best_params.weights as Record<string, number> | undefined;
                const method = td.best_params.method as string | undefined;
                const maxWeight = weights ? Math.max(...components.map(c => weights[c] || 0)) : 0;
                return (
                    <div className="panel p-5">
                        <h3 className="panel-title flex items-center gap-2 mb-3">
                            <GitMerge className="h-4 w-4 text-info" />
                            Ensemble Composition
                        </h3>
                        <p className="text-xs text-muted-foreground mb-4">
                            {method === "champion_boosted"
                                ? `Champion-boosted ensemble — top model weighted at 50%, remaining models weighted by AUC.`
                                : `AUC-weighted ensemble blending ${components.length} models — stronger models contribute more.`
                            }
                        </p>
                        <div className="flex gap-3">
                            {components.map((comp: string) => {
                                const w = weights ? (weights[comp] || 0) : 1 / components.length;
                                const isChampion = weights && w === maxWeight && method === "champion_boosted";
                                return (
                                    <div key={comp} className={cn(
                                        "flex-1 p-3 rounded-lg border text-center",
                                        isChampion ? "bg-info/10 border-info/30" : "bg-muted/20 border-border/50"
                                    )}>
                                        <p className="text-xs font-semibold capitalize">{ALGO_DISPLAY[comp] || comp.replace("_", " ")}</p>
                                        <p className={cn("text-lg font-bold mt-0.5", isChampion ? "text-info" : "text-foreground")}>
                                            {(w * 100).toFixed(1)}%
                                        </p>
                                        {isChampion && <p className="text-[10px] text-info mt-0.5">Champion</p>}
                                        {/* Weight bar */}
                                        <div className="mt-2 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full", isChampion ? "bg-info" : "bg-muted-foreground/40")}
                                                style={{ width: `${(w / (maxWeight || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {/* TASK-9 / TASK-10: full health report + distribution baseline */}
            <HealthReportPanel report={model.health_report} />

            {model.distribution_baseline && model.distribution_baseline.length > 0 && (
                <DistributionBaselinePanel quantiles={model.distribution_baseline} />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// DistributionBaselinePanel — TASK-10 H6
// ────────────────────────────────────────────────────────────────────────
//
// At policy publish (Layer 2 registration), we capture the prediction
// distribution as 10 quantiles (P5..P95). The Layer 3 runtime monitor
// uses this as the FIXED baseline for KS-based drift detection. Surface
// the baseline so users can see what their runtime predictions are
// being compared against.

function DistributionBaselinePanel({ quantiles }: { quantiles: number[] }) {
    const labels = ["P5", "P15", "P25", "P35", "P45", "P55", "P65", "P75", "P85", "P95"];
    const data = quantiles.map((q, i) => ({
        percentile: labels[i] || `Q${i + 1}`,
        score: q,
    }));
    return (
        <div className="panel">
            <div className="panel-head">
                <span className="panel-title">Registration Distribution Baseline</span>
                <span className="text-2xs text-muted-foreground">
                    fixed at registration · drives Layer 3 H6 (KS drift)
                </span>
            </div>
            <div className="p-5">
                <p className="text-xs text-muted-foreground mb-4">
                    These are the prediction-score quantiles captured the moment this
                    model was registered. The runtime health monitor compares the
                    distribution of recent production predictions against these
                    quantiles every 5 minutes — a meaningful KS shift triggers a
                    health-status downgrade. The baseline is fixed; if the population
                    genuinely changes, retrain and re-register to capture a new one.
                </p>
                <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis dataKey="percentile" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                formatter={((v: number | undefined) => (v ?? 0).toFixed(4)) as any}
                            />
                            <Line type="monotone" dataKey="score" stroke="hsl(210,100%,58%)" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2 text-2xs">
                    {data.slice(0, 5).map(({ percentile, score }) => (
                        <div key={percentile} className="bg-muted/20 rounded px-2 py-1">
                            <span className="text-muted-foreground">{percentile}</span>
                            <span className="ml-1 font-mono">{score.toFixed(4)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
