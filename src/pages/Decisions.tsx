import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Search, Calculator, Check, X, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReasonCode {
    feature: string;
    impact: number;
    direction: "positive" | "negative";
}

interface DecisionRecord {
    id: string;
    applicant_name: string;
    decision: "APPROVE" | "DECLINE";
    score: number;
    metric_decile: number;
    allowed_amount: number;
    approved_amount: number;
    reason_codes: ReasonCode[];
    input_payload: Record<string, any>;
    created_at: string;
    decision_system_id: string;
}

interface DecisionSystem {
    id: string;
    name: string;
}

const PAGE_SIZE = 20;

export default function Decisions() {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSystemId, setSelectedSystemId] = useState<string>("");
    const [currentPage, setCurrentPage] = useState(1);

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

    // Fetch History with pagination
    const { data: decisionsData, isLoading } = useQuery<{ decisions: DecisionRecord[]; total: number }>({
        queryKey: ["decisions", searchTerm, currentPage],
        queryFn: async () => {
            const params: any = {
                skip: (currentPage - 1) * PAGE_SIZE,
                limit: PAGE_SIZE
            };
            if (searchTerm) params.applicant_name = searchTerm;
            const res = await api.get("/decisions/", { params });
            // Backend may return array directly or with total - handle both
            const data = res.data;
            if (Array.isArray(data)) {
                return { decisions: data, total: data.length };
            }
            return { decisions: data.items || data, total: data.total || data.length };
        },
        refetchInterval: 5000
    });

    const decisions = decisionsData?.decisions;
    const totalDecisions = decisionsData?.total || 0;
    const totalPages = Math.ceil(totalDecisions / PAGE_SIZE);

    // Reset to page 1 when search changes
    const handleSearch = (term: string) => {
        setSearchTerm(term);
        setCurrentPage(1);
    };

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
                                <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                                    <div className="text-sm text-destructive">
                                        {(decisionMutation.error as any)?.response?.data?.detail
                                            || (decisionMutation.error as Error)?.message
                                            || "Failed to run decision. Please check the system has an active model and policy."}
                                    </div>
                                </div>
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

                            <div className="space-y-3 text-sm">
                                {/* Core Metrics */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/50 rounded-lg p-3">
                                        <div className="text-xs text-muted-foreground uppercase">Risk Score</div>
                                        <div className="font-mono font-bold text-lg">{(lastResult.score * 100).toFixed(1)}</div>
                                    </div>
                                    <div className="bg-white/50 rounded-lg p-3">
                                        <div className="text-xs text-muted-foreground uppercase">Risk Decile</div>
                                        <div className="font-mono font-bold text-lg">{lastResult.metric_decile || "-"}</div>
                                    </div>
                                </div>

                                {/* Amount Info (if available) */}
                                {(lastResult.allowed_amount || lastResult.approved_amount) && (
                                    <div className="border-t pt-3 mt-3">
                                        <div className="text-xs text-muted-foreground uppercase mb-2">Amount Decision</div>
                                        <div className="grid grid-cols-2 gap-3 text-xs">
                                            {lastResult.allowed_amount && (
                                                <div>
                                                    <span className="text-muted-foreground">Max Allowed:</span>
                                                    <span className="font-mono font-bold ml-2">${lastResult.allowed_amount.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {lastResult.approved_amount && (
                                                <div>
                                                    <span className="text-muted-foreground">Approved:</span>
                                                    <span className="font-mono font-bold ml-2 text-green-700">${lastResult.approved_amount.toLocaleString()}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Reason Codes */}
                                {lastResult.reason_codes && lastResult.reason_codes.length > 0 && (
                                    <div className="border-t pt-3 mt-3">
                                        <div className="text-xs text-muted-foreground uppercase mb-2">Key Factors</div>
                                        <div className="space-y-1.5">
                                            {lastResult.reason_codes.slice(0, 5).map((rc: ReasonCode, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between text-xs bg-white/50 rounded px-2 py-1.5">
                                                    <div className="flex items-center gap-2">
                                                        {rc.direction === "positive" ? (
                                                            <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                                                        ) : (
                                                            <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                                                        )}
                                                        <span className="capitalize">{rc.feature.replace(/_/g, " ")}</span>
                                                    </div>
                                                    <span className={cn(
                                                        "font-mono font-semibold",
                                                        rc.direction === "positive" ? "text-green-700" : "text-red-700"
                                                    )}>
                                                        {rc.direction === "positive" ? "+" : ""}{(rc.impact * 100).toFixed(1)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
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
                                onChange={(e) => handleSearch(e.target.value)}
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
                                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Loading decisions...</td></tr>
                                ) : decisions?.length === 0 ? (
                                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No decisions found.</td></tr>
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

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
                                <div className="text-sm text-muted-foreground">
                                    Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, totalDecisions)} of {totalDecisions} decisions
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className={cn(
                                            "inline-flex items-center justify-center h-8 w-8 rounded-md border text-sm font-medium transition-colors",
                                            currentPage === 1
                                                ? "opacity-50 cursor-not-allowed bg-muted"
                                                : "hover:bg-accent hover:text-accent-foreground"
                                        )}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <div className="flex items-center gap-1">
                                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                            let pageNum: number;
                                            if (totalPages <= 5) {
                                                pageNum = i + 1;
                                            } else if (currentPage <= 3) {
                                                pageNum = i + 1;
                                            } else if (currentPage >= totalPages - 2) {
                                                pageNum = totalPages - 4 + i;
                                            } else {
                                                pageNum = currentPage - 2 + i;
                                            }
                                            return (
                                                <button
                                                    key={pageNum}
                                                    onClick={() => setCurrentPage(pageNum)}
                                                    className={cn(
                                                        "inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium transition-colors",
                                                        currentPage === pageNum
                                                            ? "bg-primary text-primary-foreground"
                                                            : "hover:bg-accent hover:text-accent-foreground"
                                                    )}
                                                >
                                                    {pageNum}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className={cn(
                                            "inline-flex items-center justify-center h-8 w-8 rounded-md border text-sm font-medium transition-colors",
                                            currentPage === totalPages
                                                ? "opacity-50 cursor-not-allowed bg-muted"
                                                : "hover:bg-accent hover:text-accent-foreground"
                                        )}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
