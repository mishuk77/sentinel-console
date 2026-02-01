import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type DecisionSystem } from "@/lib/api";
import { Plus, Server, ArrowRight, Clock, Shield, Trash2, AlertCircle } from "lucide-react";
// import { cn } from "@/lib/utils";

export default function DecisionSystems() {
    const queryClient = useQueryClient();
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDesc, setNewDesc] = useState("");

    const { data: systems, isLoading, isError, error, refetch } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => {
            const res = await api.get("/systems/");
            return res.data;
        },
        retry: 1,
        retryDelay: 1000,
    });

    const [createError, setCreateError] = useState<string | null>(null);

    const createMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post("/systems/", { name: newName, description: newDesc });
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["systems"] });
            setIsCreating(false);
            setNewName("");
            setNewDesc("");
            setCreateError(null);
        },
        onError: (err) => {
            const axiosError = err as { response?: { data?: { detail?: string } }; code?: string; message?: string };
            if (axiosError?.code === "ERR_NETWORK") {
                setCreateError("Cannot connect to API server. Is the backend running?");
            } else {
                setCreateError(axiosError?.response?.data?.detail || axiosError?.message || "Failed to create system");
            }
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/systems/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["systems"] });
        },
        onError: (err) => {
            console.error(err);
            alert("Failed to delete system.");
        }
    });

    if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading systems...</div>;

    if (isError) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const axiosError = error as { response?: { status: number; data?: { detail?: string } }; code?: string };

        return (
            <div className="p-12 max-w-xl mx-auto">
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
                    <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                        Failed to Load Systems
                    </h2>
                    <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                        {axiosError?.code === "ERR_NETWORK"
                            ? "Cannot connect to the API server. Please ensure the backend is running."
                            : axiosError?.response?.data?.detail || errorMessage}
                    </p>
                    <p className="text-xs text-red-500 dark:text-red-500 mb-4 font-mono">
                        API URL: {import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}
                    </p>
                    <button
                        onClick={() => refetch()}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Decision Systems</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your decisioning contexts. Each system is an isolated workspace for data, models, and policies.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
                >
                    <Plus className="h-4 w-4" /> New System
                </button>
            </div>

            {isCreating && (
                <div className="bg-card border rounded-xl p-6 shadow-lg animate-in fade-in slide-in-from-top-4">
                    <h3 className="text-lg font-semibold mb-4">Create New Decision System</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">System Name</label>
                            <input
                                type="text"
                                className="w-full border rounded-md px-3 py-2 bg-background focus:ring-2 focus:ring-primary"
                                placeholder="e.g. Personal Loan Credit Risk"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Description</label>
                            <input
                                type="text"
                                className="w-full border rounded-md px-3 py-2 bg-background focus:ring-2 focus:ring-primary"
                                placeholder="Brief description of this decision context"
                                value={newDesc}
                                onChange={(e) => setNewDesc(e.target.value)}
                            />
                        </div>
                        {createError && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-300 text-sm">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                {createError}
                            </div>
                        )}
                        <div className="flex gap-2 justify-end pt-2">
                            <button
                                onClick={() => { setIsCreating(false); setCreateError(null); }}
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => createMutation.mutate()}
                                disabled={!newName || createMutation.isPending}
                                className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
                            >
                                {createMutation.isPending ? "Creating..." : "Create System"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {systems?.map((sys) => (
                    <Link
                        key={sys.id}
                        to={`/systems/${sys.id}/overview`}
                        className="group bg-card border rounded-xl p-6 hover:shadow-md transition-all hover:border-primary/50 relative overflow-hidden"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                                <Server className="h-6 w-6" />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={(e) => {
                                        e.preventDefault(); // Prevent navigation
                                        if (window.confirm(`Are you sure you want to delete system "${sys.name}"? This will delete ALL associated data, models, and policies.`)) {
                                            deleteMutation.mutate(sys.id);
                                        }
                                    }}
                                    className="p-1 text-muted-foreground hover:text-red-600 transition-colors z-20 relative"
                                    title="Delete System"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
                            </div>
                        </div>

                        <h3 className="font-semibold text-xl mb-2 group-hover:text-primary transition-colors">{sys.name}</h3>
                        <p className="text-sm text-muted-foreground mb-6 line-clamp-2 min-h-[40px]">
                            {sys.description || "No description provided."}
                        </p>

                        <div className="flex flex-col gap-2 text-xs text-muted-foreground border-t pt-4">
                            <div className="flex items-center gap-2">
                                <Clock className="h-3 w-3" />
                                <span>Created: {new Date(sys.created_at).toLocaleDateString()}</span>
                            </div>
                            {/* In real app, check active model status */}
                            <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-green-600" />
                                <span>Active Model: <span className="text-foreground font-medium">Coming Soon</span></span>
                            </div>
                        </div>
                    </Link>
                ))}

                {(!systems || systems.length === 0) && !isCreating && (
                    <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
                        No decision systems found. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    );
}
