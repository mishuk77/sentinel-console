import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Search, ChevronLeft, ChevronRight, FileText, Eye, X, Check, ArrowUpDown, ArrowUp, ArrowDown, ShieldAlert, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface DecisionRecord {
    id: string;
    applicant_name: string;
    decision: "APPROVE" | "DECLINE";
    score: number;
    metric_decile: number | null;
    allowed_amount: number | null;
    approved_amount: number | null;
    reason_codes: any;
    input_payload: Record<string, any>;
    timestamp: string;
    decision_system_id: string;
    model_version_id: string | null;
    policy_version_id: string | null;
    fraud_score: number | null;
    fraud_tier: string | null;
    fraud_action: string | null;
    fraud_model_id: string | null;
    adverse_action_factors: any[] | null;
}

interface DecisionSystem {
    id: string;
    name: string;
}

type SortField = "timestamp" | "applicant_name" | "decision" | "score" | "approved_amount" | "fraud_score" | "fraud_tier" | "metric_decile";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

const FRAUD_TIER_COLORS: Record<string, string> = {
    LOW: "badge-green",
    MEDIUM: "badge-amber",
    HIGH: "badge-red",
    CRITICAL: "badge-red",
};

function formatDateTime(ts: string | null | undefined): { date: string; time: string } {
    if (!ts) return { date: "—", time: "" };
    const d = new Date(ts);
    if (isNaN(d.getTime())) return { date: "—", time: "" };
    return {
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
}

export default function Decisions() {
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedDecision, setSelectedDecision] = useState<DecisionRecord | null>(null);
    const [sortField, setSortField] = useState<SortField>("timestamp");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    // Fetch Systems for name lookup
    const { data: systems } = useQuery<DecisionSystem[]>({
        queryKey: ["systems"],
        queryFn: async () => {
            const res = await api.get("/systems/");
            return res.data;
        }
    });

    // Fetch all decisions (let backend paginate later if needed)
    const { data: rawDecisions, isLoading } = useQuery<DecisionRecord[]>({
        queryKey: ["decisions", searchTerm],
        queryFn: async () => {
            const params: any = { skip: 0, limit: 200 };
            if (searchTerm) params.applicant_name = searchTerm;
            const res = await api.get("/decisions/", { params });
            return Array.isArray(res.data) ? res.data : res.data.items || res.data;
        },
        refetchInterval: 5000
    });

    // Sort client-side
    const decisions = useMemo(() => {
        if (!rawDecisions) return [];
        const sorted = [...rawDecisions].sort((a, b) => {
            let aVal: any = a[sortField];
            let bVal: any = b[sortField];

            // Handle nulls
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            if (sortField === "timestamp") {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }
            if (typeof aVal === "string") {
                aVal = aVal.toLowerCase();
                bVal = (bVal as string).toLowerCase();
            }

            if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
            if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [rawDecisions, sortField, sortDir]);

    // Paginate
    const totalDecisions = decisions.length;
    const totalPages = Math.max(1, Math.ceil(totalDecisions / PAGE_SIZE));
    const pagedDecisions = decisions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const handleSearch = (term: string) => {
        setSearchTerm(term);
        setCurrentPage(1);
    };

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDir(field === "timestamp" ? "desc" : "asc");
        }
    };

    const systemName = (id: string) => systems?.find(s => s.id === id)?.name || id?.slice(0, 8);

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title">Decision Ledger</h1>
                <p className="page-desc">Full audit trail of every decision processed through the pipeline.</p>
            </div>

            {/* Search + count */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="Search by applicant name…"
                        className="field-input pl-8"
                        value={searchTerm}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                </div>
                <span className="text-xs text-muted-foreground">
                    {totalDecisions} decision{totalDecisions !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Table */}
            <div className="panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="dt dt-hover w-full">
                        <thead>
                            <tr>
                                <Th field="timestamp" label="Date / Time" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <th className="text-xs">System</th>
                                <Th field="applicant_name" label="Applicant" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="decision" label="Decision" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="score" label="Credit Score" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="metric_decile" label="Decile" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="approved_amount" label="Approved Amt" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="fraud_score" label="Fraud Score" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <Th field="fraud_tier" label="Fraud Tier" sortField={sortField} sortDir={sortDir} toggle={toggleSort} />
                                <th className="text-xs">Fraud CTA</th>
                                <th className="text-xs w-8"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground text-xs">Loading decisions…</td></tr>
                            ) : pagedDecisions.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="p-12 text-center">
                                        <div className="icon-box bg-muted/40 mx-auto mb-3">
                                            <FileText className="h-5 w-5 text-muted-foreground/50" />
                                        </div>
                                        <p className="text-sm font-semibold mb-1">No decisions yet</p>
                                        <p className="text-xs text-muted-foreground">
                                            Run a decision from the Integration sandbox or via API.
                                        </p>
                                    </td>
                                </tr>
                            ) : pagedDecisions.map((d) => {
                                const dt = formatDateTime(d.timestamp);
                                return (
                                    <tr key={d.id} className="cursor-pointer group" onClick={() => setSelectedDecision(d)}>
                                        <td>
                                            <div className="text-xs">{dt.date}</div>
                                            <div className="text-[10px] text-muted-foreground">{dt.time}</div>
                                        </td>
                                        <td className="font-mono text-2xs text-muted-foreground max-w-[100px] truncate">
                                            {systemName(d.decision_system_id)}
                                        </td>
                                        <td className="font-medium text-xs">{d.applicant_name || "—"}</td>
                                        <td>
                                            <span className={d.decision === "APPROVE" ? "badge badge-green" : "badge badge-red"}>
                                                {d.decision}
                                            </span>
                                        </td>
                                        <td className="font-mono text-xs num">{d.score != null ? (d.score * 100).toFixed(1) : "—"}</td>
                                        <td className="font-mono text-xs text-center">{d.metric_decile ?? "—"}</td>
                                        <td className="font-mono text-xs num">
                                            {d.approved_amount != null ? `$${d.approved_amount.toLocaleString()}` : "—"}
                                        </td>
                                        <td className="font-mono text-xs num">
                                            {d.fraud_score != null ? (d.fraud_score * 100).toFixed(1) : "—"}
                                        </td>
                                        <td>
                                            {d.fraud_tier ? (
                                                <span className={cn("badge", FRAUD_TIER_COLORS[d.fraud_tier] || "badge-muted")}>
                                                    {d.fraud_tier}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="text-2xs text-muted-foreground">{d.fraud_action || "—"}</td>
                                        <td>
                                            <Eye className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
                        <div className="text-xs text-muted-foreground">
                            {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalDecisions)} of {totalDecisions}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className={cn("h-7 w-7 flex items-center justify-center rounded border text-xs",
                                    currentPage === 1 ? "opacity-40 cursor-not-allowed" : "hover:bg-accent")}
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum: number;
                                if (totalPages <= 5) pageNum = i + 1;
                                else if (currentPage <= 3) pageNum = i + 1;
                                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                                else pageNum = currentPage - 2 + i;
                                return (
                                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)}
                                        className={cn("h-7 w-7 flex items-center justify-center rounded text-xs",
                                            currentPage === pageNum ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                                        )}>
                                        {pageNum}
                                    </button>
                                );
                            })}
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className={cn("h-7 w-7 flex items-center justify-center rounded border text-xs",
                                    currentPage === totalPages ? "opacity-40 cursor-not-allowed" : "hover:bg-accent")}
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedDecision && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                    onClick={() => setSelectedDecision(null)}>
                    <div className="panel w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200 shadow-2xl thin-scroll"
                        onClick={e => e.stopPropagation()}>

                        {/* Header */}
                        <div className="panel-head">
                            <div className="flex items-center gap-3">
                                <div className={cn("icon-box",
                                    selectedDecision.decision === "APPROVE" ? "bg-up/10" : "bg-down/10")}>
                                    {selectedDecision.decision === "APPROVE"
                                        ? <Check className="h-4 w-4 text-up" />
                                        : <X className="h-4 w-4 text-down" />}
                                </div>
                                <div>
                                    <p className="panel-title">Decision Detail</p>
                                    <p className="text-xs text-muted-foreground">{selectedDecision.applicant_name || "Unknown"}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedDecision(null)} className="p-1.5 hover:bg-accent rounded">
                                <X className="h-4 w-4 text-muted-foreground" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Credit Assessment */}
                            <div className="panel p-4">
                                <p className="panel-title flex items-center gap-1.5 mb-3">
                                    <CreditCard className="h-3.5 w-3.5 text-info" /> Credit Risk Assessment
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div className="kpi text-center">
                                        <p className="kpi-label">Decision</p>
                                        <span className={selectedDecision.decision === "APPROVE" ? "badge badge-green" : "badge badge-red"}>
                                            {selectedDecision.decision}
                                        </span>
                                    </div>
                                    <div className="kpi text-center">
                                        <p className="kpi-label">PD Score</p>
                                        <p className="kpi-value font-mono">{(selectedDecision.score * 100).toFixed(2)}%</p>
                                    </div>
                                    <div className="kpi text-center">
                                        <p className="kpi-label">Risk Decile</p>
                                        <p className="kpi-value font-mono">{selectedDecision.metric_decile ?? "—"}</p>
                                    </div>
                                    <div className="kpi text-center">
                                        <p className="kpi-label">Max Allowed</p>
                                        <p className="kpi-value font-mono">{selectedDecision.allowed_amount != null ? `$${selectedDecision.allowed_amount.toLocaleString()}` : "—"}</p>
                                    </div>
                                    <div className="kpi text-center">
                                        <p className="kpi-label">Approved</p>
                                        <p className="kpi-value font-mono text-up">{selectedDecision.approved_amount != null ? `$${selectedDecision.approved_amount.toLocaleString()}` : "—"}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Fraud Assessment */}
                            <div className="panel p-4">
                                <p className="panel-title flex items-center gap-1.5 mb-3">
                                    <ShieldAlert className="h-3.5 w-3.5 text-down" /> Fraud Risk Assessment
                                </p>
                                {selectedDecision.fraud_score != null ? (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="kpi text-center">
                                            <p className="kpi-label">Fraud Probability</p>
                                            <p className="kpi-value font-mono">{(selectedDecision.fraud_score * 100).toFixed(2)}%</p>
                                        </div>
                                        <div className="kpi text-center">
                                            <p className="kpi-label">Risk Tier</p>
                                            <span className={cn("badge", FRAUD_TIER_COLORS[selectedDecision.fraud_tier || ""] || "badge-muted")}>
                                                {selectedDecision.fraud_tier || "—"}
                                            </span>
                                        </div>
                                        <div className="kpi text-center">
                                            <p className="kpi-label">Recommended Action</p>
                                            <p className="text-xs font-semibold mt-1">{selectedDecision.fraud_action || "—"}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">No fraud model was active when this decision was made.</p>
                                )}
                            </div>

                            {/* Adverse Action Factors */}
                            {selectedDecision.adverse_action_factors && selectedDecision.adverse_action_factors.length > 0 && (
                                <div className="panel p-4">
                                    <p className="panel-title mb-3">Adverse Action Factors (SHAP)</p>
                                    <div className="space-y-1.5">
                                        {selectedDecision.adverse_action_factors.map((f: any, i: number) => (
                                            <div key={i} className="flex items-center justify-between px-3 py-2 rounded bg-muted/20">
                                                <span className="text-xs font-medium capitalize">{(f.factor || "").replace(/_/g, " ")}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("text-2xs px-1.5 py-0.5 rounded",
                                                        f.direction === "risk_increasing" ? "bg-down/10 text-down" : "bg-up/10 text-up"
                                                    )}>
                                                        {f.direction === "risk_increasing" ? "Risk +" : "Risk -"}
                                                    </span>
                                                    <span className="font-mono text-xs">{(f.impact * 100).toFixed(2)}%</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-2">Methodology: SHAP · Regulatory: ECOA / FCRA Reg B</p>
                                </div>
                            )}

                            {/* Pipeline Metadata */}
                            <div className="panel overflow-hidden">
                                <div className="panel-head"><span className="panel-title">Pipeline Metadata</span></div>
                                <table className="dt w-full text-xs">
                                    <tbody>
                                        <tr>
                                            <td className="text-muted-foreground">System</td>
                                            <td className="font-mono text-right">{systemName(selectedDecision.decision_system_id)}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground">Credit Model</td>
                                            <td className="font-mono text-right text-2xs">{selectedDecision.model_version_id || "—"}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground">Fraud Model</td>
                                            <td className="font-mono text-right text-2xs">{selectedDecision.fraud_model_id || "—"}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground">Policy</td>
                                            <td className="font-mono text-right text-2xs">{selectedDecision.policy_version_id || "—"}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground">Inquiry ID</td>
                                            <td className="font-mono text-right text-2xs">{selectedDecision.id}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-muted-foreground">Timestamp</td>
                                            <td className="font-mono text-right">{(() => { const dt = formatDateTime(selectedDecision.timestamp); return `${dt.date} ${dt.time}`; })()}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Input Payload (collapsed) */}
                            {selectedDecision.input_payload && Object.keys(selectedDecision.input_payload).length > 0 && (
                                <details className="panel overflow-hidden">
                                    <summary className="panel-head cursor-pointer select-none">
                                        <span className="panel-title">Input Payload</span>
                                    </summary>
                                    <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-300 overflow-x-auto">
                                        {JSON.stringify(selectedDecision.input_payload, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>

                        <div className="px-5 py-3 border-t bg-muted/20 flex justify-end">
                            <button onClick={() => setSelectedDecision(null)} className="btn-primary btn-sm">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Sortable table header component
function Th({ field, label, sortField, sortDir, toggle }: {
    field: SortField; label: string;
    sortField: SortField; sortDir: SortDir;
    toggle: (f: SortField) => void;
}) {
    return (
        <th className="text-xs">
            <button
                onClick={() => toggle(field)}
                className="flex items-center gap-1 hover:text-foreground transition-colors w-full"
            >
                {label}
                {sortField === field
                    ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)
                    : <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />}
            </button>
        </th>
    );
}
