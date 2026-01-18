import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { ArrowLeft, BarChart2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function ModelDetail() {
    const { systemId, id } = useParams<{ systemId: string, id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Fetch Model
    const { data: model, isLoading } = useQuery<MLModel>({
        queryKey: ["model", id],
        queryFn: async () => {
            const res = await api.get(`/models/${id}`);
            return res.data;
        },
        enabled: !!id
    });

    // Activate Mutation
    const activateMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/models/${id}/activate`, {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["model", id] });
        },
    });

    if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading model details...</div>;
    if (!model) return <div className="p-12 text-center text-red-500">Model not found.</div>;

    const featureImportance = model.metrics?.feature_importance || [];

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
            {/* Header / Nav */}
            <div className="flex items-start justify-between">
                <div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/models`)}
                        className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Model Registry
                    </button>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        {model.name || "Untitled Model"}
                        {model.status === "ACTIVE" && (
                            <span className="bg-green-100 text-green-800 text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1">
                                <Shield className="h-3 w-3" /> ACTIVE CHAMPION
                            </span>
                        )}
                    </h1>
                    <p className="text-muted-foreground mt-2 font-mono text-sm">
                        ID: {model.id} • Algorithm: <span className="capitalize text-foreground font-medium">{model.algorithm?.replace("_", " ")}</span>
                    </p>
                </div>

                <div className="flex gap-3">
                    {model.status !== "ACTIVE" && (
                        <button
                            onClick={() => activateMutation.mutate()}
                            disabled={activateMutation.isPending}
                            className={cn(
                                "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                                "bg-primary text-primary-foreground shadow hover:bg-primary/90",
                                "h-10 px-8 py-2"
                            )}
                        >
                            {activateMutation.isPending ? "Activating..." : "Activate for Decisioning"}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Col: Performance */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                            <BarChart2 className="h-5 w-5 text-blue-500" />
                            Performance Summary
                        </h3>

                        <div className="space-y-6">
                            <div>
                                <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">AUC (Discrimination)</p>
                                <div className="flex items-end gap-2 mt-1">
                                    <span className={cn(
                                        "text-4xl font-bold",
                                        (model.metrics?.auc || 0) > 0.8 ? "text-green-600" : "text-yellow-600"
                                    )}>
                                        {((model.metrics?.auc || 0) * 100).toFixed(2)}%
                                    </span>
                                    <span className="text-sm text-muted-foreground mb-1">
                                        / 100%
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    Measures how well the model separates good vs. bad loans. Higher is better.
                                </p>
                            </div>

                            <div className="pt-4 border-t">
                                <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider mb-2">Dataset Info</p>
                                <div className="text-sm">
                                    <div className="flex justify-between py-1">
                                        <span>Training Set</span>
                                        <span className="font-medium">80%</span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                        <span>Validation Set</span>
                                        <span className="font-medium">20%</span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                        <span>Target</span>
                                        <span className="font-mono bg-muted px-1 rounded">Charge_Off</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Col: Feature Importance & Lift Chart */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Feature Importance */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold text-lg mb-2">Top Contributing Drivers</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            These attributes most influenced predictions during validation.
                        </p>

                        {featureImportance.length > 0 ? (
                            <div className="space-y-6">
                                {/* Chart */}
                                <div className="h-[300px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            layout="vertical"
                                            data={featureImportance}
                                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                            <XAxis type="number" hide />
                                            <YAxis dataKey="feature" type="category" width={150} tick={{ fontSize: 12 }} />
                                            <Tooltip
                                                formatter={(value: any) => value.toFixed(4)}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                            />
                                            <Bar dataKey="importance" radius={[0, 4, 4, 0]} barSize={20}>
                                                {featureImportance.map((entry: any, index: number) => (
                                                    <Cell key={`cell-${index}`} fill="#3b82f6" fillOpacity={1 - (index * 0.05)} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* Table */}
                                <div className="overflow-hidden border rounded-lg">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-muted/50 text-muted-foreground uppercase font-medium text-xs">
                                            <tr>
                                                <th className="px-4 py-3">Attribute</th>
                                                <th className="px-4 py-3">Impact Direction</th>
                                                <th className="px-4 py-3 text-right">Relative Importance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {featureImportance.map((feat: any, i: number) => (
                                                <tr key={i} className="hover:bg-muted/50">
                                                    <td className="px-4 py-3 font-medium">{feat.feature}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn(
                                                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                                            feat.impact?.includes("Increases") ? "bg-red-50 text-red-700" :
                                                                feat.impact?.includes("Decreases") ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-700"
                                                        )}>
                                                            {feat.impact || "Variable"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                                        {feat.importance.toFixed(4)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg">
                                Feature importance not available for this model.
                            </div>
                        )}
                    </div>

                    {/* Lift / Decile Chart */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold text-lg mb-2">Lift Chart (Risk Calibration)</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            Actual Risk vs. Predicted Risk across Deciles. A steep slope indicates strong separation (Lift).
                        </p>

                        {model.metrics?.calibration && model.metrics.calibration.length > 0 ? (
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={model.metrics.calibration}
                                        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="decile"
                                            label={{ value: 'Risk Decile (Lowest to Highest)', position: 'insideBottom', offset: -5 }}
                                            tickLine={false}
                                        />
                                        <YAxis label={{ value: 'Bad Rate', angle: -90, position: 'insideLeft' }} />
                                        <Tooltip
                                            cursor={{ fill: 'transparent' }}
                                            content={({ active, payload, label }) => {
                                                if (active && payload && payload.length) {
                                                    const data = payload[0].payload;
                                                    return (
                                                        <div className="bg-white p-3 border rounded-lg shadow-lg text-xs">
                                                            <p className="font-bold mb-1">Decile {label}</p>
                                                            <p className="text-blue-600">Actual Bad Rate: {(data.actual_rate * 100).toFixed(2)}%</p>
                                                            <p className="text-orange-500">Predicted Risk: {(data.mean_score * 100).toFixed(2)}%</p>
                                                            <div className="mt-2 text-gray-400 text-[10px]">
                                                                Count: {data.count} | Min Score: {data.min_score.toFixed(3)}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Bar dataKey="actual_rate" fill="#3b82f6" name="Actual Bad Rate" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-lg">
                                Calibration data not available.
                            </div>
                        )}

                        {/* Note on interpretation */}
                        {model.metrics?.calibration && (
                            <div className="mt-4 p-4 bg-blue-50 text-blue-800 rounded-md text-sm">
                                <span className="font-bold">Interpretation:</span> Decile 1 represents the lowest predicted risk, and Decile 10 the highest.
                                Ideally, the "Actual Bad Rate" should increase monotonically from Decile 1 to 10.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
