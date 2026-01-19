import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { useNavigate, useParams, Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Trophy, BarChart2, X, ArrowRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
// import { useSystem } from "@/lib/hooks"; // Unused

export default function Models() {
    const { systemId } = useParams<{ systemId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [compareModel, setCompareModel] = useState<MLModel | null>(null);

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
        },
        onError: (err: any) => {
            console.error(err);
            const msg = err.response?.data?.detail || "Failed to delete model.";
            alert(msg);
        }
    });

    const candidates = models?.filter(m => m.status === "CANDIDATE" || m.status === "ACTIVE") || [];
    const activeModel = models?.find(m => m.status === "ACTIVE");

    // Prepare Comparison Data
    const comparisonData = (() => {
        if (!activeModel || !compareModel) return [];

        const champCalib = activeModel.metrics?.calibration || [];
        const challCalib = compareModel.metrics?.calibration || [];

        // Merge by decile (assuming 1-10 exist for both)
        const deciles = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        return deciles.map(d => {
            const champBin = champCalib.find((b: any) => b.decile === d);
            const challBin = challCalib.find((b: any) => b.decile === d);

            return {
                decile: d,
                championRisk: champBin ? (champBin.actual_rate * 100) : 0,
                challengerRisk: challBin ? (challBin.actual_rate * 100) : 0,
            };
        });
    })();

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 relative">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Model Registry</h1>
                <p className="text-muted-foreground mt-2">
                    View trained candidate models and promote them to production policies.
                </p>
            </div>

            {/* Models List */}
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        Candidate Models
                    </h3>
                </div>

                {isLoading ? (
                    <div className="p-8 text-center text-muted-foreground">Loading models...</div>
                ) : candidates.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        No candidate models found. Go to Training Jobs to train one.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground uppercase font-medium">
                                <tr>
                                    <th className="px-6 py-3">Model Name</th>
                                    <th className="px-6 py-3">Algorithm</th>
                                    <th className="px-6 py-3">Performance (AUC)</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Model Details</th>
                                    <th className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {candidates.map((m) => (
                                    <tr key={m.id} className={cn(
                                        "hover:bg-muted/50 transition-colors",
                                        m.status === "ACTIVE" ? "bg-green-50/50" : ""
                                    )}>
                                        <td className="px-6 py-4 font-mono text-xs font-medium text-primary">
                                            <Link to={`/systems/${systemId}/models/${m.id}`} className="hover:underline">
                                                {m.name}
                                            </Link>
                                            {m.status === "ACTIVE" && <span className="ml-2 text-green-600 font-bold">(Champion)</span>}
                                        </td>
                                        <td className="px-6 py-4 capitalize">{m.algorithm?.replace("_", " ")}</td>
                                        <td className="px-6 py-4 font-bold">
                                            {m.metrics?.auc ? (
                                                <span className={cn(
                                                    m.metrics.auc > 0.8 ? "text-green-600" : "text-yellow-600"
                                                )}>
                                                    {((m.metrics?.auc || 0) * 100).toFixed(2)}%
                                                </span>
                                            ) : "-"}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                                m.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800",
                                            )}>
                                                {m.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link
                                                to={`/systems/${systemId}/models/${m.id}`}
                                                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                                            >
                                                Model details
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            {m.status !== "ACTIVE" && activeModel && (
                                                <button
                                                    onClick={() => setCompareModel(m)}
                                                    className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
                                                >
                                                    <BarChart2 className="mr-1 h-4 w-4" /> Compare
                                                </button>
                                            )}
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

            {/* Comparison Modal */}
            {compareModel && activeModel && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-6 border-b">
                            <div>
                                <h2 className="text-xl font-bold">Model Comparison</h2>
                                <p className="text-muted-foreground text-sm">
                                    Champion vs. Challenger (Risk Segmentation)
                                </p>
                            </div>
                            <button
                                onClick={() => setCompareModel(null)}
                                className="p-2 hover:bg-muted rounded-full transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-8">
                            {/* Summary Stats Comparison */}
                            <div className="grid grid-cols-2 gap-8">
                                <div className="p-4 bg-green-50/50 border border-green-100 rounded-lg">
                                    <div className="text-xs uppercase font-bold text-green-600 mb-2">Champion (Active)</div>
                                    <div className="text-lg font-bold">{activeModel.name}</div>
                                    <div className="text-sm text-muted-foreground">{activeModel.algorithm}</div>
                                    <div className="mt-4 text-2xl font-mono">AUC: {((activeModel.metrics?.auc || 0) * 100).toFixed(2)}%</div>
                                </div>
                                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg">
                                    <div className="text-xs uppercase font-bold text-blue-600 mb-2">Challenger (Candidate)</div>
                                    <div className="text-lg font-bold">{compareModel.name}</div>
                                    <div className="text-sm text-muted-foreground">{compareModel.algorithm}</div>
                                    <div className="mt-4 text-2xl font-mono">AUC: {((compareModel.metrics?.auc || 0) * 100).toFixed(2)}%</div>
                                </div>
                            </div>

                            {/* Chart */}
                            <div>
                                <h3 className="font-semibold mb-4">Risk by Decile Comparison</h3>
                                <div className="h-[400px] w-full border rounded-lg p-4 bg-card">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={comparisonData} barGap={0} barCategoryGap="20%">
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="decile" label={{ value: 'Risk Decile (Low -> High)', position: 'insideBottom', offset: -5 }} />
                                            <YAxis label={{ value: 'Risk %', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip cursor={{ fill: 'transparent' }} />
                                            <Legend verticalAlign="top" height={36} />
                                            <Bar dataKey="championRisk" fill="#22c55e" name="Champion Risk %" />
                                            <Bar dataKey="challengerRisk" fill="#3b82f6" name="Challenger Risk %" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-sm text-muted-foreground mt-4 text-center">
                                    A steeper curve indicates better risk separation. Lower risk in low deciles and higher risk in high deciles is better.
                                </p>
                            </div>
                        </div>

                        <div className="p-6 border-t bg-muted/10 flex justify-end gap-3">
                            <button
                                onClick={() => setCompareModel(null)}
                                className="px-4 py-2 border rounded-md hover:bg-muted transition-colors text-sm font-medium"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => navigate(`/systems/${systemId}/policy?model_id=${compareModel.id}`)}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium"
                            >
                                Configure Challenger Policy
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
