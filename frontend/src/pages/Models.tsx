import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { useNavigate, useParams, Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Trophy, BarChart2, X, ArrowRight, Trash2, AlertCircle, GitCompare, Check } from "lucide-react";
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

    // Fetch Models
    const { data: models, isLoading } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

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

        const deciles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        return deciles.map(d => {
            const dataPoint: Record<string, any> = { decile: d };

            modelsToCompare.forEach((model, idx) => {
                const calib = model.metrics?.calibration || [];
                const bin = calib.find((b: any) => b.decile === d);
                dataPoint[`model_${idx}`] = bin ? (bin.actual_rate * 100) : 0;
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
        <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Model Registry</h1>
                <p className="text-muted-foreground mt-2">
                    View trained candidate models and promote them to production policies.
                </p>
            </div>

            {/* Error Banner */}
            {errorMessage && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                    <p className="text-sm text-destructive flex-1">{errorMessage}</p>
                    <button
                        onClick={() => setErrorMessage(null)}
                        className="text-destructive hover:text-destructive/80 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Comparison Action Bar */}
            {selectedForCompare.size >= 2 && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-full">
                            <GitCompare className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <p className="font-medium text-foreground">
                                {selectedForCompare.size} models selected for comparison
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Compare risk segmentation across multiple models
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSelectedForCompare(new Set())}
                            className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Clear Selection
                        </button>
                        <button
                            onClick={() => setShowComparison(true)}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                            <BarChart2 className="h-4 w-4" />
                            Compare Models
                        </button>
                    </div>
                </div>
            )}

            {/* Models List */}
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        Candidate Models
                    </h3>
                    {candidates.length >= 2 && (
                        <p className="text-xs text-muted-foreground">
                            Select 2+ models to compare
                        </p>
                    )}
                </div>

                {isLoading ? (
                    <div className="p-8 text-center text-muted-foreground">Loading models...</div>
                ) : candidates.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="bg-muted/30 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                            <Trophy className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-lg font-semibold text-foreground mb-2">No Candidate Models Yet</h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                            Train your first model to start evaluating candidates. Models are automatically ranked by performance.
                        </p>
                        <Link
                            to={`/systems/${systemId}/training`}
                            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-medium hover:bg-primary/90 transition-colors"
                        >
                            <BarChart2 className="h-4 w-4" />
                            Start Training Job
                        </Link>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground uppercase font-medium">
                                <tr>
                                    <th className="px-4 py-3 w-10">
                                        <span className="sr-only">Select</span>
                                    </th>
                                    <th className="px-4 py-3 cursor-pointer hover:bg-muted/80" onClick={() => handleSort('name')}>Model Name</th>
                                    <th className="px-4 py-3 cursor-pointer hover:bg-muted/80" onClick={() => handleSort('algorithm')}>Algorithm</th>
                                    <th className="px-4 py-3 cursor-pointer hover:bg-muted/80" onClick={() => handleSort('auc')}>Performance (AUC)</th>
                                    <th className="px-4 py-3 cursor-pointer hover:bg-muted/80" onClick={() => handleSort('status')}>Status</th>
                                    <th className="px-4 py-3 cursor-pointer hover:bg-muted/80" onClick={() => handleSort('created_at')}>Trained At</th>
                                    <th className="px-4 py-3">Model Details</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {sortedCandidates.map((m) => (
                                    <tr key={m.id} className={cn(
                                        "hover:bg-muted/50 transition-colors",
                                        m.status === "ACTIVE" ? "bg-green-50/50" : "",
                                        selectedForCompare.has(m.id) ? "bg-primary/5" : ""
                                    )}>
                                        <td className="px-4 py-4">
                                            <button
                                                onClick={() => toggleModelSelection(m.id)}
                                                className={cn(
                                                    "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                                                    selectedForCompare.has(m.id)
                                                        ? "bg-primary border-primary text-primary-foreground"
                                                        : "border-muted-foreground/30 hover:border-primary"
                                                )}
                                            >
                                                {selectedForCompare.has(m.id) && <Check className="h-3 w-3" />}
                                            </button>
                                        </td>
                                        <td className="px-4 py-4 font-mono text-xs font-medium text-primary">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    {selectedForCompare.has(m.id) && (
                                                        <span
                                                            className="h-2.5 w-2.5 rounded-full shrink-0"
                                                            style={{ backgroundColor: COMPARISON_COLORS[Array.from(selectedForCompare).indexOf(m.id) % COMPARISON_COLORS.length] }}
                                                        />
                                                    )}
                                                    <Link to={`/systems/${systemId}/models/${m.id}`} className="hover:underline">
                                                        {m.name}
                                                    </Link>
                                                </div>
                                                <div className="flex gap-2 mt-1">
                                                    {m.status === "ACTIVE" && <span className="text-green-600 font-bold text-[10px] uppercase">(Champion)</span>}
                                                    {bestModel?.id === m.id && <span className="text-blue-600 font-bold text-[10px] uppercase bg-blue-50 px-1 rounded">Recommended</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 capitalize">{m.algorithm?.replace("_", " ")}</td>
                                        <td className="px-4 py-4 font-bold">
                                            {m.metrics?.auc ? (
                                                <span className={cn(
                                                    m.metrics.auc > 0.8 ? "text-green-600" : "text-yellow-600"
                                                )}>
                                                    {((m.metrics?.auc || 0) * 100).toFixed(2)}%
                                                </span>
                                            ) : "-"}
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className={cn(
                                                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                                m.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800",
                                            )}>
                                                {m.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-xs text-muted-foreground">
                                            {new Date(m.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-4">
                                            <Link
                                                to={`/systems/${systemId}/models/${m.id}`}
                                                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                                Model details
                                            </Link>
                                        </td>
                                        <td className="px-4 py-4 text-right space-x-2">
                                            <button
                                                onClick={() => navigate(`/systems/${systemId}/policy?model_id=${m.id}`)}
                                                className="inline-flex items-center text-sm font-medium text-primary hover:underline hover:text-primary/80"
                                            >
                                                Configure Policy <ArrowRight className="ml-1 h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (window.confirm(`Are you sure you want to delete model "${m.name}"?`)) {
                                                        deleteMutation.mutate(m.id);
                                                    }
                                                }}
                                                className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-red-600 transition-colors p-1"
                                                title="Delete Model"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-background rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-6 border-b">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <GitCompare className="h-5 w-5" />
                                    Multi-Model Comparison
                                </h2>
                                <p className="text-muted-foreground text-sm">
                                    Comparing {modelsToCompare.length} models across risk deciles
                                </p>
                            </div>
                            <button
                                onClick={() => setShowComparison(false)}
                                className="p-2 hover:bg-muted rounded-full transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-8">
                            {/* Model Summary Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {modelsToCompare.map((model, idx) => (
                                    <div
                                        key={model.id}
                                        className="p-4 rounded-lg border"
                                        style={{ borderColor: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] + '40', backgroundColor: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] + '10' }}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span
                                                className="h-3 w-3 rounded-full"
                                                style={{ backgroundColor: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] }}
                                            />
                                            <span className="text-xs uppercase font-bold" style={{ color: COMPARISON_COLORS[idx % COMPARISON_COLORS.length] }}>
                                                {model.status === "ACTIVE" ? "Champion" : `Model ${idx + 1}`}
                                            </span>
                                        </div>
                                        <div className="text-sm font-bold truncate" title={model.name}>{model.name}</div>
                                        <div className="text-xs text-muted-foreground capitalize">{model.algorithm?.replace("_", " ")}</div>
                                        <div className="mt-3 text-lg font-mono font-bold">
                                            AUC: {((model.metrics?.auc || 0) * 100).toFixed(1)}%
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Line Chart for better multi-model comparison */}
                            <div>
                                <h3 className="font-semibold mb-4">Risk by Decile Comparison</h3>
                                <div className="h-[400px] w-full border rounded-lg p-4 bg-card">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={multiComparisonData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis
                                                dataKey="decile"
                                                label={{ value: 'Risk Decile (Low → High)', position: 'insideBottom', offset: -5 }}
                                            />
                                            <YAxis
                                                label={{ value: 'Default Rate %', angle: -90, position: 'insideLeft' }}
                                            />
                                            <Tooltip
                                                content={({ active, payload, label }) => {
                                                    if (!active || !payload) return null;
                                                    return (
                                                        <div className="bg-background border rounded-lg p-3 shadow-lg">
                                                            <p className="font-semibold mb-2">Decile {label}</p>
                                                            {payload.map((entry: any, idx: number) => (
                                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                                    <span
                                                                        className="h-2 w-2 rounded-full"
                                                                        style={{ backgroundColor: entry.stroke }}
                                                                    />
                                                                    <span className="text-muted-foreground">{modelsToCompare[idx]?.algorithm}:</span>
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
                                                    dot={{ r: 4, strokeWidth: 2 }}
                                                    activeDot={{ r: 6, strokeWidth: 2 }}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-sm text-muted-foreground mt-4 text-center">
                                    A steeper curve indicates better risk separation. Lower risk in low deciles and higher risk in high deciles is better.
                                </p>
                            </div>

                            {/* Bar Chart Alternative View */}
                            <div>
                                <h3 className="font-semibold mb-4">Side-by-Side Comparison</h3>
                                <div className="h-[350px] w-full border rounded-lg p-4 bg-card">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={multiComparisonData} barGap={0} barCategoryGap="15%">
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="decile" />
                                            <YAxis label={{ value: 'Default Rate %', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip
                                                content={({ active, payload, label }) => {
                                                    if (!active || !payload) return null;
                                                    return (
                                                        <div className="bg-background border rounded-lg p-3 shadow-lg">
                                                            <p className="font-semibold mb-2">Decile {label}</p>
                                                            {payload.map((entry: any, idx: number) => (
                                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                                    <span
                                                                        className="h-2 w-2 rounded-full"
                                                                        style={{ backgroundColor: entry.fill }}
                                                                    />
                                                                    <span className="text-muted-foreground">{modelsToCompare[idx]?.algorithm}:</span>
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
                                                />
                                            ))}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t bg-muted/10 flex justify-between">
                            <button
                                onClick={() => {
                                    setShowComparison(false);
                                    setSelectedForCompare(new Set());
                                }}
                                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
                            >
                                Clear & Close
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowComparison(false)}
                                    className="px-4 py-2 border rounded-md hover:bg-muted transition-colors text-sm font-medium"
                                >
                                    Close
                                </button>
                                {modelsToCompare.length > 0 && (
                                    <button
                                        onClick={() => {
                                            // Find best model by AUC among selected
                                            const best = [...modelsToCompare].sort((a, b) => (b.metrics?.auc || 0) - (a.metrics?.auc || 0))[0];
                                            if (best) {
                                                navigate(`/systems/${systemId}/policy?model_id=${best.id}`);
                                            }
                                        }}
                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                                    >
                                        Configure Best Model Policy
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
