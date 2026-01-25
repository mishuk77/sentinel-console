import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CheckCircle, Activity, TrendingUp, Server, ChevronDown } from "lucide-react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface DecisionSystem {
    id: string;
    name: string;
    active_model_id?: string;
    active_policy_id?: string;
}

export default function Dashboard() {
    const [selectedSystemId, setSelectedSystemId] = useState<string>("");

    // Fetch all systems first
    const { data: systems } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => {
            const res = await api.get("/systems/");
            return res.data;
        }
    });

    // Auto-select first system if available
    if (systems?.length && !selectedSystemId) {
        setSelectedSystemId(systems[0].id);
    }

    const selectedSystem = systems?.find(s => s.id === selectedSystemId);

    const { data: stats } = useQuery({
        queryKey: ["dashboard-stats", selectedSystemId],
        queryFn: async () => {
            const params = selectedSystemId ? { system_id: selectedSystemId } : {};
            const res = await api.get("/dashboard/stats", { params });
            return res.data;
        },
        refetchInterval: 5000,
        enabled: !!selectedSystemId || systems?.length === 0
    });

    const { data: status } = useQuery({
        queryKey: ["deployment-status", selectedSystemId],
        queryFn: async () => {
            const params = selectedSystemId ? { system_id: selectedSystemId } : {};
            const res = await api.get("/dashboard/deployment-status", { params });
            return res.data;
        },
        enabled: !!selectedSystemId || systems?.length === 0
    });

    const { data: volume } = useQuery({
        queryKey: ["dashboard-volume", selectedSystemId],
        queryFn: async () => {
            const params = selectedSystemId ? { system_id: selectedSystemId } : {};
            const res = await api.get("/dashboard/volume", { params });
            return res.data;
        },
        refetchInterval: 5000,
        enabled: !!selectedSystemId || systems?.length === 0
    });

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
                    <p className="text-muted-foreground mt-2">
                        Operational overview of Sentinel decisioning engine.
                    </p>
                </div>

                {/* System Selector */}
                {systems && systems.length > 0 && (
                    <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <div className="relative">
                            <select
                                value={selectedSystemId}
                                onChange={(e) => setSelectedSystemId(e.target.value)}
                                className={cn(
                                    "appearance-none bg-card border rounded-lg pl-3 pr-8 py-2 text-sm font-medium",
                                    "focus:outline-none focus:ring-2 focus:ring-primary/20",
                                    "cursor-pointer min-w-[200px]"
                                )}
                            >
                                {systems.map(sys => (
                                    <option key={sys.id} value={sys.id}>{sys.name}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                    </div>
                )}
            </div>

            {/* Deployment Status Widget */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Activity className="h-24 w-24" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                            <div className={cn(
                                "h-2 w-2 rounded-full",
                                status?.model?.name ? "bg-green-400 animate-pulse" : "bg-yellow-400"
                            )} />
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                                {status?.model?.name ? "System Active" : "System Pending Setup"}
                            </h2>
                        </div>
                        {selectedSystem && (
                            <span className="text-xs bg-white/10 px-3 py-1 rounded-full">
                                {selectedSystem.name}
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div>
                            <p className="text-xs text-slate-400 mb-1">Active Model</p>
                            <h3 className="text-xl font-bold truncate" title={status?.model?.name}>{status?.model?.name || "No Model Active"}</h3>
                            <div className="flex items-center space-x-2 text-xs text-slate-300 mt-1">
                                <span className="px-2 py-0.5 rounded bg-slate-700">{status?.model?.algorithm}</span>
                                <span className="font-mono opacity-70">v.{status?.model?.version}</span>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs text-slate-400 mb-1">Active Policy</p>
                            <h3 className="text-xl font-bold">
                                {status?.policy?.target_decile ? `Target: Decile ${status.policy.target_decile} (Top ${status.policy.target_decile * 10}%)` : "No Policy Active"}
                            </h3>
                            <p className="text-xs text-slate-300 mt-1">
                                Projected Loss: <span className={status?.policy?.projected_loss > 10 ? "text-red-300" : "text-green-300"}>
                                    {status?.policy?.projected_loss ? (status.policy.projected_loss * 1).toFixed(2) : 0}%
                                </span>
                            </p>
                        </div>

                        <div className="flex items-end justify-end">
                            {/* <button className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors">
                                View Details ->
                            </button> */}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-card border rounded-xl p-6 shadow-sm flex items-center space-x-4">
                    <div className="p-3 bg-blue-100/50 rounded-full">
                        <Activity className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Decisions</p>
                        <h3 className="text-2xl font-bold">{stats?.volume || 0}</h3>
                    </div>
                </div>

                <div className="bg-card border rounded-xl p-6 shadow-sm flex items-center space-x-4">
                    <div className="p-3 bg-green-100/50 rounded-full">
                        <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Approval Rate</p>
                        <h3 className="text-2xl font-bold">{stats ? (stats.approval_rate * 100).toFixed(1) : 0}%</h3>
                    </div>
                </div>

                <div className="bg-card border rounded-xl p-6 shadow-sm flex items-center space-x-4">
                    <div className="p-3 bg-purple-100/50 rounded-full">
                        <CheckCircle className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Approved</p>
                        <h3 className="text-2xl font-bold">{stats?.approvals || 0}</h3>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-card border rounded-xl p-6 shadow-sm h-[450px]">
                <h3 className="font-semibold mb-6">Decision Volume & Approval Trends</h3>
                {volume && volume.length > 0 ? (
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={volume}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" />
                                <YAxis yAxisId="left" label={{ value: 'Volume', angle: -90, position: 'insideLeft' }} />
                                <YAxis yAxisId="right" orientation="right" unit="%" label={{ value: 'Approval Rate', angle: 90, position: 'insideRight' }} />
                                <Tooltip />
                                <Legend />
                                <Bar yAxisId="left" dataKey="total" fill="#3b82f6" name="Total Volume" barSize={40} />
                                {/* Calculate rate for line */}
                                <Line yAxisId="right" type="monotone" dataKey={(d) => Math.round((d.approved / d.total) * 100)} stroke="#16a34a" strokeWidth={2} name="Approval Rate %" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                        No data available.
                    </div>
                )}
            </div>

        </div>
    );
}
