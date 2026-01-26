import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useParams, Link } from "react-router-dom";
import { useSystem } from "@/lib/hooks";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Scale, Check, AlertTriangle, Trash2, AlertCircle, X, DollarSign, ArrowRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from "recharts";
import { cn } from "@/lib/utils";

interface ProjectedStats {
    approvalRate: number;
    lossRate: number;
    cutoff: number;
    cutoffDecile: number;
    tempCumulativeVolume?: number;
}

export default function Policy() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const { system } = useSystem();
    const [searchParams] = useSearchParams();
    const initialModelId = searchParams.get("model_id") || "";

    const [selectedModelId, setSelectedModelId] = useState(initialModelId);
    // Changed: User selects Target Decile (1-10) instead of Risk Tolerance
    const [targetDecile, setTargetDecile] = useState(10); // Default to 10 (100% population)
    const [policyName, setPolicyName] = useState("Proactive Risk Policy");
    const [activationSuccess, setActivationSuccess] = useState(false);

    // Fetch Models
    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // Derived Calculations
    const selectedModel = models?.find(m => m.id === selectedModelId);

    const analysis = useMemo<{ data: any[]; stats: ProjectedStats | null; totals: any } | null>(() => {
        if (!selectedModel?.metrics?.calibration) return null;

        const calibration = selectedModel.metrics.calibration;

        // Ensure deciles sorted 1..10
        const sortedCalibration = [...calibration].sort((a, b) => a.decile - b.decile);

        let cumulativeApproved = 0;
        let cumulativeBad = 0;
        let projectedStats: ProjectedStats | null = null;

        // Totals
        let totalCount = 0;
        let totalBad = 0;

        // Calculate cumulative stats for each decile step
        const data = sortedCalibration.map((bin: any) => {
            const binCount = bin.count;
            const binBad = bin.actual_rate * binCount;

            cumulativeApproved += binCount;
            cumulativeBad += binBad;

            totalCount += binCount;
            totalBad += binBad;

            const portfolioLoss = cumulativeBad / cumulativeApproved;

            // Logic change: We simply accept up to the target decile
            const isSelected = bin.decile <= targetDecile;

            if (isSelected) {
                // Update stats for the "Latest Selected" decile row
                // This essentially sets the stats to the Cumulative values of the Target Decile
                projectedStats = {
                    approvalRate: cumulativeApproved / (totalCount || 1), // Only valid if we processed all? No.
                    // Actually, approval rate is strictly bin.accum_orig / total. 
                    // But here we are iterating. 
                    // Let's rely on the row's cumulative view.
                    // Wait, we don't know Total yet inside map.
                    // We can fix up approvalRate after loop or trust helper if available.
                    // Simplest: store cumulative values and divide by 'totalCount' at end?
                    // But we need totalCount NOW.
                    // Let's do a pre-calc pass or just use data after map.
                    lossRate: portfolioLoss,
                    cutoff: bin.max_score,
                    cutoffDecile: bin.decile,
                    tempCumulativeVolume: cumulativeApproved // helper
                };
            }

            return {
                decile: bin.decile,
                risk: bin.actual_rate * 100, // %
                volume: binCount,
                chargeOffs: binBad,
                cumulativeVolume: cumulativeApproved,
                cumulativeChargeOffs: cumulativeBad,
                cumulativeLoss: portfolioLoss * 100, // %
                cutoff: bin.max_score
            };
        });

        const totals = {
            count: totalCount,
            chargeOffs: totalBad,
            rate: totalCount > 0 ? (totalBad / totalCount) * 100 : 0
        };

        // Fix up approval rate now that we have total
        if (projectedStats) {
            // @ts-ignore
            projectedStats.approvalRate = projectedStats.tempCumulativeVolume / totalCount;
        } else if (data.length > 0) {
            // Fallback if targetDecile is 0 (shouldn't happen with min=1) or weirdness
            projectedStats = { approvalRate: 0, lossRate: 0, cutoff: data[0].cutoff, cutoffDecile: 0 };
        }

        return { data, stats: projectedStats, totals };
    }, [selectedModel, targetDecile]);


    // Update state if query param loaded later or models fetched
    // Auto-select model and policy defaults
    useEffect(() => {
        if (!models) return;

        // 1. Resolve Model ID
        // 1. Resolve Active Model ONLY
        const activeModelId = system?.active_model_id;

        if (activeModelId && activeModelId !== selectedModelId) {
            setSelectedModelId(activeModelId);
        } else if (!activeModelId && selectedModelId) {
            // Clear selection if no active model (strict mode)
            setSelectedModelId("");
        }

        // 2. Resolve Policy Defaults (Target Decile)
        // Only do this once on load if we matched the active model
        if (activeModelId && activeModelId === system?.active_model_id) {
            const activeDecile = system.active_policy_summary?.target_decile;
            if (activeDecile) {
                setTargetDecile(activeDecile);
            }
        }
    }, [models, initialModelId, system]);

    // Activate Mutation
    const activateMutation = useMutation({
        mutationFn: async () => {
            if (!selectedModel) return;
            // Create Policy
            const policyPayload = {
                model_id: selectedModel.id,
                decision_system_id: systemId,
                threshold: analysis?.stats?.cutoff || 0.5,
                projected_approval_rate: analysis?.stats?.approvalRate || 0,
                projected_loss_rate: analysis?.stats?.lossRate || 0,
                target_decile: targetDecile
            };

            const res = await api.post("/policies/", policyPayload);
            const policyId = res.data.id;

            // Activate
            await api.put(`/policies/${policyId}/activate`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] }); // Update active policy in context
            setActivationSuccess(true);
            setTimeout(() => setActivationSuccess(false), 3000);
        }
    });

    const cutoffDecile = analysis?.stats?.cutoffDecile || 0;

    if (!models) return <div className="p-8">Loading models...</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Policy Management</h1>
                <p className="text-muted-foreground mt-2">
                    Simulate and activate risk acceptance policies based on model predictions.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Controls */}
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
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium">Population Acceptance Target</label>
                                    <span className="text-sm font-bold text-primary">{targetDecile * 10}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1" max="10" step="1"
                                    className="w-full cursor-pointer h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                                    value={targetDecile}
                                    onChange={(e) => setTargetDecile(Number(e.target.value))}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                    <span>Selective (10%)</span>
                                    <span>All In (100%)</span>
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div>
                                    <h4 className="text-xs uppercase text-muted-foreground font-semibold">Recommended Cutoff</h4>
                                    <p className="text-2xl font-bold font-mono">
                                        {(analysis?.stats?.cutoff || 0).toFixed(4)}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h4 className="text-xs uppercase text-muted-foreground font-semibold">Proj. Approval</h4>
                                        <p className="text-lg font-bold text-green-600">
                                            {((analysis?.stats?.approvalRate || 0) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                    <div>
                                        <h4 className="text-xs uppercase text-muted-foreground font-semibold">Proj. Loss</h4>
                                        <p className="text-lg font-bold text-red-600">
                                            {((analysis?.stats?.lossRate || 0) * 100).toFixed(2)}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Link to Exposure Control */}
                            <div className="pt-4 border-t">
                                <Link
                                    to={`/systems/${systemId}/exposure`}
                                    className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg hover:from-blue-100 hover:to-indigo-100 transition-colors group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="bg-blue-100 p-2 rounded-full">
                                            <DollarSign className="h-4 w-4 text-blue-700" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-blue-900">Exposure Control</p>
                                            <p className="text-xs text-blue-700">Set per-decile loan limits</p>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-blue-600 group-hover:translate-x-1 transition-transform" />
                                </Link>
                            </div>

                            <div className="pt-4 border-t">
                                <label className="text-sm font-medium mb-1 block">Policy Name</label>
                                <input
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-4"
                                    value={policyName}
                                    onChange={(e) => setPolicyName(e.target.value)}
                                />

                                <button
                                    onClick={() => activateMutation.mutate()}
                                    disabled={activateMutation.isPending}
                                    className={cn(
                                        "w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors h-10 px-4 py-2",
                                        activationSuccess
                                            ? "bg-green-600 text-white hover:bg-green-700"
                                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                                    )}
                                >
                                    {activateMutation.isPending
                                        ? "Processing..."
                                        : activationSuccess
                                            ? "Success!"
                                            : system?.active_policy_summary
                                                ? "Update Policy"
                                                : "Activate Policy"
                                    }
                                    {activationSuccess && <Check className="ml-2 h-4 w-4" />}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Charts & Tables */}
            <div className="lg:col-span-2 space-y-6">
                {!selectedModel ? (
                    <div className="bg-card border rounded-xl p-12 flex flex-col items-center justify-center text-muted-foreground h-full min-h-[400px]">
                        <Scale className="h-12 w-12 mb-4 opacity-20" />
                        <p>Select a model to analyze impact.</p>
                    </div>
                ) : !analysis ? (
                    <div className="bg-card border rounded-xl p-12 flex flex-col items-center justify-center text-muted-foreground">
                        <AlertTriangle className="h-12 w-12 mb-4 opacity-50 text-yellow-500" />
                        <p>No calibration data available for this model.</p>
                        <p className="text-sm mt-2">Try training a new model to generate metrics.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Risk Chart */}
                        <div className="bg-card border rounded-xl p-6 shadow-sm">
                            <h3 className="font-semibold mb-6">Risk by Decile</h3>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysis.data} barCategoryGap="10%">
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        {/* Use number axis to allow continuous background areas */}
                                        <XAxis
                                            dataKey="decile"
                                            type="number"
                                            domain={[0.5, 10.5]}
                                            ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                                            label={{ value: 'Risk Decile (Low -> High)', position: 'insideBottom', offset: -5 }}
                                        />
                                        <YAxis label={{ value: 'Risk %', angle: -90, position: 'insideLeft' }} />
                                        <Tooltip cursor={{ fill: 'transparent' }} />
                                        <Legend />

                                        {cutoffDecile > 0 && (
                                            <ReferenceArea x1={0.5} x2={cutoffDecile + 0.5} y1={0} fill="green" fillOpacity={0.1} />
                                        )}
                                        {/* If we select 10 (100%), no red area. 
                                            If we select 9, red is 9.5 to 10.5 
                                        */}
                                        {cutoffDecile < 10 && (
                                            <ReferenceArea x1={cutoffDecile + 0.5} x2={10.5} y1={0} fill="red" fillOpacity={0.1} />
                                        )}

                                        <Bar dataKey="risk" fill="#8884d8" name="Decile Risk %" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Detailed Table (Replaces Volume Chart) */}
                        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                            <div className="p-6 border-b">
                                <h3 className="font-semibold">Decile Performance</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr className="border-b">
                                            <th className="h-10 px-4 text-left font-medium text-muted-foreground w-[80px]">Decile</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground">Originations</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground">Charge Offs</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground">Rate %</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground bg-muted/30 border-l">Cum. Orig.</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground bg-muted/30">Cum. C/O</th>
                                            <th className="h-10 px-4 text-right font-medium text-muted-foreground bg-muted/30">Cum. Rate %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {analysis.data.map((row) => (
                                            <tr
                                                key={row.decile}
                                                className={cn(
                                                    "border-b last:border-0 transition-colors hover:bg-muted/50",
                                                    row.decile <= cutoffDecile ? "bg-green-50/50" : ""
                                                )}
                                            >
                                                <td className="p-4 font-medium">{row.decile}</td>
                                                <td className="p-4 text-right">{row.volume.toLocaleString()}</td>
                                                <td className="p-4 text-right text-red-600">{Math.round(row.chargeOffs).toLocaleString()}</td>
                                                <td className="p-4 text-right font-semibold">{row.risk.toFixed(2)}%</td>

                                                <td className="p-4 text-right text-muted-foreground bg-muted/10 border-l">{row.cumulativeVolume.toLocaleString()}</td>
                                                <td className="p-4 text-right text-muted-foreground bg-muted/10">{Math.round(row.cumulativeChargeOffs).toLocaleString()}</td>
                                                <td className={cn(
                                                    "p-4 text-right font-bold bg-muted/10",
                                                    // If cumulative loss is > tolerance?? No, tolerance is distinct.
                                                    // Just showing visual.
                                                    "text-foreground"
                                                )}>
                                                    {row.cumulativeLoss.toFixed(2)}%
                                                </td>
                                            </tr>
                                        ))}
                                        {/* Total Row */}
                                        <tr className="bg-muted font-bold border-t-2">
                                            <td className="p-4">TOTAL</td>
                                            <td className="p-4 text-right">{analysis.totals.count.toLocaleString()}</td>
                                            <td className="p-4 text-right text-red-600">{Math.round(analysis.totals.chargeOffs).toLocaleString()}</td>
                                            <td className="p-4 text-right">{analysis.totals.rate.toFixed(2)}%</td>
                                            <td className="p-4 text-right border-l">-</td>
                                            <td className="p-4 text-right">-</td>
                                            <td className="p-4 text-right">-</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                )}
            </div>

            {/* Policy History Section */}
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden mt-8">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-lg">Policy History</h3>
                </div>
                <PolicyList systemId={systemId} />
            </div>

        </div>
    );
}

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
        mutationFn: async (id: string) => {
            await api.delete(`/policies/${id}`);
        },
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
            {/* Error Banner */}
            {deleteError && (
                <div className="mx-6 mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-3 animate-in fade-in">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive flex-1">{deleteError}</p>
                    <button
                        onClick={() => setDeleteError(null)}
                        className="text-destructive hover:text-destructive/80 transition-colors"
                    >
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
                            <td className="px-6 py-4 text-xs font-mono">
                                {new Date(p.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4">{p.threshold?.toFixed(4)}</td>
                            <td className="px-6 py-4">
                                {p.target_decile ? `${p.target_decile * 10}%` : "-"}
                            </td>
                            <td className="px-6 py-4">
                                {p.is_active ? (
                                    <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs font-bold">ACTIVE</span>
                                ) : (
                                    <span className="text-muted-foreground text-xs">Inactive</span>
                                )}
                            </td>
                            <td className="px-6 py-4 text-right">
                                {!p.is_active && (
                                    <button
                                        onClick={() => {
                                            if (window.confirm("Delete this policy?")) {
                                                deleteMutation.mutate(p.id);
                                            }
                                        }}
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
