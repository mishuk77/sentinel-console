import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { useSystem } from "@/lib/hooks";
import type { MLModel, PolicySegment } from "@/lib/api";
import { api, segmentsAPI, datasetsAPI } from "@/lib/api";
import {
    Scale, Check, AlertTriangle, Trash2, AlertCircle, X, ArrowRight,
    CheckCircle, Layers, Plus, ChevronRight, ChevronLeft, RefreshCw, Info
} from "lucide-react";
import { PolicyDiff } from "@/components/simulation/PolicyDiff";
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ComposedChart, Line, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";


function pav(values: number[]): number[] {
    const blocks = values.map((v, i) => ({ sum: v, count: 1, indices: [i] }));
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < blocks.length - 1; i++) {
            if (blocks[i].sum / blocks[i].count > blocks[i+1].sum / blocks[i+1].count) {
                blocks[i].sum += blocks[i+1].sum;
                blocks[i].count += blocks[i+1].count;
                blocks[i].indices = blocks[i].indices.concat(blocks[i+1].indices);
                blocks.splice(i+1, 1);
                changed = true;
                break;
            }
        }
    }
    const out = new Array(values.length);
    for (const b of blocks) {
        const avg = b.sum / b.count;
        for (const idx of b.indices) out[idx] = avg;
    }
    return out;
}

// ─── Instructions Panel ─────────────────────────────────────────────────────

function PolicyInstructions() {
    const [open, setOpen] = useState(false);
    return (
        <div className="panel">
            <button
                onClick={() => setOpen(prev => !prev)}
                className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
            >
                <div className="flex items-center gap-2.5">
                    <Info className="h-4 w-4 text-info" />
                    <span className="text-sm font-semibold">How Policy Configuration Works</span>
                </div>
                {open
                    ? <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-90" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground rotate-90" />}
            </button>
            {open && (
                <div className="px-5 pb-5 space-y-4 text-sm text-muted-foreground animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <div>
                                <h4 className="font-semibold text-foreground mb-1">Score Cutoff & Approval Rate</h4>
                                <p>
                                    The score cutoff determines the minimum model score required for approval.
                                    Drag the cutoff slider to balance your approval rate against your
                                    expected bad rate. Moving the cutoff right is more conservative (fewer approvals,
                                    lower losses); moving it left is more aggressive (more approvals, higher losses).
                                </p>
                            </div>
                            <div>
                                <h4 className="font-semibold text-foreground mb-1">Global vs. Segmented Policy</h4>
                                <p>
                                    <strong>Global</strong> applies a single cutoff to all applicants.{" "}
                                    <strong>Segmented</strong> lets you define custom cutoffs per segment
                                    (e.g., by geography, product, or risk tier), allowing targeted risk management
                                    while maintaining overall portfolio targets.
                                </p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <h4 className="font-semibold text-foreground mb-1">PAV Isotonic Smoothing</h4>
                                <p>
                                    PAV (Pool Adjacent Violators) is an isotonic regression technique that ensures
                                    predicted bad rates are monotonically non-decreasing across score bins.
                                    Raw bin rates can be noisy — a higher-risk bin might randomly show a lower
                                    bad rate than the bin below it due to sampling variance. PAV corrects this by
                                    merging adjacent bins that violate monotonicity, producing a calibrated
                                    step function that reflects the true risk ordering.
                                </p>
                                <p className="mt-1.5 text-info">
                                    This is critical for policy setting because non-monotone rates would mean
                                    your cutoff doesn't cleanly separate good from bad risk — applicants
                                    in a "safer" bin could actually default more often than those in a riskier one.
                                </p>
                            </div>
                            <div>
                                <h4 className="font-semibold text-foreground mb-1">Activation</h4>
                                <p>
                                    Once configured, activate your policy to make it the live decision rule
                                    for the selected model. Only one policy can be active per decision system at a time.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Policy() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const { system } = useSystem();
    const [searchParams] = useSearchParams();
    const initialModelId = searchParams.get("model_id") || "";

    const [activeTab, setActiveTab] = useState<"global" | "segmentation">("global");
    const [selectedModelId, setSelectedModelId] = useState(initialModelId);
    const [cutoffBandIdx, setCutoffBandIdx] = useState(0);
    const [showPAV, setShowPAV] = useState(true);
    const [showCumulative, setShowCumulative] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [policyName, setPolicyName] = useState("Proactive Risk Policy");
    const [activationSuccess, setActivationSuccess] = useState(false);
    const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // TASK-2: fetch policies so we can show 'Last saved' on the active one.
    const { data: policies } = useQuery<any[]>({
        queryKey: ["policies", systemId],
        queryFn: async () => {
            const res = await api.get("/policies/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
    });

    const selectedModel = models?.find(m => m.id === selectedModelId);

    const analysis = useMemo(() => {
        if (!selectedModel?.metrics?.calibration) return null;
        const sorted = [...selectedModel.metrics.calibration].sort((a: any, b: any) => a.decile - b.decile);

        const totalPop = sorted.reduce((s: number, b: any) => s + b.count, 0);
        const empiricalRates = sorted.map((b: any) => b.actual_rate * 100);
        const pavRates = pav(empiricalRates);

        let cumPop = 0, cumBads = 0;
        const bins = sorted.map((b: any, i: number) => {
            cumPop += b.count;
            cumBads += b.actual_rate * b.count;
            return {
                idx: i,
                decile: b.decile,
                score: b.max_score,
                count: b.count,
                empiricalBadRate: b.actual_rate * 100,
                pavBadRate: pavRates[i],
                cumBadRate: cumBads / cumPop * 100,
                cumPct: cumPop / totalPop * 100,
                chargeOffs: b.actual_rate * b.count,
                cumulativeVolume: cumPop,
                cumulativeLoss: cumBads / cumPop * 100,
            };
        });

        const totalBads = sorted.reduce((s: number, b: any) => s + b.actual_rate * b.count, 0);
        const maxBadRate = Math.max(...empiricalRates);

        return { bins, totalPop, totalBads, maxBadRate };
    }, [selectedModel]);

    const bins = analysis?.bins ?? [];

    const bandFromApproval = (pct: number) => {
        for (let i = 0; i < bins.length; i++) if (bins[i].cumPct >= pct) return i;
        return bins.length - 1;
    };
    const bandFromBadRate = (threshold: number) => {
        for (let i = 0; i < bins.length; i++) if (bins[i].pavBadRate >= threshold) return Math.max(0, i - 1);
        return bins.length - 1;
    };
    // TASK-2 Issue 2B: pre-populate slider from saved active policy threshold
    // so page reloads don't lose the user's last saved cutoff.
    const bandFromScore = (savedScore: number) => {
        if (!bins.length) return 0;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < bins.length; i++) {
            const d = Math.abs(((bins[i] as any).score ?? 0) - savedScore);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    const currentBin = bins[cutoffBandIdx] ?? null;
    const approvalPct = currentBin ? Math.round(currentBin.cumPct) : 0;
    const cutoffBadRate = currentBin ? Math.round(currentBin.pavBadRate * 2) / 2 : 0;

    const approvedBins = bins.slice(0, cutoffBandIdx + 1);
    const rejectedBins = bins.slice(cutoffBandIdx + 1);
    const approvedPop = approvedBins.reduce((s, b) => s + b.count, 0);
    const approvedBads = approvedBins.reduce((s, b) => s + b.chargeOffs, 0);
    const rejectedPop = rejectedBins.reduce((s, b) => s + b.count, 0);
    const rejectedBads = rejectedBins.reduce((s, b) => s + b.chargeOffs, 0);
    const approvalRate = analysis ? approvedPop / analysis.totalPop : 0;
    const approvedBadRate = approvedPop > 0 ? approvedBads / approvedPop * 100 : 0;
    const rejectedBadRate = rejectedPop > 0 ? rejectedBads / rejectedPop * 100 : 0;

    // TASK-2 Issue 2B: when bins load AND there's a saved active policy
    // threshold, sync the slider position to it. Tracks whether we've
    // already done the initial sync so we don't fight user adjustments.
    const initialSyncDoneRef = useRef(false);
    useEffect(() => {
        if (initialSyncDoneRef.current) return;
        if (!bins.length) return;
        const savedThreshold = (system as any)?.active_policy_summary?.threshold;
        if (savedThreshold !== undefined && savedThreshold !== null) {
            setCutoffBandIdx(bandFromScore(savedThreshold));
            initialSyncDoneRef.current = true;
        }
    }, [bins, system]);

    useEffect(() => {
        if (!models) return;
        const activeModelId = system?.active_model_id;
        if (activeModelId && activeModelId !== selectedModelId) {
            setSelectedModelId(activeModelId);
        } else if (!activeModelId && selectedModelId) {
            setSelectedModelId("");
        }
    }, [models, initialModelId, system]);

    const activateMutation = useMutation({
        mutationFn: async () => {
            if (!selectedModel) return;
            const policyPayload = {
                model_id: selectedModel.id,
                decision_system_id: systemId,
                threshold: currentBin?.score ?? 0.5,
                projected_approval_rate: approvalRate,
                projected_loss_rate: approvedBadRate / 100,
                target_decile: Math.round(approvalPct / 10),
            };
            const res = await api.post("/policies/", policyPayload);
            const policyId = res.data.id;
            await api.put(`/policies/${policyId}/activate`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            setActivationSuccess(true);
            setTimeout(() => setActivationSuccess(false), 3000);
        }
    });

    if (!models) return <div className="p-8">Loading models...</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Step Indicator */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                    <div className="flex items-center gap-3 flex-1">
                        <div className="bg-primary text-primary-foreground rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg shadow-md">1</div>
                        <div>
                            <p className="font-bold text-primary text-sm">Approval Settings</p>
                            <p className="text-xs text-muted-foreground">Risk threshold & target</p>
                        </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground mx-2" />
                    <div className="flex items-center gap-3 flex-1 opacity-60">
                        <div className="bg-muted border-2 border-muted-foreground/20 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg">2</div>
                        <div>
                            <p className="font-semibold text-sm">Exposure Control</p>
                            <p className="text-xs text-muted-foreground">Loan amount ladder</p>
                        </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground mx-2" />
                    <div className="flex items-center gap-3 flex-1 opacity-60">
                        <div className="bg-muted border-2 border-muted-foreground/20 rounded-full w-10 h-10 flex items-center justify-center font-bold text-lg">3</div>
                        <div>
                            <p className="font-semibold text-sm">Fraud Mitigation</p>
                            <p className="text-xs text-muted-foreground">Model & risk policy</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Collapsible Instructions */}
            <PolicyInstructions />

            {/* Tab Bar */}
            <div className="border-b flex gap-0">
                <button
                    onClick={() => setActiveTab("global")}
                    className={cn(
                        "flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
                        activeTab === "global"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Scale className="h-4 w-4" />
                    Global Policy
                </button>
                <button
                    onClick={() => setActiveTab("segmentation")}
                    className={cn(
                        "flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
                        activeTab === "segmentation"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Layers className="h-4 w-4" />
                    Segmentation
                    {system?.active_policy_id && (
                        <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">New</span>
                    )}
                </button>
            </div>

            {/* Global Policy Tab */}
            {activeTab === "global" && (
                <>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                            <span className="bg-primary/10 text-primary rounded-lg w-12 h-12 flex items-center justify-center font-bold text-xl">1</span>
                            Approval Settings
                        </h1>
                        <p className="text-muted-foreground mt-2 ml-[60px]">
                            Set your risk acceptance threshold to control approval rates and projected losses.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 space-y-6">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Active Model</label>
                                {selectedModel ? (
                                    <div className="p-4 bg-muted/20 border rounded-lg space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-foreground">{selectedModel.name}</span>
                                            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded-full">ACTIVE</span>
                                        </div>
                                        <div className="text-sm text-muted-foreground flex justify-between">
                                            <span className="capitalize">{selectedModel.algorithm?.replace("_", " ")}</span>
                                            <span className="font-mono">AUC: {selectedModel.metrics?.auc ? (selectedModel.metrics.auc * 100).toFixed(1) : 0}%</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                                        <p className="font-bold flex items-center gap-2">
                                            <AlertTriangle className="h-4 w-4" /> No Active Model
                                        </p>
                                        <p className="mt-2 text-xs">
                                            You must activate a candidate model in the Registry before configuring policies.
                                        </p>
                                        <button
                                            onClick={() => window.location.href = `/systems/${systemId}/models`}
                                            className="mt-3 text-primary font-bold hover:underline"
                                        >
                                            Go to Model Registry &rarr;
                                        </button>
                                    </div>
                                )}
                            </div>

                            {selectedModel && (
                                <>
                                    <div>
                                        <div className="flex justify-between mb-1.5">
                                            <label className="text-xs font-medium text-muted-foreground">Approval target</label>
                                            <span className="text-xs font-bold text-primary">{approvalPct}%</span>
                                        </div>
                                        <input
                                            type="range" min="1" max="99" step="1"
                                            className="w-full cursor-pointer accent-primary"
                                            value={approvalPct}
                                            onChange={(e) => setCutoffBandIdx(bandFromApproval(parseInt(e.target.value)))}
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>Selective (1%)</span>
                                            <span>All In (99%)</span>
                                        </div>
                                    </div>

                                    <div className="mt-4">
                                        <div className="flex justify-between mb-1.5">
                                            <label className="text-xs font-medium text-muted-foreground">Reject above bad rate</label>
                                            <span className="text-xs font-bold text-warn">{cutoffBadRate.toFixed(1)}%</span>
                                        </div>
                                        <input
                                            type="range" min="0.5" max={Math.ceil(analysis?.maxBadRate ?? 35)} step="0.5"
                                            className="w-full cursor-pointer accent-primary"
                                            value={cutoffBadRate}
                                            onChange={(e) => setCutoffBandIdx(bandFromBadRate(parseFloat(e.target.value)))}
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>Conservative</span>
                                            <span>Permissive</span>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t mt-4 space-y-3">
                                        <div>
                                            <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Score Cutoff</h4>
                                            <p className="text-2xl font-bold font-mono">{(currentBin?.score ?? 0).toFixed(4)}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Proj. Approval</h4>
                                                <p className="text-lg font-bold text-up">{(approvalRate * 100).toFixed(1)}%</p>
                                            </div>
                                            <div>
                                                <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Proj. Loss</h4>
                                                <p className="text-lg font-bold text-down">{approvedBadRate.toFixed(2)}%</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t">
                                        <label className="text-sm font-medium mb-1 block">Policy Name</label>
                                        <input
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-4"
                                            value={policyName}
                                            onChange={(e) => setPolicyName(e.target.value)}
                                        />
                                        {/* TASK-2 acceptance: visible 'Last saved' timestamp */}
                                        {(() => {
                                            const activePolicy = policies?.find((p: any) => p.is_active);
                                            const ts = activePolicy?.last_published_at;
                                            if (!ts) return null;
                                            const formatted = new Date(ts).toLocaleString(undefined, {
                                                year: "numeric", month: "short", day: "2-digit",
                                                hour: "2-digit", minute: "2-digit",
                                            });
                                            return (
                                                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                                                    <CheckCircle className="h-3 w-3 text-up" />
                                                    Last saved: <span className="font-medium text-foreground">{formatted}</span>
                                                </p>
                                            );
                                        })()}
                                        <button
                                            onClick={() => {
                                                // TASK-11E: show impact summary modal before publishing
                                                // when there's an existing published policy. First-time
                                                // activation has nothing to compare against, so go direct.
                                                if ((system as any)?.active_policy_summary) {
                                                    setPublishConfirmOpen(true);
                                                } else {
                                                    activateMutation.mutate();
                                                }
                                            }}
                                            disabled={activateMutation.isPending}
                                            className={cn(
                                                "w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors h-10 px-4 py-2",
                                                activationSuccess
                                                    ? "bg-green-600 text-white hover:bg-green-700"
                                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                            )}
                                        >
                                            {activateMutation.isPending ? "Processing..." : activationSuccess ? "Success!" : (system as any)?.active_policy_summary ? "Review & Publish" : "Activate Policy"}
                                            {activationSuccess && <Check className="ml-2 h-4 w-4" />}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="lg:col-span-2 space-y-6">
                            {!selectedModel ? (
                                <div className="panel p-12 flex flex-col items-center justify-center text-muted-foreground min-h-[400px]">
                                    <Scale className="h-12 w-12 mb-4 opacity-20" />
                                    <p>Select a model to analyze impact.</p>
                                </div>
                            ) : !analysis ? (
                                <div className="panel p-12 flex flex-col items-center justify-center text-muted-foreground">
                                    <AlertTriangle className="h-12 w-12 mb-4 opacity-50 text-warn" />
                                    <p>No calibration data available for this model.</p>
                                    <p className="text-sm mt-2">Try training a new model to generate metrics.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Chart 1: Risk quality */}
                                    <div className="panel">
                                        <div className="panel-head">
                                            <span className="panel-title">Risk Quality by Score Band</span>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => setShowPAV(v => !v)}
                                                    className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors",
                                                        showPAV ? "border-border text-foreground" : "border-transparent text-muted-foreground opacity-40")}
                                                >
                                                    <span className="inline-block w-4 h-0.5 rounded bg-amber-400" />
                                                    PAV-smoothed
                                                </button>
                                                <button
                                                    onClick={() => setShowCumulative(v => !v)}
                                                    className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors",
                                                        showCumulative ? "border-border text-foreground" : "border-transparent text-muted-foreground opacity-40")}
                                                >
                                                    <span className="inline-block w-4 h-0.5 rounded bg-red-400" />
                                                    Cumulative
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-4">
                                            <div
                                                className="h-[260px] cursor-col-resize select-none"
                                                onMouseDown={() => setIsDragging(true)}
                                                onMouseUp={() => setIsDragging(false)}
                                                onMouseLeave={() => setIsDragging(false)}
                                            >
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart
                                                        data={analysis.bins}
                                                        margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                                                        onClick={(d) => { if (d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                                        onMouseMove={(d) => { if (isDragging && d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                                    >
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                                        <XAxis dataKey="score" tickFormatter={(v) => typeof v === 'number' ? v.toFixed(2) : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                                        <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38} />
                                                        <Tooltip
                                                            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                            formatter={((value: any, name?: string) => [`${Number(value).toFixed(2)}%`, name ?? ""]) as any}
                                                            labelFormatter={(label) => `Score: ${typeof label === 'number' ? label.toFixed(3) : label}`}
                                                        />
                                                        {/* Approve shading */}
                                                        {cutoffBandIdx >= 0 && (
                                                            <ReferenceArea
                                                                x1={analysis.bins[0]?.score}
                                                                x2={currentBin?.score}
                                                                fill="hsl(var(--up))" fillOpacity={0.05}
                                                            />
                                                        )}
                                                        {/* Reject shading */}
                                                        {cutoffBandIdx < analysis.bins.length - 1 && (
                                                            <ReferenceArea
                                                                x1={currentBin?.score}
                                                                x2={analysis.bins[analysis.bins.length - 1]?.score}
                                                                fill="hsl(var(--down))" fillOpacity={0.05}
                                                            />
                                                        )}
                                                        {/* Cutoff vertical line */}
                                                        <ReferenceLine x={currentBin?.score} stroke="hsl(var(--warn))" strokeWidth={1.5} strokeDasharray="0" />
                                                        {/* Bad rate threshold horizontal line */}
                                                        <ReferenceLine y={cutoffBadRate} stroke="hsl(var(--down))" strokeWidth={1} strokeDasharray="4 3" />
                                                        <Bar dataKey="empiricalBadRate" name="Bucket bad rate" fill="hsl(210 100% 58% / 0.45)" stroke="hsl(210 100% 58% / 0.7)" strokeWidth={1} radius={[2,2,0,0]} />
                                                        {showPAV && <Line type="stepAfter" dataKey="pavBadRate" name="PAV-smoothed" stroke="hsl(var(--warn))" strokeWidth={1.5} dot={false} />}
                                                        {showCumulative && <Line type="monotone" dataKey="cumBadRate" name="Cumulative (approved)" stroke="hsl(var(--down))" strokeWidth={1.5} dot={false} />}
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-2 px-1">
                                                Click or drag on chart to set cutoff · PAV enforces monotonicity · Dashed line = bad rate threshold
                                            </p>
                                        </div>
                                    </div>

                                    {/* Stat bar */}
                                    <div className="grid grid-cols-4 gap-3">
                                        <div className="panel p-3">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Score Cutoff</div>
                                            <div className="text-lg font-bold font-mono text-info">{(currentBin?.score ?? 0).toFixed(4)}</div>
                                        </div>
                                        <div className="panel p-3">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Proj. Approval</div>
                                            <div className="text-lg font-bold text-up">{(approvalRate * 100).toFixed(1)}%</div>
                                        </div>
                                        <div className="panel p-3">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bad Rate (Approved)</div>
                                            <div className="text-lg font-bold text-warn">{approvedBadRate.toFixed(2)}%</div>
                                        </div>
                                        <div className="panel p-3">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bad Rate (Rejected)</div>
                                            <div className="text-lg font-bold text-down">{rejectedBadRate.toFixed(2)}%</div>
                                        </div>
                                    </div>

                                    {/* Chart 2: Population density + CDF */}
                                    <div className="panel">
                                        <div className="panel-head">
                                            <span className="panel-title">Population Density &amp; Cumulative Volume</span>
                                            <div className="flex items-center gap-3">
                                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <span className="inline-block w-3 h-3 rounded-sm bg-muted-foreground/30" />
                                                    Applications per band
                                                </span>
                                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <span className="inline-block w-4 h-0.5 rounded bg-info" />
                                                    Cum. % approved
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-4">
                                            <div
                                                className="h-[140px] cursor-col-resize select-none"
                                                onMouseDown={() => setIsDragging(true)}
                                                onMouseUp={() => setIsDragging(false)}
                                                onMouseLeave={() => setIsDragging(false)}
                                            >
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart
                                                        data={analysis.bins}
                                                        margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                                                        onClick={(d) => { if (d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                                        onMouseMove={(d) => { if (isDragging && d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                                    >
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                                        <XAxis dataKey="score" tickFormatter={(v) => typeof v === 'number' ? v.toFixed(2) : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                                        <YAxis yAxisId="pop" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38} />
                                                        <YAxis yAxisId="cdf" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
                                                        <Tooltip
                                                            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                            formatter={((value: any, name?: string) => [name === 'Cum. % approved' ? `${Number(value).toFixed(1)}%` : Number(value).toLocaleString(), name ?? ""]) as any}
                                                            labelFormatter={(label) => `Score: ${typeof label === 'number' ? label.toFixed(3) : label}`}
                                                        />
                                                        <ReferenceLine yAxisId="pop" x={currentBin?.score} stroke="hsl(var(--warn))" strokeWidth={1.5} />
                                                        <Bar yAxisId="pop" dataKey="count" name="Applications" fill="hsl(var(--muted-foreground) / 0.2)" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth={1} radius={[2,2,0,0]} />
                                                        <Line yAxisId="cdf" type="monotone" dataKey="cumPct" name="Cum. % approved" stroke="hsl(210 100% 58%)" strokeWidth={1.5} dot={false} />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Decile Performance table */}
                                    <div className="panel overflow-hidden">
                                        <div className="panel-head">
                                            <span className="panel-title">Band Performance</span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="dt w-full text-sm">
                                                <thead>
                                                    <tr>
                                                        <th className="h-9 px-4 text-left font-medium text-muted-foreground">Band</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Score</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Originations</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Charge Offs</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Rate %</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground border-l border-border/50">Cum. Orig.</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Cum. C/O</th>
                                                        <th className="h-9 px-4 text-right font-medium text-muted-foreground">Cum. Rate %</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {analysis.bins.map((row, i) => (
                                                        <tr
                                                            key={row.decile}
                                                            className={cn("border-b border-border/30 last:border-0 transition-colors cursor-pointer hover:bg-muted/40",
                                                                i <= cutoffBandIdx ? "bg-up/5" : "")}
                                                            onClick={() => setCutoffBandIdx(i)}
                                                        >
                                                            <td className="p-3 font-medium text-xs">{row.decile}</td>
                                                            <td className="p-3 text-right font-mono text-xs">{row.score.toFixed(3)}</td>
                                                            <td className="p-3 text-right tabular-nums">{row.count.toLocaleString()}</td>
                                                            <td className="p-3 text-right tabular-nums text-down">{Math.round(row.chargeOffs).toLocaleString()}</td>
                                                            <td className="p-3 text-right font-semibold">{row.empiricalBadRate.toFixed(2)}%</td>
                                                            <td className="p-3 text-right tabular-nums text-muted-foreground border-l border-border/30">{row.cumulativeVolume.toLocaleString()}</td>
                                                            <td className="p-3 text-right tabular-nums text-muted-foreground">{Math.round(row.cumulativeVolume * row.cumulativeLoss / 100).toLocaleString()}</td>
                                                            <td className="p-3 text-right font-bold">{row.cumulativeLoss.toFixed(2)}%</td>
                                                        </tr>
                                                    ))}
                                                    <tr className="bg-muted/30 font-bold border-t border-border">
                                                        <td className="p-3 text-xs" colSpan={2}>TOTAL</td>
                                                        <td className="p-3 text-right tabular-nums">{analysis.totalPop.toLocaleString()}</td>
                                                        <td className="p-3 text-right tabular-nums text-down">{Math.round(analysis.totalBads).toLocaleString()}</td>
                                                        <td className="p-3 text-right">{(analysis.totalBads / analysis.totalPop * 100).toFixed(2)}%</td>
                                                        <td className="p-3 border-l border-border/30" colSpan={3}></td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {selectedModel && analysis && currentBin && (
                        <div className="bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border-2 border-indigo-200 rounded-xl p-8 shadow-lg">
                            <div className="flex items-start justify-between gap-6">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                        <CheckCircle className="h-6 w-6 text-green-600" />
                                        <h3 className="text-xl font-bold text-foreground">Step 1 Complete</h3>
                                    </div>
                                    <p className="text-muted-foreground mb-4">
                                        You've configured your approval policy to accept <strong>{(approvalRate * 100).toFixed(1)}%</strong> of applicants
                                        with a projected loss rate of <strong>{(approvedBadRate / 100 * 100).toFixed(2)}%</strong>.
                                    </p>
                                    <div className="bg-white/60 backdrop-blur rounded-lg p-4 mb-4 border border-indigo-100">
                                        <p className="text-sm font-semibold text-indigo-900 mb-2">📊 What's Next?</p>
                                        <p className="text-sm text-indigo-800">
                                            <strong>Step 2: Exposure Control</strong> lets you set loan amount limits for each risk decile.
                                            This allows you to maintain approval rates while reducing portfolio losses by limiting exposure to higher-risk borrowers.
                                        </p>
                                    </div>
                                    <div className="flex gap-3">
                                        <Link to={`/systems/${systemId}/exposure`} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-bold hover:bg-primary/90 transition-all shadow-md hover:shadow-lg">
                                            Continue to Exposure Control
                                            <ArrowRight className="h-5 w-5" />
                                        </Link>
                                        <button
                                            onClick={() => document.getElementById('policy-history')?.scrollIntoView({ behavior: 'smooth' })}
                                            className="inline-flex items-center gap-2 bg-white/80 backdrop-blur text-foreground px-6 py-3 rounded-lg font-medium hover:bg-white transition-all border border-indigo-200"
                                        >
                                            View Policy History
                                        </button>
                                    </div>
                                </div>
                                <div className="hidden lg:flex items-center justify-center bg-white/60 backdrop-blur rounded-xl p-6 border border-indigo-100">
                                    <div className="text-center">
                                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full w-16 h-16 flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-2">2</div>
                                        <p className="text-xs font-semibold text-muted-foreground">Next Step</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div id="policy-history"></div>
                    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b"><h3 className="font-semibold text-lg">Policy History</h3></div>
                        <PolicyList systemId={systemId} />
                    </div>
                </>
            )}

            {/* Segmentation Tab */}
            {activeTab === "segmentation" && (
                <>
                    {/* TASK-4B: cascade behavior banner */}
                    <div className="panel p-4 border-info/30 bg-info/5 flex items-start gap-3 mb-2">
                        <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                How segmented policies work
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                Segmented policies override the global policy for matching applications.
                                Applications not matching any segment automatically use the global policy
                                (cutoff <span className="font-mono font-semibold text-foreground">
                                    {((system as any)?.active_policy_summary?.threshold ?? 0).toFixed(3)}
                                </span>).
                                When an application matches multiple segments with custom thresholds, the
                                most restrictive (lowest) threshold is applied.
                            </p>
                        </div>
                    </div>
                    <SegmentationTab
                        policyId={system?.active_policy_id}
                        globalThreshold={(system as any)?.active_policy_summary?.threshold ?? 0}
                        globalDefaultRate={(system as any)?.active_policy_summary ? (1 - ((system as any).active_policy_summary.approval_rate || 0)) : 0}
                        datasetId={selectedModel?.dataset_id}
                    />
                </>
            )}

            {/* TASK-11E: publish confirmation modal with impact summary */}
            {publishConfirmOpen && selectedModel && currentBin && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="panel max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="panel-head sticky top-0 bg-card z-10">
                            <div>
                                <span className="panel-title">Review & publish policy</span>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Compare your proposed cutoff against the currently published policy.
                                </p>
                            </div>
                            <button
                                onClick={() => setPublishConfirmOpen(false)}
                                className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="bg-info/5 border border-info/20 rounded p-3 text-sm">
                                <p>
                                    Proposed cutoff: <span className="font-mono font-bold">{(currentBin.score ?? 0).toFixed(4)}</span>
                                    <span className="mx-2 text-muted-foreground">·</span>
                                    Current published cutoff:{" "}
                                    <span className="font-mono font-bold">
                                        {((system as any)?.active_policy_summary?.threshold ?? 0).toFixed(4)}
                                    </span>
                                </p>
                            </div>

                            {/* PolicyDiff: shows newly approved / newly denied applicants */}
                            <PolicyDiff
                                datasetId={selectedModel.dataset_id}
                                modelId={selectedModel.id}
                                policyA={{
                                    cutoff: (system as any)?.active_policy_summary?.threshold ?? 0,
                                    label: "Currently published",
                                }}
                                policyB={{
                                    cutoff: currentBin.score ?? 0,
                                    label: "Proposed",
                                }}
                                title="Impact of this change"
                                skipIfIdentical={false}
                            />

                            <div className="flex items-center justify-end gap-2 pt-3 border-t">
                                <button
                                    onClick={() => setPublishConfirmOpen(false)}
                                    className="btn-ghost btn-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setPublishConfirmOpen(false);
                                        activateMutation.mutate();
                                    }}
                                    disabled={activateMutation.isPending}
                                    className="btn-primary btn-sm flex items-center gap-1.5"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Confirm publish
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Policy History ───────────────────────────────────────────────────────────

function PolicyList({ systemId }: { systemId?: string }) {
    const queryClient = useQueryClient();
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const { data: policies } = useQuery<any[]>({
        queryKey: ["policies", systemId],
        queryFn: async () => {
            if (!systemId) return [];
            const res = await api.get("/policies/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => { await api.delete(`/policies/${id}`); },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["policies"] });
            setDeleteError(null);
        },
        onError: (err: any) => {
            const msg = err.response?.data?.detail || "Failed to delete policy. Active policies cannot be deleted.";
            setDeleteError(msg);
            setTimeout(() => setDeleteError(null), 5000);
        }
    });

    if (!policies?.length) return null;

    return (
        <div className="overflow-x-auto">
            {deleteError && (
                <div className="mx-6 mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-3 animate-in fade-in">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive flex-1">{deleteError}</p>
                    <button onClick={() => setDeleteError(null)} className="text-destructive hover:text-destructive/80 transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
            <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground uppercase font-medium">
                    <tr>
                        <th className="px-6 py-3">Created At</th>
                        <th className="px-6 py-3">Threshold</th>
                        <th className="px-6 py-3">Target</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {policies.map((p) => (
                        <tr key={p.id} className="hover:bg-muted/50 transition-colors">
                            <td className="px-6 py-4 text-xs font-mono">{new Date(p.created_at).toLocaleDateString()}</td>
                            <td className="px-6 py-4">{p.threshold?.toFixed(4)}</td>
                            <td className="px-6 py-4">{p.target_decile ? `${p.target_decile * 10}%` : "-"}</td>
                            <td className="px-6 py-4">
                                {p.is_active
                                    ? <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-bold">ACTIVE</span>
                                    : <span className="text-muted-foreground text-xs">Inactive</span>}
                            </td>
                            <td className="px-6 py-4 text-right">
                                {!p.is_active && (
                                    <button
                                        onClick={() => { if (window.confirm("Delete this policy?")) deleteMutation.mutate(p.id); }}
                                        className="text-muted-foreground hover:text-red-600 transition-colors"
                                        title="Delete Policy"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ─── Segmentation Tab ─────────────────────────────────────────────────────────

function SegmentationTab({
    policyId,
    globalThreshold,
    globalDefaultRate,
    datasetId,
}: {
    policyId: string | undefined;
    globalThreshold: number;
    globalDefaultRate: number;
    datasetId: string | undefined;
}) {
    const queryClient = useQueryClient();
    const [selectedSegment, setSelectedSegment] = useState<PolicySegment | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [calibrateError, setCalibrateError] = useState<string | null>(null);
    const [calibrateSuccess, setCalibrateSuccess] = useState(false);
    const [targetBadRatePct, setTargetBadRatePct] = useState("");
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDeleteSegment = async (segId: string) => {
        setDeletingId(segId);
        try {
            await segmentsAPI.delete(policyId!, segId);
            setPendingDeleteId(null);
            if (selectedSegment?.id === segId) setSelectedSegment(null);
            queryClient.invalidateQueries({ queryKey: ["segments", policyId] });
        } finally {
            setDeletingId(null);
        }
    };

    const { data: segments, isLoading } = useQuery<PolicySegment[]>({
        queryKey: ["segments", policyId],
        queryFn: () => segmentsAPI.list(policyId!).then(r => r.data),
        enabled: !!policyId,
    });

    // Input is a percentage (e.g. 15 = 15%) — divide by 100 for backend
    const targetBadRateDecimal = targetBadRatePct.trim() !== "" ? parseFloat(targetBadRatePct) / 100 : undefined;

    const calibrateMutation = useMutation({
        mutationFn: () => segmentsAPI.calibrate(policyId!, targetBadRateDecimal !== undefined ? { target_bad_rate: targetBadRateDecimal } : undefined).then(r => r.data),
        onSuccess: (data) => {
            queryClient.setQueryData(["segments", policyId], data);
            // Invalidate any cached per-segment calibration (thresholds may have changed)
            queryClient.invalidateQueries({ queryKey: ["segment-calibration"] });
            setCalibrateSuccess(true);
            setTimeout(() => setCalibrateSuccess(false), 3000);
            setCalibrateError(null);
            // Refresh selected segment from new data
            if (selectedSegment) {
                const updated = data.find((s: PolicySegment) => s.id === selectedSegment.id);
                if (updated) setSelectedSegment(updated);
            }
        },
        onError: (err: any) => {
            setCalibrateError(err.response?.data?.detail || "Calibration failed");
        }
    });

    if (!policyId) {
        return (
            <div className="bg-card border rounded-xl p-12 flex flex-col items-center justify-center text-muted-foreground min-h-[400px]">
                <Layers className="h-12 w-12 mb-4 opacity-20" />
                <p className="font-semibold text-foreground mb-2">No active policy</p>
                <p className="text-sm text-center max-w-xs">
                    Configure and activate a Global Policy first, then return here to add segment-specific thresholds.
                </p>
            </div>
        );
    }

    const globalSegment = segments?.find(s => s.is_global);
    const nonGlobal = segments?.filter(s => !s.is_global) ?? [];
    const sortedNonGlobal = [...nonGlobal].sort((a, b) => (b.n_samples ?? 0) - (a.n_samples ?? 0));
    const displaySegments = showAll ? sortedNonGlobal : sortedNonGlobal.slice(0, 8);
    const selectedSegmentId = selectedSegment?.id ?? null;

    const totalSamples = globalSegment?.n_samples ?? 0;
    const needsReview = segments?.filter(s => s.confidence_tier === "yellow").length ?? 0;
    const hasUncalibrated = segments?.some(s => s.n_samples === null) ?? false;

    const [showHelp, setShowHelp] = useState(false);

    return (
        <div className="space-y-6">
            {/* How it works */}
            <div className="bg-card border rounded-xl overflow-hidden">
                <button
                    onClick={() => setShowHelp(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
                >
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Info className="h-4 w-4" />
                        How segmentation works
                    </div>
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", showHelp && "rotate-90")} />
                </button>
                {showHelp && (
                    <div className="px-5 pb-5 border-t">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                            <div className="space-y-3">
                                <div className="flex gap-3">
                                    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">1</div>
                                    <div>
                                        <p className="text-sm font-medium">Add segments</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">Click <strong>Add Segment</strong> to define a population by filter conditions (e.g. state=CA, customer_type=Consumer). Use <strong>Auto-Generate</strong> to bulk-create all combinations of one or more columns at once.</p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">2</div>
                                    <div>
                                        <p className="text-sm font-medium">Calibrate thresholds</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">Click <strong>Calibrate</strong> to score each segment against the active model and compute segment-specific risk cutoffs in bulk. Optionally enter a target bad rate (e.g. 15%) to solve thresholds automatically across all segments.</p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold mt-0.5">3</div>
                                    <div>
                                        <p className="text-sm font-medium">Review &amp; override</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">Click any row to open the segment detail view. Adjust the approval slider or bad-rate slider, then click <strong>Save Threshold</strong> to override. You only need to do this for segments you want to fine-tune — Calibrate handles the rest automatically.</p>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Threshold logic</p>
                                <div className="flex items-start gap-2.5">
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                                    <p className="text-xs text-muted-foreground"><strong className="text-foreground">Configured segments</strong> use their own score cutoff, derived from segment-level risk distribution. Higher-risk populations automatically get tighter thresholds.</p>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/50 mt-1.5 shrink-0" />
                                    <p className="text-xs text-muted-foreground"><strong className="text-foreground">Uncalibrated segments</strong> inherit the global policy threshold until Calibrate is run.</p>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mt-1.5 shrink-0" />
                                    <p className="text-xs text-muted-foreground"><strong className="text-foreground">Low Sample (yellow)</strong> — fewer than ~200 observations. The threshold is computed but unreliable. Click in to manually review the risk chart and override if needed.</p>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                                    <p className="text-xs text-muted-foreground"><strong className="text-foreground">Insufficient (red)</strong> — not enough data to compute a threshold. The segment inherits the global cutoff and cannot be overridden until more data is available.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Summary bar */}
            <div className="bg-card border rounded-xl p-5 flex flex-wrap items-center gap-6">
                <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Segments defined</p>
                    <p className="text-2xl font-bold">{(segments?.length ?? 0)}</p>
                </div>
                {totalSamples > 0 && (
                    <div>
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Portfolio size</p>
                        <p className="text-2xl font-bold">{totalSamples.toLocaleString()}</p>
                    </div>
                )}
                {needsReview > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <span className="text-sm text-yellow-800 font-medium">{needsReview} segment{needsReview > 1 ? "s" : ""} need review</span>
                    </div>
                )}
                {hasUncalibrated && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                        <Info className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Run calibration to compute sample counts</span>
                    </div>
                )}
                <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                    {/* Bad rate constraint — enter as percentage e.g. 15 = 15% */}
                    <div className="flex items-center gap-2 border-2 border-dashed border-primary/30 rounded-lg px-3 py-1.5 bg-primary/5 focus-within:border-primary focus-within:bg-primary/10 transition-colors">
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Reject above</span>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            placeholder="e.g. 15"
                            value={targetBadRatePct}
                            onChange={e => setTargetBadRatePct(e.target.value)}
                            className="w-16 text-sm font-bold text-primary text-center bg-transparent focus:outline-none placeholder:text-muted-foreground/50 placeholder:font-normal"
                        />
                        <span className="text-xs font-medium text-muted-foreground">% bad rate</span>
                    </div>

                    <button
                        onClick={() => calibrateMutation.mutate()}
                        disabled={calibrateMutation.isPending}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                            calibrateSuccess
                                ? "bg-green-50 border-green-200 text-green-700"
                                : "bg-card hover:bg-muted border-border text-foreground"
                        )}
                    >
                        <RefreshCw className={cn("h-4 w-4", calibrateMutation.isPending && "animate-spin")} />
                        {calibrateMutation.isPending
                            ? (targetBadRateDecimal !== undefined ? "Solving thresholds..." : "Calibrating...")
                            : calibrateSuccess ? "Calibrated!" : "Calibrate"}
                    </button>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                        Add Segment
                    </button>
                </div>
            </div>

            {calibrateError && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-3">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive flex-1">{calibrateError}</p>
                    <button onClick={() => setCalibrateError(null)}><X className="h-4 w-4 text-destructive" /></button>
                </div>
            )}

            {/* Segment detail panel — replaces table when a segment is selected */}
            {selectedSegment && (
                <SegmentAnalysisPanel
                    segment={selectedSegment}
                    policyId={policyId}
                    globalThreshold={globalThreshold}
                    onClose={() => setSelectedSegment(null)}
                    onSaved={(updated) => {
                        queryClient.setQueryData<PolicySegment[]>(["segments", policyId], (prev) =>
                            prev?.map(s => s.id === updated.id ? updated : s) ?? [updated]
                        );
                        setSelectedSegment(updated);
                    }}
                    onDeleted={(id) => {
                        queryClient.setQueryData<PolicySegment[]>(["segments", policyId], (prev) =>
                            prev?.filter(s => s.id !== id) ?? []
                        );
                        setSelectedSegment(null);
                    }}
                />
            )}

            {/* Segment table — hidden while a segment is selected */}
            {!selectedSegment && <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                        <tr>
                            <th className="px-5 py-3 text-left font-medium text-muted-foreground">Segment</th>
                            <th className="px-5 py-3 text-right font-medium text-muted-foreground">Samples</th>
                            <th className="px-5 py-3 text-right font-medium text-muted-foreground">Proj. Approval</th>
                            <th className="px-5 py-3 text-right font-medium text-muted-foreground">Default Rate</th>
                            <th className="px-5 py-3 text-right font-medium text-muted-foreground">Threshold</th>
                            <th className="px-5 py-3 text-center font-medium text-muted-foreground" title="Based on sample size — Yellow means limited data, treat threshold with caution">
                                Confidence ⓘ
                            </th>
                            <th className="px-5 py-3 w-8"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {isLoading && (
                            <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">Loading segments...</td></tr>
                        )}
                        {!isLoading && !segments?.length && (
                            <tr>
                                <td colSpan={7} className="px-5 py-12 text-center">
                                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                        <Layers className="h-8 w-8 opacity-30" />
                                        <p className="text-sm">No segments defined yet.</p>
                                        <button
                                            onClick={() => setShowAddModal(true)}
                                            className="text-primary text-sm font-medium hover:underline"
                                        >
                                            Add your first segment →
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {/* Global row always first */}
                        {globalSegment && (
                            <SegmentRow
                                key={globalSegment.id}
                                segment={globalSegment}
                                globalDefaultRate={globalDefaultRate}
                                isSelected={selectedSegmentId === globalSegment.id}
                                isPendingDelete={pendingDeleteId === globalSegment.id}
                                isDeleting={deletingId === globalSegment.id}
                                onDeleteClick={(e) => { e.stopPropagation(); setPendingDeleteId(globalSegment.id); }}
                                onDeleteConfirm={() => handleDeleteSegment(globalSegment.id)}
                                onDeleteCancel={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}
                                onClick={() => setSelectedSegment(
                                    selectedSegmentId === globalSegment.id ? null : globalSegment
                                )}
                            />
                        )}
                        {displaySegments.map(seg => (
                            <SegmentRow
                                key={seg.id}
                                segment={seg}
                                globalDefaultRate={globalDefaultRate}
                                isSelected={selectedSegmentId === seg.id}
                                isPendingDelete={pendingDeleteId === seg.id}
                                isDeleting={deletingId === seg.id}
                                onDeleteClick={(e) => { e.stopPropagation(); setPendingDeleteId(seg.id); }}
                                onDeleteConfirm={() => handleDeleteSegment(seg.id)}
                                onDeleteCancel={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}
                                onClick={() => setSelectedSegment(
                                    selectedSegmentId === seg.id ? null : seg
                                )}
                            />
                        ))}
                    </tbody>
                </table>

                {sortedNonGlobal.length > 8 && (
                    <div className="px-5 py-3 border-t bg-muted/20">
                        <button
                            onClick={() => setShowAll(v => !v)}
                            className="text-sm text-primary font-medium hover:underline"
                        >
                            {showAll
                                ? "Show fewer"
                                : `Show all ${sortedNonGlobal.length} segments`}
                        </button>
                    </div>
                )}
            </div>}

            {/* Add Segment Modal */}
            {showAddModal && (
                <AddSegmentModal
                    policyId={policyId}
                    globalThreshold={globalThreshold}
                    datasetId={datasetId}
                    onClose={() => setShowAddModal(false)}
                    onCreated={(created) => {
                        queryClient.setQueryData<PolicySegment[]>(["segments", policyId], (prev) =>
                            [...(prev ?? []), created]
                        );
                        setShowAddModal(false);
                    }}
                />
            )}
        </div>
    );
}

// ─── Confidence Tier helpers ──────────────────────────────────────────────────

function TierBadge({ tier }: { tier: PolicySegment["confidence_tier"] }) {
    if (!tier) return <span className="text-xs text-muted-foreground">—</span>;
    const map: Record<string, { cls: string; label: string }> = {
        green:  { cls: "bg-green-100 text-green-800",   label: "High" },
        yellow: { cls: "bg-yellow-100 text-yellow-800", label: "Low Sample" },
        red:    { cls: "bg-red-100 text-red-800",       label: "Insufficient" },
    };
    const { cls, label } = map[tier] ?? { cls: "", label: tier };
    return (
        <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", cls)}>
            {label}
        </span>
    );
}

function TierDot({ tier }: { tier: PolicySegment["confidence_tier"] }) {
    if (!tier) return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />;
    const map = { green: "bg-green-500", yellow: "bg-yellow-500", red: "bg-red-500" };
    return <span className={cn("inline-block w-2 h-2 rounded-full", map[tier])} />;
}

function FilterTags({ filters }: { filters: Record<string, string> }) {
    const entries = Object.entries(filters);
    if (!entries.length) return <span className="text-xs text-muted-foreground italic">All applicants</span>;
    return (
        <div className="flex flex-wrap gap-1 mt-0.5">
            {entries.map(([k, v]) => (
                <span key={k} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {k}={v}
                </span>
            ))}
        </div>
    );
}

// ─── Segment Row ──────────────────────────────────────────────────────────────

function SegmentRow({
    segment, globalDefaultRate, isSelected, onClick,
    isPendingDelete, isDeleting, onDeleteClick, onDeleteConfirm, onDeleteCancel
}: {
    segment: PolicySegment;
    globalDefaultRate: number;
    isSelected: boolean;
    onClick: () => void;
    isPendingDelete?: boolean;
    isDeleting?: boolean;
    onDeleteClick?: (e: React.MouseEvent) => void;
    onDeleteConfirm?: () => void;
    onDeleteCancel?: (e: React.MouseEvent) => void;
}) {
    const effectiveThreshold = segment.override_threshold ?? segment.threshold;
    const isUncalibrated = segment.n_samples === null;

    return (
        <tr
            onClick={onClick}
            className={cn(
                "group cursor-pointer transition-colors hover:bg-muted/40",
                isSelected && "bg-primary/5 border-l-2 border-l-primary"
            )}
        >
            <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                    <TierDot tier={segment.confidence_tier} />
                    <div>
                        <span className="font-medium text-foreground">{segment.name}</span>
                        {segment.is_global && (
                            <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Global</span>
                        )}
                        <FilterTags filters={segment.filters} />
                    </div>
                </div>
            </td>
            <td className="px-5 py-3.5 text-right tabular-nums">
                {isUncalibrated
                    ? <span className="text-muted-foreground text-xs">—</span>
                    : segment.n_samples?.toLocaleString()}
            </td>
            <td className="px-5 py-3.5 text-right tabular-nums">
                {segment.projected_approval_rate !== null && segment.projected_approval_rate !== undefined
                    ? <span className="text-green-600 font-medium">{(segment.projected_approval_rate * 100).toFixed(1)}%</span>
                    : <span className="text-muted-foreground text-xs">—</span>}
            </td>
            <td className="px-5 py-3.5 text-right tabular-nums">
                {isUncalibrated ? (
                    <span className="text-muted-foreground text-xs">—</span>
                ) : (
                    <span className={cn(
                        "font-medium",
                        segment.default_rate !== null && globalDefaultRate > 0 &&
                        segment.default_rate > globalDefaultRate * 1.1 ? "text-red-600" :
                        segment.default_rate !== null && globalDefaultRate > 0 &&
                        segment.default_rate < globalDefaultRate * 0.9 ? "text-green-600" : ""
                    )}>
                        {segment.default_rate !== null ? `${(segment.default_rate * 100).toFixed(1)}%` : "—"}
                    </span>
                )}
            </td>
            <td className="px-5 py-3.5 text-right tabular-nums font-mono text-sm">
                {segment.confidence_tier === "red"
                    ? <span className="text-muted-foreground text-xs italic">inherited</span>
                    : effectiveThreshold !== null
                        ? <>
                            {effectiveThreshold.toFixed(4)}
                            {segment.override_threshold !== null && (
                                <span className="ml-1 text-xs text-amber-600 font-sans">✎</span>
                            )}
                          </>
                        : <span className="text-muted-foreground text-xs">—</span>
                }
            </td>
            <td className="px-5 py-3.5 text-center">
                <TierBadge tier={segment.confidence_tier} />
            </td>
            <td className="px-5 py-3.5 text-right">
                {isPendingDelete ? (
                    <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        <button
                            onClick={onDeleteCancel}
                            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={e => { e.stopPropagation(); onDeleteConfirm?.(); }}
                            disabled={isDeleting}
                            className="text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                        >
                            {isDeleting ? "..." : "Delete"}
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 justify-end">
                        <button
                            onClick={onDeleteClick}
                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete segment"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isSelected && "rotate-90")} />
                    </div>
                )}
            </td>
        </tr>
    );
}


// ─── Segment Analysis Panel ───────────────────────────────────────────────────

function SegmentAnalysisPanel({
    segment, policyId, globalThreshold, onClose, onSaved, onDeleted
}: {
    segment: PolicySegment;
    policyId: string;
    globalThreshold: number;
    onClose: () => void;
    onSaved: (updated: PolicySegment) => void;
    onDeleted: (id: string) => void;
}) {
    const [cutoffBandIdx, setCutoffBandIdx] = useState(0);
    const [showPAV, setShowPAV] = useState(true);
    const [showCumulative, setShowCumulative] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => { setCutoffBandIdx(0); setSaveSuccess(false); setSaveError(null); }, [segment.id]);

    const { data: calibData, isLoading, error: calibError } = useQuery({
        queryKey: ["segment-calibration", policyId, segment.id],
        queryFn: () => segmentsAPI.calibration(policyId, segment.id).then(r => r.data),
        retry: false,
    });

    const analysis = useMemo(() => {
        if (!calibData?.calibration?.length) return null;
        const sorted = [...calibData.calibration].sort((a: any, b: any) => a.decile - b.decile);

        const totalPop = sorted.reduce((s: number, b: any) => s + b.count, 0);
        const empiricalRates = sorted.map((b: any) => b.actual_rate * 100);
        const pavRates = pav(empiricalRates);

        let cumPop = 0, cumBads = 0;
        const bins = sorted.map((b: any, i: number) => {
            cumPop += b.count;
            cumBads += b.actual_rate * b.count;
            return {
                idx: i,
                decile: b.decile,
                score: b.max_score,
                count: b.count,
                empiricalBadRate: b.actual_rate * 100,
                pavBadRate: pavRates[i],
                cumBadRate: cumBads / cumPop * 100,
                cumPct: cumPop / totalPop * 100,
                chargeOffs: b.actual_rate * b.count,
                cumulativeVolume: cumPop,
                cumulativeLoss: cumBads / cumPop * 100,
            };
        });

        const totalBads = sorted.reduce((s: number, b: any) => s + b.actual_rate * b.count, 0);
        const maxBadRate = Math.max(...empiricalRates);
        return { bins, totalPop, totalBads, maxBadRate };
    }, [calibData]);

    // Auto-position cutoff when data loads or segment threshold changes
    useEffect(() => {
        if (!analysis?.bins?.length) return;
        const effectiveThreshold = segment.confidence_tier === "red"
            ? globalThreshold
            : (segment.override_threshold ?? segment.threshold);
        if (effectiveThreshold === null || effectiveThreshold === undefined) return;
        let idx = 0;
        for (let i = 0; i < analysis.bins.length; i++) {
            if (analysis.bins[i].score <= effectiveThreshold + 0.00001) idx = i;
            else break;
        }
        setCutoffBandIdx(idx);
    }, [analysis, segment.threshold, segment.override_threshold, segment.confidence_tier, globalThreshold]);

    const bins = analysis?.bins ?? [];

    const bandFromApproval = (pct: number) => {
        for (let i = 0; i < bins.length; i++) if (bins[i].cumPct >= pct) return i;
        return bins.length - 1;
    };
    const bandFromBadRate = (threshold: number) => {
        for (let i = 0; i < bins.length; i++) if (bins[i].pavBadRate >= threshold) return Math.max(0, i - 1);
        return bins.length - 1;
    };

    const currentBin = bins[cutoffBandIdx] ?? null;
    const approvalPct = currentBin ? Math.round(currentBin.cumPct) : 0;
    const cutoffBadRate = currentBin ? Math.round(currentBin.pavBadRate * 2) / 2 : 0;

    const approvedBins = bins.slice(0, cutoffBandIdx + 1);
    const rejectedBins = bins.slice(cutoffBandIdx + 1);
    const approvedPop = approvedBins.reduce((s, b) => s + b.count, 0);
    const approvedBads = approvedBins.reduce((s, b) => s + b.chargeOffs, 0);
    const rejectedPop = rejectedBins.reduce((s, b) => s + b.count, 0);
    const rejectedBads = rejectedBins.reduce((s, b) => s + b.chargeOffs, 0);
    const approvalRate = analysis ? approvedPop / analysis.totalPop : 0;
    const approvedBadRate = approvedPop > 0 ? approvedBads / approvedPop * 100 : 0;
    const rejectedBadRate = rejectedPop > 0 ? rejectedBads / rejectedPop * 100 : 0;

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        try {
            const cutoff = currentBin?.score ?? null;
            const res = await segmentsAPI.update(policyId, segment.id, {
                override_threshold: cutoff,
                override_reason: `${Math.round(approvalPct)}% population target`,
            });
            onSaved(res.data);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (e: any) {
            setSaveError(e.response?.data?.detail || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
                <button
                    onClick={onClose}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                    <ChevronLeft className="h-4 w-4" />
                    All Segments
                </button>
                <span className="text-muted-foreground">/</span>
                <span className="font-semibold text-foreground">{segment.name}</span>
                <TierBadge tier={segment.confidence_tier} />
            </div>

            {isLoading && (
                <div className="bg-card border rounded-xl p-16 text-center text-muted-foreground">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3 opacity-40" />
                    <p>Running segment inference...</p>
                    <p className="text-xs mt-1">Scoring model against segment data</p>
                </div>
            )}
            {calibError && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 text-sm text-destructive">
                    <p className="font-semibold mb-1">Failed to load segment calibration</p>
                    <p className="text-destructive/80">{(calibError as any).response?.data?.detail || "Make sure the model artifact is available and the segment has enough data."}</p>
                </div>
            )}

            {calibData && !analysis && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                    Not enough data to compute analysis for this segment ({calibData.n_samples} samples, minimum 10 required).
                </div>
            )}

            {calibData && analysis && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* ── Left: controls ── */}
                    <div className="lg:col-span-1 space-y-5">
                        {/* Segment card */}
                        <div className="p-4 bg-muted/20 border rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-foreground">{segment.name}</span>
                                {segment.is_global && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Global</span>}
                            </div>
                            <FilterTags filters={segment.filters} />
                            {segment.n_samples !== null && (
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm mt-2">
                                    <span className="text-muted-foreground">Loans in segment</span>
                                    <span className="font-medium text-right">{segment.n_samples.toLocaleString()}</span>
                                    <span className="text-muted-foreground">Historical default rate</span>
                                    <span className="font-medium text-right">{segment.default_rate !== null ? `${(segment.default_rate * 100).toFixed(1)}%` : "—"}</span>
                                    <span className="text-muted-foreground">Global threshold</span>
                                    <span className="font-mono text-sm text-right">{globalThreshold.toFixed(4)}</span>
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex justify-between mb-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Approval target</label>
                                <span className="text-xs font-bold text-primary">{approvalPct}%</span>
                            </div>
                            <input
                                type="range" min="1" max="99" step="1"
                                className="w-full cursor-pointer accent-primary"
                                value={approvalPct}
                                onChange={(e) => setCutoffBandIdx(bandFromApproval(parseInt(e.target.value)))}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>Selective (1%)</span>
                                <span>All In (99%)</span>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between mb-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Reject above bad rate</label>
                                <span className="text-xs font-bold text-warn">{cutoffBadRate.toFixed(1)}%</span>
                            </div>
                            <input
                                type="range" min="0.5" max={Math.ceil(analysis.maxBadRate ?? 35)} step="0.5"
                                className="w-full cursor-pointer accent-primary"
                                value={cutoffBadRate}
                                onChange={(e) => setCutoffBandIdx(bandFromBadRate(parseFloat(e.target.value)))}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>Conservative</span>
                                <span>Permissive</span>
                            </div>
                        </div>

                        <div className="pt-4 border-t mt-4 space-y-3">
                            <div>
                                <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Score Cutoff</h4>
                                <p className="text-2xl font-bold font-mono">{(currentBin?.score ?? 0).toFixed(4)}</p>
                                {segment.override_threshold !== null && (
                                    <p className="text-xs text-amber-600 mt-0.5">
                                        Current override: <span className="font-mono">{segment.override_threshold?.toFixed(4)}</span>
                                    </p>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Proj. Approval</h4>
                                    <p className="text-lg font-bold text-up">{(approvalRate * 100).toFixed(1)}%</p>
                                </div>
                                <div>
                                    <h4 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Proj. Loss</h4>
                                    <p className="text-lg font-bold text-down">{approvedBadRate.toFixed(2)}%</p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t flex gap-2">
                            <button
                                onClick={handleSave}
                                disabled={saving || segment.confidence_tier === "red"}
                                className={cn(
                                    "flex-1 h-9 rounded-lg text-sm font-medium transition-colors",
                                    saveSuccess
                                        ? "bg-green-600 text-white"
                                        : segment.confidence_tier === "red"
                                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                            >
                                {saving ? "Saving..." : saveSuccess ? "Saved!" : "Save Threshold"}
                                {saveSuccess && <Check className="inline ml-1.5 h-3.5 w-3.5" />}
                            </button>
                            {!segment.is_global && (
                                <button
                                    onClick={async () => {
                                        if (!window.confirm(`Delete segment "${segment.name}"?`)) return;
                                        try {
                                            await segmentsAPI.delete(policyId, segment.id);
                                            onDeleted(segment.id);
                                        } catch (e: any) {
                                            setSaveError(e.response?.data?.detail || "Delete failed");
                                        }
                                    }}
                                    className="h-9 px-3 border border-destructive/30 text-destructive rounded-lg text-sm hover:bg-destructive/5 transition-colors"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        {segment.confidence_tier === "red" && (
                            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                                Threshold locked — insufficient data. Calibrate with more data or inherit from parent segment.
                            </p>
                        )}
                        {saveError && (
                            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">{saveError}</p>
                        )}
                    </div>

                    {/* ── Right: charts + table ── */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Chart 1: Risk quality */}
                        <div className="panel">
                            <div className="panel-head">
                                <span className="panel-title">Risk Quality by Score Band — {segment.name}</span>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setShowPAV(v => !v)}
                                        className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors",
                                            showPAV ? "border-border text-foreground" : "border-transparent text-muted-foreground opacity-40")}
                                    >
                                        <span className="inline-block w-4 h-0.5 rounded bg-amber-400" />
                                        PAV-smoothed
                                    </button>
                                    <button
                                        onClick={() => setShowCumulative(v => !v)}
                                        className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors",
                                            showCumulative ? "border-border text-foreground" : "border-transparent text-muted-foreground opacity-40")}
                                    >
                                        <span className="inline-block w-4 h-0.5 rounded bg-red-400" />
                                        Cumulative
                                    </button>
                                </div>
                            </div>
                            <div className="p-4">
                                <div
                                    className="h-[260px] cursor-col-resize select-none"
                                    onMouseDown={() => setIsDragging(true)}
                                    onMouseUp={() => setIsDragging(false)}
                                    onMouseLeave={() => setIsDragging(false)}
                                >
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={bins}
                                            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                                            onClick={(d) => { if (d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                            onMouseMove={(d) => { if (isDragging && d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                            <XAxis dataKey="score" tickFormatter={(v) => typeof v === 'number' ? v.toFixed(2) : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38} />
                                            <Tooltip
                                                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                formatter={((value: any, name?: string) => [`${Number(value).toFixed(2)}%`, name ?? ""]) as any}
                                                labelFormatter={(label) => `Score: ${typeof label === 'number' ? label.toFixed(3) : label}`}
                                            />
                                            {cutoffBandIdx >= 0 && (
                                                <ReferenceArea
                                                    x1={bins[0]?.score}
                                                    x2={currentBin?.score}
                                                    fill="hsl(var(--up))" fillOpacity={0.05}
                                                />
                                            )}
                                            {cutoffBandIdx < bins.length - 1 && (
                                                <ReferenceArea
                                                    x1={currentBin?.score}
                                                    x2={bins[bins.length - 1]?.score}
                                                    fill="hsl(var(--down))" fillOpacity={0.05}
                                                />
                                            )}
                                            <ReferenceLine x={currentBin?.score} stroke="hsl(var(--warn))" strokeWidth={1.5} strokeDasharray="0" />
                                            <ReferenceLine y={cutoffBadRate} stroke="hsl(var(--down))" strokeWidth={1} strokeDasharray="4 3" />
                                            <Bar dataKey="empiricalBadRate" name="Bucket bad rate" fill="hsl(210 100% 58% / 0.45)" stroke="hsl(210 100% 58% / 0.7)" strokeWidth={1} radius={[2,2,0,0]} />
                                            {showPAV && <Line type="stepAfter" dataKey="pavBadRate" name="PAV-smoothed" stroke="hsl(var(--warn))" strokeWidth={1.5} dot={false} />}
                                            {showCumulative && <Line type="monotone" dataKey="cumBadRate" name="Cumulative (approved)" stroke="hsl(var(--down))" strokeWidth={1.5} dot={false} />}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2 px-1">
                                    Click or drag on chart to set cutoff · PAV enforces monotonicity · Dashed line = bad rate threshold
                                </p>
                            </div>
                        </div>

                        {/* Stat bar */}
                        <div className="grid grid-cols-4 gap-3">
                            <div className="panel p-3">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Score Cutoff</div>
                                <div className="text-lg font-bold font-mono text-info">{(currentBin?.score ?? 0).toFixed(4)}</div>
                            </div>
                            <div className="panel p-3">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Proj. Approval</div>
                                <div className="text-lg font-bold text-up">{(approvalRate * 100).toFixed(1)}%</div>
                            </div>
                            <div className="panel p-3">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bad Rate (Approved)</div>
                                <div className="text-lg font-bold text-warn">{approvedBadRate.toFixed(2)}%</div>
                            </div>
                            <div className="panel p-3">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bad Rate (Rejected)</div>
                                <div className="text-lg font-bold text-down">{rejectedBadRate.toFixed(2)}%</div>
                            </div>
                        </div>

                        {/* Chart 2: Population density + CDF */}
                        <div className="panel">
                            <div className="panel-head">
                                <span className="panel-title">Population Density &amp; Cumulative Volume</span>
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span className="inline-block w-3 h-3 rounded-sm bg-muted-foreground/30" />
                                        Applications per band
                                    </span>
                                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span className="inline-block w-4 h-0.5 rounded bg-info" />
                                        Cum. % approved
                                    </span>
                                </div>
                            </div>
                            <div className="p-4">
                                <div
                                    className="h-[140px] cursor-col-resize select-none"
                                    onMouseDown={() => setIsDragging(true)}
                                    onMouseUp={() => setIsDragging(false)}
                                    onMouseLeave={() => setIsDragging(false)}
                                >
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={bins}
                                            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                                            onClick={(d) => { if (d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                            onMouseMove={(d) => { if (isDragging && d?.activeTooltipIndex != null) setCutoffBandIdx(d.activeTooltipIndex as number); }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                            <XAxis dataKey="score" tickFormatter={(v) => typeof v === 'number' ? v.toFixed(2) : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                            <YAxis yAxisId="pop" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38} />
                                            <YAxis yAxisId="cdf" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
                                            <Tooltip
                                                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                formatter={((value: any, name?: string) => [name === 'Cum. % approved' ? `${Number(value).toFixed(1)}%` : Number(value).toLocaleString(), name ?? ""]) as any}
                                                labelFormatter={(label) => `Score: ${typeof label === 'number' ? label.toFixed(3) : label}`}
                                            />
                                            <ReferenceLine yAxisId="pop" x={currentBin?.score} stroke="hsl(var(--warn))" strokeWidth={1.5} />
                                            <Bar yAxisId="pop" dataKey="count" name="Applications" fill="hsl(var(--muted-foreground) / 0.2)" stroke="hsl(var(--muted-foreground) / 0.4)" strokeWidth={1} radius={[2,2,0,0]} />
                                            <Line yAxisId="cdf" type="monotone" dataKey="cumPct" name="Cum. % approved" stroke="hsl(210 100% 58%)" strokeWidth={1.5} dot={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* Band Performance table */}
                        <div className="panel overflow-hidden">
                            <div className="panel-head">
                                <span className="panel-title">Band Performance</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="dt w-full text-sm">
                                    <thead>
                                        <tr>
                                            <th className="h-9 px-4 text-left font-medium text-muted-foreground">Band</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Score</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Originations</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Charge Offs</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Rate %</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground border-l border-border/50">Cum. Orig.</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Cum. C/O</th>
                                            <th className="h-9 px-4 text-right font-medium text-muted-foreground">Cum. Rate %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bins.map((row, i) => (
                                            <tr
                                                key={row.decile}
                                                className={cn("border-b border-border/30 last:border-0 transition-colors cursor-pointer hover:bg-muted/40",
                                                    i <= cutoffBandIdx ? "bg-up/5" : "")}
                                                onClick={() => setCutoffBandIdx(i)}
                                            >
                                                <td className="p-3 font-medium text-xs">{row.decile}</td>
                                                <td className="p-3 text-right font-mono text-xs">{row.score.toFixed(3)}</td>
                                                <td className="p-3 text-right tabular-nums">{row.count.toLocaleString()}</td>
                                                <td className="p-3 text-right tabular-nums text-down">{Math.round(row.chargeOffs).toLocaleString()}</td>
                                                <td className="p-3 text-right font-semibold">{row.empiricalBadRate.toFixed(2)}%</td>
                                                <td className="p-3 text-right tabular-nums text-muted-foreground border-l border-border/30">{row.cumulativeVolume.toLocaleString()}</td>
                                                <td className="p-3 text-right tabular-nums text-muted-foreground">{Math.round(row.cumulativeVolume * row.cumulativeLoss / 100).toLocaleString()}</td>
                                                <td className="p-3 text-right font-bold">{row.cumulativeLoss.toFixed(2)}%</td>
                                            </tr>
                                        ))}
                                        <tr className="bg-muted/30 font-bold border-t border-border">
                                            <td className="p-3 text-xs" colSpan={2}>TOTAL</td>
                                            <td className="p-3 text-right tabular-nums">{analysis.totalPop.toLocaleString()}</td>
                                            <td className="p-3 text-right tabular-nums text-down">{Math.round(analysis.totalBads).toLocaleString()}</td>
                                            <td className="p-3 text-right">{(analysis.totalBads / analysis.totalPop * 100).toFixed(2)}%</td>
                                            <td className="p-3 border-l border-border/30" colSpan={3}></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Add Segment Modal ────────────────────────────────────────────────────────

function AddSegmentModal({
    policyId, globalThreshold, datasetId, onClose, onCreated
}: {
    policyId: string;
    globalThreshold: number;
    datasetId: string | undefined;
    onClose: () => void;
    onCreated: (segment: PolicySegment) => void;
}) {
    const queryClient = useQueryClient();
    const [mode, setMode] = useState<"single" | "bulk">("single");

    // ── Single mode state ─────────────────────────────────────────────────────
    const [name, setName] = useState("");
    const [filters, setFilters] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);

    // ── Bulk mode state ───────────────────────────────────────────────────────
    const [selectedCols, setSelectedCols] = useState<string[]>([]);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    // ── Shared ────────────────────────────────────────────────────────────────
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch segmentable columns
    const { data: segmentCols, isLoading: colsLoading } = useQuery<{ column: string; values: string[] }[]>({
        queryKey: ["segment-columns", datasetId],
        queryFn: () => datasetsAPI.segmentColumns(datasetId!).then(r => r.data),
        enabled: !!datasetId,
        staleTime: 5 * 60 * 1000,
    });
    const colMap = useMemo(() => {
        const m: Record<string, string[]> = {};
        segmentCols?.forEach(c => { m[c.column] = c.values; });
        return m;
    }, [segmentCols]);
    const columnOptions = segmentCols?.map(c => c.column) ?? [];

    // ── Single: auto-name from filter values ──────────────────────────────────
    const autoName = useMemo(() => {
        const valid = filters.filter(f => f.value.trim());
        return valid.map(f => f.value).join(" ");
    }, [filters]);

    const addFilter = () => setFilters(f => [...f, { key: "", value: "" }]);
    const removeFilter = (i: number) => setFilters(f => f.filter((_, idx) => idx !== i));
    const updateKey = (i: number, val: string) =>
        setFilters(f => f.map((row, idx) => idx === i ? { key: val, value: "" } : row));
    const updateValue = (i: number, val: string) =>
        setFilters(f => f.map((row, idx) => idx === i ? { ...row, value: val } : row));

    const handleSingleSubmit = async () => {
        const validFilters = filters.filter(f => f.key.trim() && f.value.trim());
        const filterMap: Record<string, string> = {};
        for (const { key, value } of validFilters) filterMap[key] = value;
        const segName = name.trim() || autoName || "Global";
        setSaving(true); setError(null);
        try {
            const res = await segmentsAPI.create(policyId, { name: segName, filters: filterMap, threshold: globalThreshold || null });
            onCreated(res.data);
        } catch (e: any) {
            setError(e.response?.data?.detail || "Failed to create segment");
            setSaving(false);
        }
    };

    // ── Bulk: cartesian product ───────────────────────────────────────────────
    const bulkCombinations = useMemo(() => {
        if (!selectedCols.length) return [];
        const arrays = selectedCols.map(col => (colMap[col] ?? []).map(v => ({ col, v })));
        if (arrays.some(a => !a.length)) return [];
        return arrays.reduce<{ col: string; v: string }[][]>(
            (acc, arr) => acc.flatMap(combo => arr.map(item => [...combo, item])),
            [[]]
        );
    }, [selectedCols, colMap]);

    const bulkCount = bulkCombinations.length;
    const tooMany = bulkCount > 100;

    const handleBulkSubmit = async () => {
        if (!bulkCount) return;
        setSaving(true); setError(null);
        setProgress({ done: 0, total: bulkCount });
        let created = 0;
        for (const combo of bulkCombinations) {
            const filterMap: Record<string, string> = {};
            combo.forEach(({ col, v }) => { filterMap[col] = v; });
            const segName = combo.map(({ v }) => v).join(" · ");
            try {
                await segmentsAPI.create(policyId, { name: segName, filters: filterMap, threshold: globalThreshold || null });
                created++;
            } catch { /* skip failures */ }
            setProgress(p => p ? { ...p, done: p.done + 1 } : null);
        }
        setSaving(false); setProgress(null);
        if (created > 0) {
            queryClient.invalidateQueries({ queryKey: ["segments", policyId] });
            onClose();
        } else {
            setError("No segments could be created. They may already exist.");
        }
    };

    const toggleCol = (col: string) =>
        setSelectedCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                    <h3 className="font-semibold">Add Segment</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Mode toggle */}
                <div className="px-5 pt-4 shrink-0">
                    <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg text-sm">
                        <button
                            onClick={() => setMode("single")}
                            className={cn("py-1.5 rounded-md font-medium transition-colors", mode === "single" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                        >
                            Single Segment
                        </button>
                        <button
                            onClick={() => setMode("bulk")}
                            className={cn("py-1.5 rounded-md font-medium transition-colors", mode === "bulk" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
                        >
                            Auto-Generate
                        </button>
                    </div>
                </div>

                {/* Scrollable body */}
                <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">

                    {mode === "single" ? (
                        <>
                            {/* Step 1 instruction */}
                            <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3 leading-relaxed">
                                Pick a column and value to define who belongs to this segment. Applicants matching <strong>all</strong> conditions are grouped together and can receive a custom risk threshold.
                            </div>

                            {/* Name — optional */}
                            <div>
                                <label className="text-sm font-medium block mb-1.5">
                                    Name <span className="text-muted-foreground font-normal text-xs">(optional — auto-filled from filter values)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder={autoName || "e.g. Florida Business Loans"}
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                />
                            </div>

                            {/* Filters */}
                            <div>
                                <label className="text-sm font-medium block mb-2">Filter conditions</label>
                                {colsLoading && <p className="text-xs text-muted-foreground py-1">Loading columns...</p>}
                                <div className="space-y-2">
                                    {filters.map((row, i) => {
                                        const valuesForKey = row.key ? colMap[row.key] : undefined;
                                        return (
                                            <div key={i} className="flex gap-2 items-center">
                                                {columnOptions.length > 0 ? (
                                                    <select value={row.key} onChange={e => updateKey(i, e.target.value)}
                                                        className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                                                        <option value="">Select column...</option>
                                                        {columnOptions.map(col => <option key={col} value={col}>{col}</option>)}
                                                    </select>
                                                ) : (
                                                    <input type="text" placeholder="column" value={row.key} onChange={e => updateKey(i, e.target.value)}
                                                        className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none" />
                                                )}
                                                {valuesForKey ? (
                                                    <select value={row.value} onChange={e => updateValue(i, e.target.value)}
                                                        className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                                                        <option value="">Select value...</option>
                                                        {valuesForKey.map(v => <option key={v} value={v}>{v}</option>)}
                                                    </select>
                                                ) : (
                                                    <input type="text" placeholder="value" value={row.value} onChange={e => updateValue(i, e.target.value)}
                                                        className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none" />
                                                )}
                                                <button onClick={() => removeFilter(i)} disabled={filters.length === 1}
                                                    className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-red-600 border rounded-md disabled:opacity-30">
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <button onClick={addFilter} className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1">
                                        <Plus className="h-3.5 w-3.5" /> Add another condition
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Auto-generate instructions */}
                            <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3 leading-relaxed">
                                Select two or more columns. Sentinel will create <strong>one segment per unique combination</strong> of values — for example, selecting <em>State</em> and <em>Customer Type</em> automatically builds a segment for every state × type pair. Run <strong>Calibrate</strong> afterwards to compute thresholds.
                            </div>

                            {colsLoading && <p className="text-xs text-muted-foreground">Loading columns...</p>}

                            {!colsLoading && !columnOptions.length && (
                                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                                    No segmentable columns found in the training dataset. Make sure a dataset with categorical columns is attached to this model.
                                </div>
                            )}

                            {/* Column checkboxes */}
                            {columnOptions.length > 0 && (
                                <div>
                                    <label className="text-sm font-medium block mb-2">Select columns to combine</label>
                                    <div className="border rounded-lg divide-y overflow-hidden">
                                        {segmentCols!.map(c => (
                                            <label key={c.column} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors">
                                                <input type="checkbox" checked={selectedCols.includes(c.column)}
                                                    onChange={() => toggleCol(c.column)} className="rounded" />
                                                <span className="text-sm font-medium flex-1">{c.column}</span>
                                                <span className="text-xs text-muted-foreground tabular-nums">{c.values.length} unique values</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Live count preview */}
                            {selectedCols.length > 0 && (
                                <div className={cn("rounded-lg px-4 py-3 text-sm border", tooMany
                                    ? "bg-yellow-50 border-yellow-200 text-yellow-900"
                                    : "bg-primary/5 border-primary/20 text-foreground"
                                )}>
                                    <p className="font-semibold">
                                        {bulkCount > 0
                                            ? `This will create ${bulkCount} segment${bulkCount !== 1 ? "s" : ""}`
                                            : "No combinations available for selected columns"}
                                    </p>
                                    {selectedCols.length > 1 && bulkCount > 0 && (
                                        <p className="text-xs mt-0.5 opacity-75">
                                            {selectedCols.map(c => `${colMap[c]?.length ?? 0} ${c}`).join(" × ")} = {bulkCount}
                                        </p>
                                    )}
                                    {tooMany && (
                                        <p className="text-xs mt-1.5 font-medium">
                                            That's a lot of segments — consider selecting fewer columns for a more manageable policy.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Progress bar */}
                            {progress && (
                                <div className="bg-muted rounded-lg p-3">
                                    <div className="flex justify-between text-sm mb-1.5">
                                        <span className="text-muted-foreground">Creating segments...</span>
                                        <span className="font-mono tabular-nums">{progress.done} / {progress.total}</span>
                                    </div>
                                    <div className="h-1.5 bg-muted-foreground/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary rounded-full transition-all duration-300"
                                            style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">{error}</div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t flex justify-end gap-2 shrink-0">
                    <button onClick={onClose} disabled={saving}
                        className="h-9 px-4 border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
                        Cancel
                    </button>
                    {mode === "single" ? (
                        <button onClick={handleSingleSubmit} disabled={saving}
                            className="h-9 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                            {saving ? "Creating..." : "Create Segment"}
                        </button>
                    ) : (
                        <button onClick={handleBulkSubmit} disabled={saving || bulkCount === 0}
                            className="h-9 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                            {saving
                                ? `Creating ${progress?.done ?? 0} of ${progress?.total ?? bulkCount}...`
                                : `Generate ${bulkCount > 0 ? bulkCount + " " : ""}Segments`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
