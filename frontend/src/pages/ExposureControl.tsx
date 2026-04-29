import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { useSystem } from "@/lib/hooks";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import {
    DollarSign, AlertTriangle, Sparkles, RefreshCw,
    Shield, ArrowRight, Check, Info, ArrowLeft, CheckCircle
} from "lucide-react";
import { ImpactTable } from "@/components/simulation/ImpactTable";
import { PolicyDiff } from "@/components/simulation/PolicyDiff";
import { cn } from "@/lib/utils";
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, Cell
} from "recharts";

const CHART_GREEN  = "hsl(142,68%,40%)";
const CHART_AMBER  = "hsl(38,92%,50%)";
const CHART_RED    = "hsl(0,68%,52%)";
const CHART_BLUE   = "hsl(210,100%,58%)";

const getBinColor = (decile: number, total: number) => {
    const ratio = (decile - 1) / Math.max(total - 1, 1);
    if (ratio < 0.35) return CHART_GREEN;
    if (ratio < 0.65) return CHART_AMBER;
    return CHART_RED;
};

const getMatrixCellBg = (rate: number) => {
    const intensity = Math.min(rate * 2.5, 1);
    return `rgba(239, 68, 68, ${intensity * 0.65})`;
};

const fmtAmount = (v: number) =>
    v >= 1000 ? `$${(v / 1000 % 1 === 0 ? (v / 1000).toFixed(0) : (v / 1000).toFixed(1))}k` : `$${Math.round(v)}`;

export default function ExposureControl() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const { system } = useSystem();

    const [amountLadder, setAmountLadder] = useState<Record<string, number>>({});
    const [selectedAmountCol, setSelectedAmountCol] = useState<string>("");
    const [isGeneratingAmounts, setIsGeneratingAmounts] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // TASK-11F: pull dataset annotations to surface segmenting dimensions
    const { data: datasets } = useQuery<any[]>({
        queryKey: ["datasets", systemId],
        queryFn: async () => {
            const res = await api.get("/datasets/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
    });

    const { data: policies } = useQuery({
        queryKey: ["policies", systemId],
        queryFn: async () => {
            const res = await api.get("/policies/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const activePolicy = policies?.find((p: any) => p.is_active);

    useEffect(() => {
        if (activePolicy?.amount_ladder) {
            setAmountLadder(activePolicy.amount_ladder);
        }
    }, [activePolicy]);

    const activeModel = models?.find(m => m.id === system?.active_model_id);
    const calibration: any[] = activeModel?.metrics?.calibration || [];

    // Sorted calibration bins (ascending decile = ascending risk)
    const sortedBins = useMemo(() =>
        [...calibration].sort((a, b) => a.decile - b.decile),
        [calibration]
    );

    const numericCols: any[] = useMemo(() =>
        ((activeModel?.metrics?.feature_stats as any[]) || []).filter((f: any) => f.var_type === "Numeric"),
        [activeModel]
    );

    // Auto-detect loan amount column
    useEffect(() => {
        if (!numericCols.length) return;
        const autoDetected = numericCols.find((f: any) =>
            /amount|loan_amt|principal|balance|credit_limit/i.test(f.feature)
        );
        if (autoDetected && !selectedAmountCol) {
            setSelectedAmountCol(autoDetected.feature);
        }
    }, [numericCols]);

    const selectedColStats = numericCols.find(f => f.feature === selectedAmountCol);
    const amtMin = selectedColStats?.min ?? 0;
    const amtMax = selectedColStats?.max ?? 50000;
    // Mean from actual training data — used as current-state baseline
    const amtMean = selectedColStats?.mean ?? (amtMin + amtMax) / 2;
    const hasLoanAmountData = !!selectedAmountCol;

    // Initialize ladder from actual data range when column is selected
    useEffect(() => {
        if (!selectedAmountCol || !selectedColStats || activePolicy?.amount_ladder) return;
        if (!sortedBins.length) return;
        const ladder: Record<string, number> = {};
        const total = sortedBins.length;
        sortedBins.forEach((bin, i) => {
            // Linear descending: lowest risk bin gets amtMax, highest gets amtMin
            const ratio = i / Math.max(total - 1, 1);
            const raw = amtMax - ratio * (amtMax - amtMin);
            const step = (amtMax - amtMin) / 9;
            const round = step >= 5000 ? 5000 : step >= 1000 ? 1000 : step >= 500 ? 500 : 100;
            ladder[String(bin.decile)] = Math.max(amtMin, Math.round(raw / round) * round);
        });
        setAmountLadder(ladder);
    }, [selectedAmountCol, sortedBins.length]);

    // --- AI Recommend: risk-adjusted monotone ladder using actual data range ---
    const generateAmountRecommendations = () => {
        if (!activeModel || !sortedBins.length) return;
        setIsGeneratingAmounts(true);
        setTimeout(() => {
            const riskRates = sortedBins.map((bin: any) => bin.actual_rate);
            const minRisk = Math.min(...riskRates);
            const maxRisk = Math.max(...riskRates);
            const riskRange = maxRisk - minRisk || 1;
            const step = (amtMax - amtMin) / 9;
            const round = step >= 5000 ? 5000 : step >= 1000 ? 1000 : step >= 500 ? 500 : 100;

            // Pass 1: compute risk-adjusted amounts
            const rawAmounts: { decile: number; amount: number }[] = sortedBins.map((bin: any) => {
                const normalizedRisk = (bin.actual_rate - minRisk) / riskRange;
                const riskFactor = Math.pow(1 - normalizedRisk, 1.5);
                const raw = amtMin + (amtMax - amtMin) * riskFactor;
                return { decile: bin.decile, amount: Math.max(amtMin, Math.round(raw / round) * round) };
            });

            // Pass 2: enforce strict monotone decrease (higher risk bin ≤ previous bin)
            const newLadder: Record<string, number> = {};
            let prevAmount = Infinity;
            rawAmounts.forEach(({ decile, amount }) => {
                const monotone = Math.min(amount, prevAmount);
                newLadder[String(decile)] = monotone;
                prevAmount = monotone;
            });

            setAmountLadder(newLadder);
            setIsGeneratingAmounts(false);
        }, 600);
    };

    // --- Overlay chart data: real bad rate + proposed limit per bin ---
    const overlayData = useMemo(() =>
        sortedBins.map((bin: any) => ({
            bin: `D${bin.decile}`,
            decile: bin.decile,
            badRate: +(bin.actual_rate * 100).toFixed(1),
            limit: amountLadder[String(bin.decile)] ?? null,
        })),
        [sortedBins, amountLadder]
    );

    // --- Real risk-amount cross-tab via on-demand API ---
    // Fetched when amount column is selected; re-fetches if column changes. No retraining needed.
    const { data: matrixData, isFetching: matrixLoading, error: matrixError } = useQuery({
        queryKey: ["risk-amount-matrix", activeModel?.id, selectedAmountCol],
        queryFn: async () => {
            const res = await api.get(`/models/${activeModel!.id}/risk-amount-matrix`, {
                params: { amount_col: selectedAmountCol }
            });
            return res.data as { rows: any[]; amount_col: string; available_cols: string[] };
        },
        enabled: !!activeModel?.id && !!selectedAmountCol,
        staleTime: 5 * 60 * 1000, // cache 5 min — data doesn't change without retraining
    });

    const rawMatrix: any[] = matrixData?.rows || [];
    const matrixAmountCol: string = matrixData?.amount_col || selectedAmountCol;

    // Unique sorted amount buckets
    const matrixBuckets = useMemo(() => {
        if (!rawMatrix.length) return [];
        const seen = new Map<number, { min: number; max: number }>();
        rawMatrix.forEach((row: any) => {
            if (!seen.has(row.bucket_min)) seen.set(row.bucket_min, { min: row.bucket_min, max: row.bucket_max });
        });
        return [...seen.values()].sort((a, b) => a.min - b.min);
    }, [rawMatrix]);

    // Lookup: matrixLookup[decile][bucket_min] = { count, bad_rate }
    const matrixLookup = useMemo(() => {
        const lookup: Record<number, Record<number, { count: number; bad_rate: number }>> = {};
        rawMatrix.forEach((row: any) => {
            if (!lookup[row.decile]) lookup[row.decile] = {};
            lookup[row.decile][row.bucket_min] = { count: row.count, bad_rate: row.bad_rate };
        });
        return lookup;
    }, [rawMatrix]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            await api.post("/policies/update-exposure", {
                decision_system_id: systemId,
                amount_ladder: amountLadder
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            queryClient.invalidateQueries({ queryKey: ["policies", systemId] });
            queryClient.invalidateQueries({ queryKey: ["simulate"] });
            queryClient.invalidateQueries({ queryKey: ["simulate-breakout"] });
            queryClient.invalidateQueries({ queryKey: ["policy-diff"] });
            setSaveError(null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail
                || err?.message
                || "Failed to save exposure settings.";
            setSaveError(typeof detail === "string" ? detail : JSON.stringify(detail));
        }
    });

    const updateAmount = (decile: string, amount: number) => {
        setAmountLadder(prev => ({ ...prev, [decile]: Math.max(0, amount) }));
    };

    if (!activeModel) {
        return (
            <div className="page">
                <div className="panel p-8 text-center border-warn/30">
                    <AlertTriangle className="h-8 w-8 text-warn mx-auto mb-4" />
                    <h2 className="text-base font-bold mb-2">No Active Model</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        You need an active policy before configuring exposure controls.
                    </p>
                    <Link to={`/systems/${systemId}/policy`} className="btn-primary mt-4">
                        Configure Policy First <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        );
    }

    const sliderStep = Math.max(100, Math.round((amtMax - amtMin) / 50));

    return (
        <div className="page">
            {/* Step Indicator */}
            <div className="panel p-5">
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                    <div className="flex items-center gap-3 flex-1 opacity-60">
                        <div className="bg-up text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center shadow-md">
                            <Check className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Approval Settings</p>
                            <p className="text-xs text-up font-medium">Complete</p>
                        </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground mx-2" />
                    <div className="flex items-center gap-3 flex-1">
                        <div className="bg-primary text-primary-foreground rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg shadow-md">
                            2
                        </div>
                        <div>
                            <p className="font-bold text-primary text-sm">Exposure Control</p>
                            <p className="text-xs text-muted-foreground">Loan amount ladder</p>
                        </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground mx-2" />
                    <div className="flex items-center gap-3 flex-1 opacity-60">
                        <div className="bg-muted border-2 border-muted-foreground/20 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg">
                            3
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Fraud Mitigation</p>
                            <p className="text-xs text-muted-foreground">Model & risk policy</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Header */}
            <div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="page-title flex items-center gap-3">
                            <span className="icon-box bg-primary/10 text-primary font-bold">2</span>
                            Exposure Control
                        </h1>
                        <p className="page-desc">
                            Set maximum loan amounts per risk bin to cap portfolio loss exposure.
                        </p>
                    </div>
                    <Link
                        to={`/systems/${systemId}/policy`}
                        className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Step 1
                    </Link>
                </div>
            </div>

            {/* Educational Banner */}
            <div className="panel p-5 border-info/20">
                <div className="flex items-start gap-4">
                    <div className="icon-box bg-info/10 shrink-0">
                        <Info className="h-4 w-4 text-info" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold mb-1">Why This Matters</h3>
                        <p className="text-xs text-muted-foreground">
                            Approval policy controls <em>who</em> gets credit. Exposure control governs <em>how much</em>.
                            Capping loan amounts for higher-risk segments reduces expected loss without changing approval rates —
                            a second lever that most teams leave on the table.
                        </p>
                    </div>
                </div>
            </div>

            {/* TASK-3: Full Impact Table — 3 stages × 10 metrics + delta column */}
            {activeModel?.dataset_id && activePolicy?.threshold !== undefined ? (
                <ImpactTable
                    datasetId={activeModel.dataset_id}
                    modelId={activeModel.id}
                    cutoff={activePolicy.threshold}
                    amountLadder={amountLadder}
                    title="Full Impact Analysis"
                    description="Baseline → policy cuts → policy + amount ladder. All three stages on the same population, predicted loss computed from the model."
                    segmentingDimensions={
                        datasets?.find((d: any) => d.id === activeModel.dataset_id)
                            ?.segmenting_dimensions || []
                    }
                />
            ) : (
                <div className="panel p-6 border-warn/30">
                    <div className="flex items-start gap-4">
                        <div className="icon-box bg-warn/10 shrink-0">
                            <AlertTriangle className="h-4 w-4 text-warn" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-semibold mb-1">
                                Full Impact Analysis unavailable
                            </h3>
                            <p className="text-xs text-muted-foreground mb-3">
                                {!activePolicy
                                    ? "Activate an approval policy first. The 3-stage impact table compares baseline → policy cuts → policy + ladder, so it needs a published cutoff to render."
                                    : "The active model is not linked to a dataset. Retrain to populate dataset_id."}
                            </p>
                            {!activePolicy && (
                                <Link to={`/systems/${systemId}/policy`} className="btn-primary btn-sm">
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    Configure approval policy
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TASK-11G + TASK-11H: 'What changed' diff between published policy
                 and the in-flight ladder edits. Hidden when nothing has changed. */}
            {activeModel?.dataset_id && activePolicy?.threshold !== undefined && (
                <PolicyDiff
                    datasetId={activeModel.dataset_id}
                    modelId={activeModel.id}
                    policyA={{
                        cutoff: activePolicy.threshold,
                        amount_ladder: activePolicy.amount_ladder || null,
                        label: "Published policy",
                    }}
                    policyB={{
                        cutoff: activePolicy.threshold,
                        amount_ladder: amountLadder,
                        label: "Proposed (current edits)",
                    }}
                    title="What changed — current vs proposed ladder"
                />
            )}

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Ladder + Impact */}
                <div className="space-y-6">
                    {/* Amount Ladder */}
                    <div className="panel p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                Amount Ladder
                                {hasLoanAmountData && (
                                    <span className="text-xs text-muted-foreground font-normal">
                                        ({selectedAmountCol} · ${Math.round(amtMin / 1000)}k–${Math.round(amtMax / 1000)}k)
                                    </span>
                                )}
                            </h3>
                            <div className="flex items-center gap-2">
                                {numericCols.length > 0 && (
                                    <select
                                        value={selectedAmountCol}
                                        onChange={e => setSelectedAmountCol(e.target.value)}
                                        className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                    >
                                        <option value="">— column —</option>
                                        {numericCols.map((f: any) => (
                                            <option key={f.feature} value={f.feature}>{f.feature}</option>
                                        ))}
                                    </select>
                                )}
                                <button
                                    onClick={generateAmountRecommendations}
                                    disabled={isGeneratingAmounts || !hasLoanAmountData}
                                    className="btn-outline btn-sm"
                                    title={!hasLoanAmountData ? "Select a loan amount column first" : undefined}
                                >
                                    {isGeneratingAmounts
                                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                                        : <Sparkles className="h-3 w-3" />}
                                    {isGeneratingAmounts ? "Generating…" : "AI Suggest"}
                                </button>
                            </div>
                        </div>

                        {!hasLoanAmountData ? (
                            <div className="flex flex-col items-center justify-center text-center py-10 px-6 gap-3">
                                <div className="icon-box bg-muted/30 w-12 h-12 rounded-full">
                                    <DollarSign className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold mb-1">No loan amount column selected</p>
                                    <p className="text-xs text-muted-foreground max-w-xs">
                                        {numericCols.length > 0
                                            ? "Select a loan amount column from the dropdown to activate the ladder."
                                            : <>The source file does not contain a recognisable loan amount column.
                                                Include <span className="font-mono bg-muted px-1 rounded">loan_amount</span> or{" "}
                                                <span className="font-mono bg-muted px-1 rounded">principal</span> and retrain.</>
                                        }
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sortedBins.map((bin: any) => {
                                    const decile = bin.decile;
                                    const amount = amountLadder[String(decile)] ?? 0;
                                    const color = getBinColor(decile, sortedBins.length);
                                    const badRatePct = (bin.actual_rate * 100).toFixed(1);
                                    return (
                                        <div key={decile} className="flex items-center gap-2">
                                            <span
                                                className="text-[10px] font-mono font-bold w-6 text-right shrink-0"
                                                style={{ color }}
                                            >
                                                {decile}
                                            </span>
                                            <input
                                                type="range"
                                                min={amtMin}
                                                max={amtMax}
                                                step={sliderStep}
                                                value={amount}
                                                onChange={(e) => updateAmount(String(decile), Number(e.target.value))}
                                                className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                                            />
                                            <div className="w-20 flex items-center gap-1 shrink-0">
                                                <span className="text-muted-foreground text-xs">$</span>
                                                <input
                                                    type="number"
                                                    className="w-full h-7 rounded border border-input bg-background px-2 text-xs font-mono text-right"
                                                    value={amount}
                                                    onChange={(e) => updateAmount(String(decile), Number(e.target.value))}
                                                    step={sliderStep}
                                                    min={amtMin}
                                                />
                                            </div>
                                            <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                                                {badRatePct}%
                                            </span>
                                        </div>
                                    );
                                })}
                                <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t">
                                    <span>Bin</span>
                                    <span className="mr-[88px]">Max loan amount</span>
                                    <span>Bad rate</span>
                                </div>
                            </div>
                        )}

                        {hasLoanAmountData && (
                            <>
                                <button
                                    onClick={() => saveMutation.mutate()}
                                    disabled={saveMutation.isPending}
                                    className="btn-primary w-full mt-5 h-10"
                                >
                                    {saveMutation.isPending ? "Saving…" : saveSuccess ? (
                                        <>Saved! <Check className="ml-2 h-4 w-4" /></>
                                    ) : (
                                        <><Shield className="mr-2 h-4 w-4" />Save Exposure Settings</>
                                    )}
                                </button>
                                {saveError && (
                                    <div className="mt-2 p-2.5 bg-destructive/10 border border-destructive/30 rounded flex items-start gap-2">
                                        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                                        <p className="text-2xs text-destructive break-words flex-1">{saveError}</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                </div>

                {/* Right: Risk Profile chart */}
                <div className="space-y-6">
                <div className="panel p-5">
                    <div className="flex items-start justify-between mb-1">
                        <h3 className="text-sm font-semibold">Risk Profile &amp; Ladder</h3>
                        <span className="text-xs text-muted-foreground">{sortedBins.length} bins</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">
                        Bars show actual bad rate per risk bin. Line shows your proposed amount limit (right axis).
                        Well-configured ladders taper sharply where bad rates rise.
                    </p>

                    {!hasLoanAmountData ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                            <DollarSign className="h-8 w-8 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">
                                Select a loan amount column to see the limit overlay.
                            </p>
                        </div>
                    ) : overlayData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                            <AlertTriangle className="h-8 w-8 text-warn/60" />
                            <p className="text-sm text-muted-foreground">No calibration data available.</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={340}>
                            <ComposedChart data={overlayData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                <XAxis
                                    dataKey="bin"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                {/* Left axis: bad rate % */}
                                <YAxis
                                    yAxisId="rate"
                                    orientation="left"
                                    tickFormatter={v => `${v}%`}
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false}
                                    axisLine={false}
                                    domain={[0, "auto"]}
                                />
                                {/* Right axis: dollar amount */}
                                <YAxis
                                    yAxisId="amount"
                                    orientation="right"
                                    tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false}
                                    axisLine={false}
                                    domain={[0, amtMax]}
                                />
                                <Tooltip
                                    contentStyle={{
                                        background: "hsl(var(--popover))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: "var(--radius)",
                                        fontSize: "11px"
                                    }}
                                    formatter={((value: any, name?: string) => {
                                        if (name === "Bad Rate") return [`${value}%`, name];
                                        if (name === "Limit") return [`$${Number(value).toLocaleString()}`, name];
                                        return [value, name];
                                    }) as any}
                                />
                                <Legend
                                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                                    formatter={(value) => <span style={{ color: "hsl(var(--muted-foreground))" }}>{value}</span>}
                                />
                                <Bar yAxisId="rate" dataKey="badRate" name="Bad Rate" radius={[3, 3, 0, 0]}>
                                    {overlayData.map((entry) => (
                                        <Cell
                                            key={`cell-${entry.decile}`}
                                            fill={getBinColor(entry.decile, sortedBins.length)}
                                            fillOpacity={0.8}
                                        />
                                    ))}
                                </Bar>
                                <Line
                                    yAxisId="amount"
                                    dataKey="limit"
                                    name="Limit"
                                    type="monotone"
                                    stroke={CHART_BLUE}
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: CHART_BLUE }}
                                    activeDot={{ r: 5 }}
                                    connectNulls={false}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}

                    {hasLoanAmountData && overlayData.length > 0 && (
                        <div className="border-t pt-4 mt-2 grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="kpi-value">
                                    {overlayData.length > 0
                                        ? `${Math.min(...overlayData.map(d => d.badRate)).toFixed(1)}%`
                                        : "—"}
                                </p>
                                <p className="kpi-label">Best bin bad rate</p>
                            </div>
                            <div>
                                <p className="kpi-value">
                                    {overlayData.length > 0
                                        ? `${Math.max(...overlayData.map(d => d.badRate)).toFixed(1)}%`
                                        : "—"}
                                </p>
                                <p className="kpi-label">Worst bin bad rate</p>
                            </div>
                            <div>
                                <p className="kpi-value">
                                    ${amtMean >= 1000
                                        ? `${(amtMean / 1000).toFixed(1)}k`
                                        : Math.round(amtMean).toLocaleString()}
                                </p>
                                <p className="kpi-label">Training data mean</p>
                            </div>
                        </div>
                    )}
                </div>
                </div>
            </div>

            {/* Risk-Amount Cross-tab Matrix */}
            <div className="panel p-5">
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-sm font-semibold">Risk × Amount Matrix</h3>
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        {matrixLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
                        {matrixLoading
                            ? "Loading…"
                            : rawMatrix.length > 0
                                ? `Actual bad rates · ${matrixAmountCol}`
                                : !selectedAmountCol
                                    ? "Select a loan amount column"
                                    : (matrixError as any)?.response?.status === 404
                                        ? "Retrain model to enable"
                                        : "No data"}
                    </span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                    Each cell is the observed bad rate for that risk bin × loan amount bucket.
                    Dimmed columns are blocked by your current ladder. The <span style={{ color: CHART_BLUE, fontWeight: 600 }}>blue border</span> marks the cutoff boundary.
                </p>

                {matrixLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Building matrix…
                    </div>
                ) : rawMatrix.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                        <DollarSign className="h-7 w-7 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground max-w-sm">
                            {!selectedAmountCol
                                ? "Select a loan amount column above to build the matrix."
                                : (matrixError as any)?.response?.status === 404
                                    ? <>This model was trained before scored data storage was added. Retrain to enable the matrix.</>
                                    : <>No cross-tab data available. Ensure the dataset includes a loan amount column such as{" "}
                                        <span className="font-mono bg-muted px-1 rounded text-xs">loan_amount</span>.</>
                            }
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-2 text-left font-medium text-muted-foreground w-12">Bin</th>
                                    {matrixBuckets.map((bucket, bIdx) => (
                                        <th key={bIdx} className="p-2 text-center font-medium text-muted-foreground whitespace-nowrap">
                                            {fmtAmount(bucket.min)}–{fmtAmount(bucket.max)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedBins.map((bin: any) => {
                                    const decile = bin.decile;
                                    const limit = amountLadder[String(decile)] ?? Infinity;
                                    return (
                                        <tr key={decile}>
                                            <td className="p-1">
                                                <span
                                                    className="text-[10px] font-mono font-bold"
                                                    style={{ color: getBinColor(decile, sortedBins.length) }}
                                                >
                                                    D{decile}
                                                </span>
                                            </td>
                                            {matrixBuckets.map((bucket, bIdx) => {
                                                const cell = matrixLookup[decile]?.[bucket.min];
                                                const rate = cell?.bad_rate ?? null;
                                                const count = cell?.count ?? 0;
                                                // Bucket is cut if its lower bound >= the ladder limit for this decile
                                                const isCut = bucket.min >= limit;
                                                // First blocked bucket gets a left-side boundary marker
                                                const isBoundary = isCut && bIdx > 0 && matrixBuckets[bIdx - 1]?.min < limit;

                                                return (
                                                    <td key={bIdx} className="p-1">
                                                        <div
                                                            className={cn(
                                                                "h-10 w-full rounded flex flex-col items-center justify-center transition-all relative",
                                                                isCut ? "opacity-30" : ""
                                                            )}
                                                            style={{
                                                                backgroundColor: rate !== null && !isCut
                                                                    ? getMatrixCellBg(rate)
                                                                    : "hsl(var(--muted)/0.3)",
                                                                color: rate !== null && !isCut && rate > 0.35
                                                                    ? "white"
                                                                    : undefined,
                                                                borderLeft: isBoundary
                                                                    ? `2px solid ${CHART_BLUE}`
                                                                    : undefined,
                                                            }}
                                                            title={count > 0 ? `n=${count}` : undefined}
                                                        >
                                                            {rate !== null
                                                                ? <span className="font-mono font-bold text-[11px]">
                                                                    {(rate * 100).toFixed(0)}%
                                                                  </span>
                                                                : <span className="text-muted-foreground">—</span>
                                                            }
                                                            {count > 0 && (
                                                                <span className="text-[9px] opacity-60">
                                                                    n={count}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {rawMatrix.length > 0 && (
                    <div className="flex items-center gap-4 mt-4 pt-3 border-t text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: getMatrixCellBg(0.05) }} />
                            <span>Low (&lt;5%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: getMatrixCellBg(0.20) }} />
                            <span>Medium (20%)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: getMatrixCellBg(0.40) }} />
                            <span>High (40%+)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded opacity-30" style={{ backgroundColor: "hsl(var(--muted)/0.3)" }} />
                            <span>Cut by ladder</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded border-l-2" style={{ borderColor: CHART_BLUE }} />
                            <span>Cutoff boundary</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Next Step CTA */}
            <div className="panel p-6 border-primary/25">
                <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                            <CheckCircle className="h-5 w-5 text-up" />
                            <h3 className="text-base font-bold">Step 2 Complete</h3>
                        </div>
                        <p className="text-muted-foreground mb-4">
                            You've configured exposure limits for each risk bin.
                            See the <strong>Full Impact Analysis</strong> table above for the
                            modelled effect on approval rate, expected loss, and dollar exposure.
                        </p>
                        <div className="bg-muted/20 rounded p-4 mb-4 border">
                            <p className="text-xs font-semibold mb-2">What's Next?</p>
                            <p className="text-xs text-muted-foreground">
                                <strong>Step 3: Fraud Mitigation</strong> — configure fraud detection models,
                                auto-decisioning thresholds, and escalation policies.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <Link to={`/systems/${systemId}/fraud/overview`} className="btn-primary">
                                Continue to Fraud Mitigation
                                <ArrowRight className="h-5 w-5" />
                            </Link>
                            <Link to={`/systems/${systemId}/policy`} className="btn-outline">
                                <ArrowLeft className="h-4 w-4" />
                                Back to Approval Settings
                            </Link>
                        </div>
                    </div>
                    <div className="hidden lg:flex items-center justify-center bg-muted/20 rounded p-6 border">
                        <div className="text-center">
                            <div className="icon-box bg-primary/10 text-primary font-bold text-lg w-12 h-12 rounded-full mb-2">
                                3
                            </div>
                            <p className="text-xs font-semibold text-muted-foreground">Next Step</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
