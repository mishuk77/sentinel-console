import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api, modelsAPI } from "@/lib/api";
import { useNavigate, useParams, Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Trophy, BarChart2, X, ArrowRight, Trash2, AlertCircle, GitCompare, Check, Rocket, HelpCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
// import { useSystem } from "@/lib/hooks"; // Unused

// Color palette for multi-model comparison
const COMPARISON_COLORS = [
    "#22c55e", // green
    "#3b82f6", // blue
    "#f59e0b", // amber
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
];

export default function Models() {
    const { systemId } = useParams<{ systemId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(new Set());
    const [showComparison, setShowComparison] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Fetch Models — exclude fraud models (they live in Fraud Models page)
    const { data: allModels, isLoading } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });
    const models = allModels?.filter(m => (m.metrics as any)?.model_context !== "fraud");

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/models/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["models"] });
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            setErrorMessage(null);
        },
        onError: (err: any) => {
            console.error(err);
            const msg = err.response?.data?.detail || "Failed to delete model. It may be in use by an active policy.";
            setErrorMessage(msg);
            // Auto-clear error after 5 seconds
            setTimeout(() => setErrorMessage(null), 5000);
        }
    });

    // Activate Mutation
    const activateMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await modelsAPI.activate(id);
            return response.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["models"] });
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            setErrorMessage(null);
            setSuccessMessage(`Model activated successfully! "${data.model?.name}" is now the production champion.`);
            setTimeout(() => setSuccessMessage(null), 5000);
        },
        onError: (err: any) => {
            console.error(err);
            const msg = err.response?.data?.detail || "Failed to activate model.";
            setErrorMessage(msg);
            setTimeout(() => setErrorMessage(null), 5000);
        }
    });

    const candidates = models?.filter(m => m.status === "CANDIDATE" || m.status === "ACTIVE") || [];

    // Get selected models for comparison
    const modelsToCompare = candidates.filter(m => selectedForCompare.has(m.id));

    // Toggle model selection for comparison
    const toggleModelSelection = (modelId: string) => {
        setSelectedForCompare(prev => {
            const next = new Set(prev);
            if (next.has(modelId)) {
                next.delete(modelId);
            } else {
                next.add(modelId);
            }
            return next;
        });
    };

    // Prepare Multi-Model Comparison Data
    const multiComparisonData = (() => {
        if (modelsToCompare.length < 2) return [];

        // Union of all decile numbers across all models — respects dynamic bin counts
        const allDeciles = Array.from(new Set(
            modelsToCompare.flatMap(m => (m.metrics?.calibration || []).map((b: any) => b.decile))
        )).sort((a, b) => a - b);

        return allDeciles.map(d => {
            const dataPoint: Record<string, any> = { decile: d };

            modelsToCompare.forEach((model, idx) => {
                const calib = model.metrics?.calibration || [];
                const bin = calib.find((b: any) => b.decile === d);
                dataPoint[`model_${idx}`] = bin ? (bin.actual_rate * 100) : null;
            });

            return dataPoint;
        });
    })();

    // Sorting State
    const [sortConfig, setSortConfig] = useState<{ key: keyof MLModel | 'auc' | 'created_at', direction: 'asc' | 'desc' }>({ key: 'created_at', direction: 'desc' });

    const handleSort = (key: keyof MLModel | 'auc' | 'created_at') => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const bestModel = candidates.length > 0
        ? [...candidates].sort((a, b) => (b.metrics?.auc || 0) - (a.metrics?.auc || 0))[0]
        : null;

    const sortedCandidates = [...candidates].sort((a, b) => {
        const { key, direction } = sortConfig;
        let valA: any = a[key as keyof MLModel];
        let valB: any = b[key as keyof MLModel];

        // Custom Keys
        if (key === 'auc') {
            valA = a.metrics?.auc || 0;
            valB = b.metrics?.auc || 0;
        } else if (key === 'created_at') {
            valA = new Date(a.created_at).getTime();
            valB = new Date(b.created_at).getTime();
        } else if (key === 'algorithm') {
            // String comparison
        } else if (key === 'name') {
            // String comparison
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    return (
        <div className="page relative">
            {/* Header */}
            <div>
                <h1 className="page-title">Model Registry</h1>
                <p className="page-desc">View trained candidate models and promote them to production.</p>
            </div>

            {/* Error Banner */}
            {errorMessage && (
                <div className="panel p-3 border-down/30 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="h-4 w-4 text-down shrink-0" />
                    <p className="text-xs text-down flex-1">{errorMessage}</p>
                    <button onClick={() => setErrorMessage(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Success Banner */}
            {successMessage && (
                <div className="panel p-3 border-up/30 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <CheckCircle className="h-4 w-4 text-up shrink-0" />
                    <p className="text-xs text-up flex-1">{successMessage}</p>
                    <button onClick={() => setSuccessMessage(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Comparison Hint */}
            {candidates.length >= 2 && selectedForCompare.size === 0 && (
                <div className="panel p-4 border-info/25 flex items-start gap-3">
                    <div className="icon-box-sm bg-info/10 mt-0.5 shrink-0">
                        <GitCompare className="h-3.5 w-3.5 text-info" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-semibold mb-0.5">Compare Model Performance</p>
                        <p className="text-xs text-muted-foreground">
                            Use the checkboxes below to select 2+ models for side-by-side comparison.
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            const top2 = sortedCandidates.slice(0, 2).map(m => m.id);
                            setSelectedForCompare(new Set(top2));
                        }}
                        className="text-xs font-medium text-info hover:underline whitespace-nowrap"
                    >
                        Quick Compare
                    </button>
                </div>
            )}

            {/* Comparison Action Bar */}
            {selectedForCompare.size >= 2 && (
                <div className="panel p-4 border-primary/25 flex items-center justify-between animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-primary/10">
                            <GitCompare className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold">{selectedForCompare.size} models selected</p>
                            <p className="text-xs text-muted-foreground">Compare risk segmentation side-by-side</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedForCompare(new Set())} className="btn-ghost btn-sm">Clear</button>
                        <button onClick={() => setShowComparison(true)} className="btn-primary btn-sm">
                            <BarChart2 className="h-3.5 w-3.5" /> Compare Models
                        </button>
                    </div>
                </div>
            )}

            {/* Models table */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <h3 className="panel-title flex items-center gap-2">
                        <Trophy className="h-3.5 w-3.5 text-warn" />
                        Candidate Models
                    </h3>
                    {candidates.length >= 2 && (
                        <p className="text-2xs text-muted-foreground">Select 2+ to compare</p>
                    )}
                </div>

                {isLoading ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">Loading models…</div>
                ) : candidates.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="icon-box bg-muted/40 mx-auto mb-3">
                            <Trophy className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-semibold mb-1">No candidate models yet</p>
                        <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
                            Train your first model to start evaluating candidates.
                        </p>
                        <Link to={`/systems/${systemId}/training`} className="btn-primary btn-sm">
                            <BarChart2 className="h-3.5 w-3.5" /> Start Training Job
                        </Link>
                    </div>
                ) : (
                    <div className="overflow-x-auto thin-scroll">
                        <table className="dt dt-hover w-full">
                            <thead>
                                <tr>
                                    <th className="w-8">
                                        <div className="flex items-center gap-1 group relative">
                                            <Check className="h-3 w-3" />
                                            <HelpCircle className="h-3 w-3 cursor-help" />
                                            <div className="absolute left-0 top-full mt-1 hidden group-hover:block w-40 bg-popover border shadow-lg rounded p-2 text-2xs normal-case font-normal text-foreground z-10">
                                                Select 2+ models to compare
                                            </div>
                                        </div>
                                    </th>
                                    <th className="cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>Model</th>
                                    <th className="cursor-pointer hover:text-foreground" onClick={() => handleSort('algorithm')}>Algorithm</th>
                                    <th className="cursor-pointer hover:text-foreground" onClick={() => handleSort('auc')}>AUC</th>
                                    <th className="cursor-pointer hover:text-foreground" onClick={() => handleSort('status')}>Status</th>
                                    <th className="cursor-pointer hover:text-foreground" onClick={() => handleSort('created_at')}>Trained</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedCandidates.map((m) => (
                                    <tr key={m.id} className={cn(
                                        m.status === "ACTIVE" && "bg-up/5",
                                        selectedForCompare.has(m.id) && "bg-primary/5"
                                    )}>
                                        <td>
                                            <button
                                                onClick={() => toggleModelSelection(m.id)}
                                                className={cn(
                                                    "h-4 w-4 rounded border-2 flex items-center justify-center transition-colors",
                                                    selectedForCompare.has(m.id)
                                                        ? "bg-primary border-primary text-primary-foreground"
                                                        : "border-muted-foreground/30 hover:border-primary"
                                                )}
                                            >
                                                {selectedForCompare.has(m.id) && <Check className="h-2.5 w-2.5" />}
                                            </button>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                {selectedForCompare.has(m.id) && (
                                                    <span
                                                        className="h-2 w-2 rounded-full shrink-0"
                                                        style={{ backgroundColor: COMPARISON_COLORS[Array.from(selectedForCompare).indexOf(m.id) % COMPARISON_COLORS.length] }}
                                                    />
                                                )}
                                                <Link to={`/systems/${systemId}/models/${m.id}`} className="font-mono text-xs text-primary hover:underline">
                                                    {m.name}
                                                </Link>
                                                {m.status === "ACTIVE" && <span className="badge badge-green">Champion</span>}
                                                {bestModel?.id === m.id && m.status !== "ACTIVE" && <span className="badge badge-blue">Best</span>}
                                            </div>
                                        </td>
                                        <td className="capitalize text-xs">{m.algorithm?.replace("_", " ")}</td>
                                        <td className="font-bold num">
                                            {m.metrics?.auc ? (
                                                <span className={m.metrics.auc > 0.75 ? "text-up" : "text-warn"}>
                                                    {(m.metrics.auc * 100).toFixed(2)}%
                                                </span>
                                            ) : "—"}
                                        </td>
                                        <td>
                                            <span className={m.status === "ACTIVE" ? "badge badge-green" : "badge badge-amber"}>
                                                {m.status === "ACTIVE" && <CheckCircle className="h-3 w-3" />}
                                                {m.status}
                                            </span>
                                        </td>
                                        <td className="text-2xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</td>
                                        <td>
                                            <div className="flex items-center justify-end gap-1">
                                                <Link to={`/systems/${systemId}/models/${m.id}`} className="btn-ghost btn-xs">Details</Link>
                                                {m.status === "CANDIDATE" && (
                                                    <button
                                                        onClick={() => { if (window.confirm(`Activate "${m.name}" as champion?`)) activateMutation.mutate(m.id); }}
                                                        className="btn btn-xs bg-up/10 text-up hover:bg-up/20"
                                                    >
                                                        <Rocket className="h-3 w-3" /> Activate
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => navigate(`/systems/${systemId}/policy?model_id=${m.id}`)}
                                                    className="btn-outline btn-xs"
                                                >
                                                    Policy <ArrowRight className="h-3 w-3" />
                                                </button>
                                                <button
                                                    onClick={() => { if (window.confirm(`Delete "${m.name}"?`)) deleteMutation.mutate(m.id); }}
                                                    className="p-1 text-muted-foreground hover:text-down transition-colors"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Multi-Model Comparison Modal */}
            {showComparison && modelsToCompare.length >= 2 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="panel w-full max-w-5xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200 shadow-2xl thin-scroll">
                        <div className="panel-head">
                            <div>
                                <p className="panel-title flex items-center gap-2">
                                    <GitCompare className="h-3.5 w-3.5" />
                                    Multi-Model Comparison
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Comparing {modelsToCompare.length} models across risk deciles
                                </p>
                            </div>
                            <button onClick={() => setShowComparison(false)} className="p-1.5 hover:bg-accent rounded transition-colors">
                                <X className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </div>

                        <div className="p-5 space-y-6">
                            {/* Model summary cards */}
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {modelsToCompare.map((model, idx) => (
                                    <div
                                        key={model.id}
                                        className="kpi"
                                        style={{ borderColor: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] + '50' }}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span
                                                className="h-2.5 w-2.5 rounded-full"
                                                style={{ backgroundColor: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] }}
                                            />
                                            <span className="text-2xs font-bold uppercase" style={{ color: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] }}>
                                                {model.status === "ACTIVE" ? "Champion" : `Model ${idx + 1}`}
                                            </span>
                                        </div>
                                        <p className="text-xs font-semibold truncate" title={model.name}>{model.name}</p>
                                        <p className="text-2xs text-muted-foreground capitalize">{model.algorithm?.replace("_", " ")}</p>
                                        <p className="mt-2 text-base font-mono font-bold">
                                            {((model.metrics?.auc || 0) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {/* Line chart */}
                            <div>
                                <p className="text-xs font-semibold mb-3">Risk by Decile Comparison</p>
                                <div className="h-[380px] w-full panel p-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={multiComparisonData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                            <XAxis
                                                dataKey="decile"
                                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                                tickLine={false} axisLine={false}
                                                label={{ value: 'Risk Decile', position: 'insideBottom', offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                                tickLine={false} axisLine={false}
                                                label={{ value: 'Default %', angle: -90, position: 'insideLeft', fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            />
                                            <Tooltip
                                                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                                                content={({ active, payload, label }) => {
                                                    if (!active || !payload) return null;
                                                    return (
                                                        <div style={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", padding: "8px 12px", fontSize: "11px" }}>
                                                            <p className="font-semibold mb-2 text-xs">Decile {label}</p>
                                                            {payload.map((entry: any, i: number) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.stroke }} />
                                                                    <span className="text-muted-foreground">{modelsToCompare[i]?.algorithm}:</span>
                                                                    <span className="font-mono font-medium">{entry.value?.toFixed(2)}%</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Legend
                                                verticalAlign="top"
                                                height={36}
                                                wrapperStyle={{ fontSize: "11px" }}
                                                formatter={(value: string) => {
                                                    const idx = parseInt(value.split('_')[1]);
                                                    const model = modelsToCompare[idx];
                                                    return model ? `${model.algorithm?.replace("_", " ")} (${((model.metrics?.auc || 0) * 100).toFixed(1)}%)` : value;
                                                }}
                                            />
                                            {modelsToCompare.map((_, idx) => (
                                                <Line
                                                    key={idx}
                                                    type="monotone"
                                                    dataKey={`model_${idx}`}
                                                    stroke={COMPARISON_COLORS[idx % COMPARISON_COLORS.length]}
                                                    strokeWidth={2}
                                                    dot={{ r: 3, strokeWidth: 2 }}
                                                    activeDot={{ r: 5, strokeWidth: 2 }}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-xs text-muted-foreground mt-3 text-center">
                                    A steeper curve indicates better risk separation. Lower risk in low deciles and higher risk in high deciles is better.
                                </p>
                            </div>

                            {/* Bar Chart Alternative View */}
                            <div>
                                <p className="text-xs font-semibold mb-3">Side-by-Side Comparison</p>
                                <div className="h-[320px] w-full panel p-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={multiComparisonData} barGap={0} barCategoryGap="15%" margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                            <XAxis dataKey="decile" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                                            <Tooltip
                                                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                                                content={({ active, payload, label }) => {
                                                    if (!active || !payload) return null;
                                                    return (
                                                        <div style={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", padding: "8px 12px", fontSize: "11px" }}>
                                                            <p className="font-semibold mb-2 text-xs">Decile {label}</p>
                                                            {payload.map((entry: any, i: number) => (
                                                                <div key={i} className="flex items-center gap-2">
                                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                                                                    <span className="text-muted-foreground">{modelsToCompare[i]?.algorithm}:</span>
                                                                    <span className="font-mono font-medium">{entry.value?.toFixed(2)}%</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <Legend
                                                verticalAlign="top"
                                                height={36}
                                                wrapperStyle={{ fontSize: "11px" }}
                                                formatter={(value: string) => {
                                                    const idx = parseInt(value.split('_')[1]);
                                                    const model = modelsToCompare[idx];
                                                    return model ? model.algorithm?.replace("_", " ") : value;
                                                }}
                                            />
                                            {modelsToCompare.map((_, idx) => (
                                                <Bar
                                                    key={idx}
                                                    dataKey={`model_${idx}`}
                                                    fill={COMPARISON_COLORS[idx % COMPARISON_COLORS.length]}
                                                    fillOpacity={0.85}
                                                    radius={[2, 2, 0, 0]}
                                                />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        <div className="panel-head border-t border-b-0">
                            <button
                                onClick={() => { setShowComparison(false); setSelectedForCompare(new Set()); }}
                                className="btn-ghost btn-sm"
                            >
                                Clear &amp; Close
                            </button>
                            <button onClick={() => setShowComparison(false)} className="btn-outline btn-sm">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
