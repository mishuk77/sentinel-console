import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Search, Calculator, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DecisionRecord {
    id: string;
    applicant_name: string;
    decision: "APPROVE" | "DECLINE";
    score: number;
    reason_codes: Record<string, any>;
    created_at: string;
    decision_system_id: string;
}

interface DecisionSystem {
    id: string;
    name: string;
}

export default function Decisions() {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSystemId, setSelectedSystemId] = useState<string>("");

    // Fetch Systems
    const { data: systems } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => {
            const res = await api.get("/systems/");
            return res.data;
        }
    });

    // Auto-select first system if available and none selected
    if (systems?.length && !selectedSystemId) {
        setSelectedSystemId(systems[0].id);
    }

    // Manual Entry Form
    const [form, setForm] = useState({
        applicant_name: "John Doe",
        fico: 720,
        income: 85000,
        loan_amnt: 15000
    });

    // Fetch History (Global or filtered? Global for now, but maybe filter if system selected? 
    // Let's keep it global search, but maybe allow filtering by system dropdown if user wants?
    // User requirement: "searchable across all Decision Systems".  So defaulting to all is fine.
    // I'll add an optional filter in query if I wanted, but for now just global list is fine.
    const { data: decisions, isLoading } = useQuery<DecisionRecord[]>({
        queryKey: ["decisions", searchTerm], // Include systemId if we filtered
        queryFn: async () => {
            const params: any = {};
            if (searchTerm) params.applicant_name = searchTerm;
            const res = await api.get("/decisions/", { params });
            return res.data;
        },
        refetchInterval: 5000
    });

    // Make Decision Mutation
    const decisionMutation = useMutation({
        mutationFn: async () => {
            if (!selectedSystemId) throw new Error("Please select a Decision System");

            // Structure matches DecisionRequest
            const payload = {
                applicant_name: form.applicant_name,
                applicant_ssn: "000-00-0000",
                inputs: {
                    fico: Number(form.fico),
                    income: Number(form.income),
                    loan_amnt: Number(form.loan_amnt)
                }
            };

            const res = await api.post(`/decisions/${selectedSystemId}`, payload);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["decisions"] });
        }
    });

    const lastResult = decisionMutation.data;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Decisions Engine</h1>
                <p className="text-muted-foreground mt-2">
                    Test decision logic manually or browse historical decisions.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Manual Test Form */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                            <Calculator className="h-5 w-5" /> Manual Test
                        </h3>

                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium">Decision System</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={selectedSystemId}
                                    onChange={(e) => setSelectedSystemId(e.target.value)}
                                >
                                    <option value="" disabled>Select a system...</option>
                                    {systems?.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Decision System</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={selectedSystemId}
                                    onChange={(e) => setSelectedSystemId(e.target.value)}
                                >
                                    <option value="" disabled>Select a system...</option>
                                    {systems?.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Applicant Name</label>
                                <input
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={form.applicant_name}
                                    onChange={(e) => setForm({ ...form, applicant_name: e.target.value })}
                                />
                            </div>
                            {/* ... inputs ... */}
                            {/* Shortened for brevity in tool call, but I must preserve the other inputs or this will delete them. 
                                Actually, replace_file_content replaces the block. I need to be careful. 
                                I will target the "Applicant Name" block and INSERT the System Select before it.
                            */}

                            {/* I will cancel and use a smaller replacement for just the System Select insertion */}
                            <div>
                                <label className="text-sm font-medium">FICO Score</label>
                                <input
                                    type="number"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={form.fico}
                                    onChange={(e) => setForm({ ...form, fico: Number(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Annual Income</label>
                                <input
                                    type="number"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={form.income}
                                    onChange={(e) => setForm({ ...form, income: Number(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Loan Amount</label>
                                <input
                                    type="number"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                                    value={form.loan_amnt}
                                    onChange={(e) => setForm({ ...form, loan_amnt: Number(e.target.value) })}
                                />
                            </div>

                            <button
                                onClick={() => decisionMutation.mutate()}
                                disabled={decisionMutation.isPending}
                                className="w-full bg-primary text-primary-foreground h-10 rounded-md font-medium hover:bg-primary/90 mt-4 transition-colors"
                            >
                                {decisionMutation.isPending ? "Analyzing..." : "Run Decision"}
                            </button>

                            {decisionMutation.isError && (
                                <p className="text-destructive text-sm mt-2">Error running decision.</p>
                            )}
                        </div>
                    </div>

                    {/* Last Result Card */}
                    {lastResult && (
                        <div className={cn(
                            "border rounded-xl p-6 shadow-sm animate-in fade-in slide-in-from-top-4",
                            lastResult.decision === "APPROVE" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                        )}>
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Result</span>
                                <span className={cn(
                                    "px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1",
                                    lastResult.decision === "APPROVE" ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"
                                )}>
                                    {lastResult.decision === "APPROVE" ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                    {lastResult.decision}
                                </span>
                            </div>

                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span>Risk Score:</span>
                                    <span className="font-mono font-bold">{(lastResult.score * 100).toFixed(1)}</span>
                                </div>
                                {Object.entries(lastResult.reason_codes || {}).map(([key, val]: any) => (
                                    key !== 'score' && key !== 'cutoff' && (
                                        <div key={key} className="flex justify-between text-xs text-muted-foreground">
                                            <span className="capitalize">{key.replace("_", " ")}:</span>
                                            <span>{typeof val === 'number' ? val.toFixed(2) : val}</span>
                                        </div>
                                    )
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* History Table */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                type="search"
                                placeholder="Search by name..."
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm pl-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="bg-card border rounded-xl shadow-sm overflow-hidden min-h-[500px]">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground uppercase font-medium">
                                <tr>
                                    <th className="px-6 py-3">System</th>
                                    <th className="px-6 py-3">Applicant</th>
                                    <th className="px-6 py-3">Decision</th>
                                    <th className="px-6 py-3">Score</th>
                                    <th className="px-6 py-3">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {isLoading ? (
                                    <tr><td colSpan={4} className="p-8 text-center">Loading...</td></tr>
                                ) : decisions?.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center">No decisions found.</td></tr>
                                ) : decisions?.map((d) => (
                                    <tr key={d.id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                                        <td className="px-6 py-4 text-xs font-mono text-muted-foreground">
                                            {systems?.find(s => s.id === d.decision_system_id)?.name || d.decision_system_id?.slice(0, 8) || "N/A"}
                                        </td>
                                        <td className="px-6 py-4 font-medium">{d.applicant_name || "Unknown"}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn(
                                                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                                d.decision === "APPROVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800",
                                            )}>
                                                {d.decision}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 font-mono">
                                            {(d.score * 100).toFixed(1)}
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">
                                            {new Date(d.created_at).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}
