import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, API_BASE_URL, type DecisionSystem, type SystemType } from "@/lib/api";
import { Plus, ArrowRight, Clock, Trash2, AlertTriangle, RefreshCw, BrainCircuit, ShieldAlert, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import CreateSystemWizard from "@/components/CreateSystemWizard";

export default function DecisionSystems() {
    const queryClient = useQueryClient();
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const { data: systems, isLoading, isError, error, refetch } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => { const r = await api.get("/systems/"); return r.data; },
        retry: 1,
        retryDelay: 1000,
    });

    const createMutation = useMutation({
        mutationFn: async (data: { name: string; description: string; system_type: SystemType }) => {
            const r = await api.post("/systems/", data);
            return r.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["systems"] });
            setIsCreating(false);
            setCreateError(null);
        },
        onError: (err) => {
            const e = err as { response?: { data?: { detail?: string } }; code?: string; message?: string };
            setCreateError(
                e?.code === "ERR_NETWORK"
                    ? "Cannot connect to API. Is the backend running?"
                    : e?.response?.data?.detail || e?.message || "Failed to create system"
            );
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => { await api.delete(`/systems/${id}`); },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["systems"] }),
        onError: () => alert("Failed to delete system."),
    });

    if (isLoading) {
        return (
            <div className="page">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="panel p-5 space-y-3">
                            <div className="skeleton h-8 w-8 rounded" />
                            <div className="skeleton h-4 w-2/3" />
                            <div className="skeleton h-3 w-full" />
                            <div className="skeleton h-3 w-4/5" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (isError) {
        const axiosError = error as { response?: { data?: { detail?: string } }; code?: string };
        return (
            <div className="page">
                <div className="panel p-8 flex flex-col items-center text-center max-w-lg mx-auto">
                    <div className="icon-box bg-down/10 mb-3">
                        <AlertTriangle className="h-5 w-5 text-down" />
                    </div>
                    <p className="text-sm font-semibold mb-1">Failed to load systems</p>
                    <p className="text-xs text-muted-foreground mb-2">
                        {axiosError?.code === "ERR_NETWORK"
                            ? "Cannot connect to the API server. Ensure the backend is running."
                            : axiosError?.response?.data?.detail || (error instanceof Error ? error.message : "Unknown error")}
                    </p>
                    <p className="text-2xs text-muted-foreground font-mono mb-4">{API_BASE_URL}</p>
                    <button onClick={() => refetch()} className="btn-outline btn-sm">
                        <RefreshCw className="h-3 w-3" /> Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Decision Systems</h1>
                    <p className="page-desc">Isolated workspaces with configurable modules</p>
                </div>
                <button onClick={() => setIsCreating(true)} className="btn-primary">
                    <Plus className="h-3.5 w-3.5" /> New System
                </button>
            </div>

            {/* System grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {systems?.map((sys) => {
                    const st = sys.system_type || "full";
                    const TypeIcon = st === "credit" ? BrainCircuit : st === "fraud" ? ShieldAlert : Zap;
                    const typeLabel = st === "credit" ? "Credit Risk" : st === "fraud" ? "Fraud Detection" : "Full Pipeline";
                    const typeBadge = st === "credit" ? "badge-blue" : st === "fraud" ? "badge-amber" : "badge-green";

                    return (
                        <Link
                            key={sys.id}
                            to={`/systems/${sys.id}/overview`}
                            className={cn(
                                "group panel p-5 flex flex-col",
                                "hover:border-primary/40 transition-colors relative overflow-hidden"
                            )}
                        >
                            {/* Top row */}
                            <div className="flex items-start justify-between mb-4">
                                <div className="icon-box bg-primary/10">
                                    <TypeIcon className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (window.confirm(`Delete system "${sys.name}"? This removes ALL associated data.`)) {
                                                deleteMutation.mutate(sys.id);
                                            }
                                        }}
                                        className="p-1.5 text-muted-foreground hover:text-down transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-all group-hover:translate-x-0.5" />
                                </div>
                            </div>

                            <h3 className="text-sm font-semibold mb-1 group-hover:text-primary transition-colors">
                                {sys.name}
                            </h3>
                            <p className="text-xs text-muted-foreground mb-4 line-clamp-2 min-h-[32px] flex-1">
                                {sys.description || "No description provided."}
                            </p>

                            {/* System type badge */}
                            <div className="flex flex-wrap gap-1 mb-4">
                                <span className={cn("badge", typeBadge)}>
                                    {typeLabel}
                                </span>
                            </div>

                            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground border-t pt-3">
                                <Clock className="h-3 w-3" />
                                <span>{new Date(sys.created_at).toLocaleDateString()}</span>
                            </div>
                        </Link>
                    );
                })}

                {(!systems || systems.length === 0) && (
                    <button
                        onClick={() => setIsCreating(true)}
                        className={cn(
                            "col-span-full panel p-12 flex flex-col items-center",
                            "border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                        )}
                    >
                        <div className="icon-box bg-muted/40 mb-3">
                            <Plus className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-medium">Create your first decision system</p>
                        <p className="text-xs text-muted-foreground mt-1">Set up an isolated workspace with configurable modules</p>
                    </button>
                )}
            </div>

            {isCreating && (
                <CreateSystemWizard
                    onClose={() => { setIsCreating(false); setCreateError(null); }}
                    onSubmit={(data) => createMutation.mutate(data)}
                    isPending={createMutation.isPending}
                    error={createError}
                />
            )}
        </div>
    );
}
