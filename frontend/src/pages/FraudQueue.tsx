import { useState, useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { getFraudCases } from "@/lib/fraudData";
import type { FraudRiskLevel, FraudCaseStatus } from "@/lib/api";
import {
    Search,
    Filter,
    Clock,
    AlertTriangle,
    User,
    ChevronRight,
    ArrowUpDown,
    RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";

const QUEUE_STYLES: Record<FraudRiskLevel, { bg: string; text: string; border: string }> = {
    critical: { bg: "bg-down/10", text: "text-down", border: "border-down/30" },
    high: { bg: "bg-warn/10", text: "text-warn", border: "border-warn/30" },
    medium: { bg: "bg-warn/10", text: "text-warn", border: "border-warn/20" },
    low: { bg: "bg-up/10", text: "text-up", border: "border-up/30" },
};

const STATUS_STYLES: Record<FraudCaseStatus, { bg: string; text: string }> = {
    pending: { bg: "badge-muted", text: "" },
    in_review: { bg: "badge-blue", text: "" },
    escalated: { bg: "badge-muted", text: "" },
    resolved: { bg: "badge-green", text: "" },
};

function formatTimeRemaining(deadline: string): { text: string; urgency: "ok" | "warning" | "critical" } {
    const now = new Date();
    const sla = new Date(deadline);
    const diffMs = sla.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) {
        return { text: "OVERDUE", urgency: "critical" };
    }
    if (diffMins < 15) {
        return { text: `${diffMins}m left`, urgency: "critical" };
    }
    if (diffMins < 60) {
        return { text: `${diffMins}m left`, urgency: "warning" };
    }
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) {
        return { text: `${hours}h left`, urgency: "ok" };
    }
    return { text: `${Math.floor(hours / 24)}d left`, urgency: "ok" };
}

type SortField = "score" | "created_at" | "sla_deadline";
type SortDirection = "asc" | "desc";

export default function FraudQueue() {
    const { systemId } = useParams<{ systemId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const [searchTerm, setSearchTerm] = useState("");
    const [queueFilter, setQueueFilter] = useState<FraudRiskLevel | "all">(
        (searchParams.get("queue") as FraudRiskLevel) || "all"
    );
    const [statusFilter, setStatusFilter] = useState<FraudCaseStatus | "all">("all");
    const [sortField, setSortField] = useState<SortField>("sla_deadline");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

    const allCases = useMemo(() => getFraudCases(systemId || ""), [systemId]);

    const filteredCases = useMemo(() => {
        let result = [...allCases];

        // Filter out resolved cases by default (show in separate tab/view)
        if (statusFilter === "all") {
            result = result.filter(c => c.status !== "resolved");
        }

        // Apply queue filter
        if (queueFilter !== "all") {
            result = result.filter(c => c.queue === queueFilter);
        }

        // Apply status filter
        if (statusFilter !== "all") {
            result = result.filter(c => c.status === statusFilter);
        }

        // Apply search
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            result = result.filter(c =>
                c.applicant_name.toLowerCase().includes(term) ||
                c.application_id.toLowerCase().includes(term) ||
                c.applicant_email.toLowerCase().includes(term)
            );
        }

        // Apply sorting
        result.sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case "score":
                    comparison = a.fraud_score.score - b.fraud_score.score;
                    break;
                case "created_at":
                    comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    break;
                case "sla_deadline":
                    comparison = new Date(a.sla_deadline).getTime() - new Date(b.sla_deadline).getTime();
                    break;
            }
            return sortDirection === "asc" ? comparison : -comparison;
        });

        return result;
    }, [allCases, queueFilter, statusFilter, searchTerm, sortField, sortDirection]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(d => d === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("asc");
        }
    };

    const queueCounts = useMemo(() => ({
        all: allCases.filter(c => c.status !== "resolved").length,
        critical: allCases.filter(c => c.queue === "critical" && c.status !== "resolved").length,
        high: allCases.filter(c => c.queue === "high" && c.status !== "resolved").length,
        medium: allCases.filter(c => c.queue === "medium" && c.status !== "resolved").length,
        low: allCases.filter(c => c.queue === "low" && c.status !== "resolved").length,
    }), [allCases]);

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title">Case Queue</h1>
                <p className="page-desc">
                    Review and process fraud cases by risk level priority.
                </p>
            </div>

            {/* Queue Tabs */}
            <div className="flex gap-2 border-b pb-2 overflow-x-auto">
                {(["all", "critical", "high", "medium", "low"] as const).map(level => (
                    <button
                        key={level}
                        onClick={() => {
                            setQueueFilter(level);
                            if (level !== "all") {
                                setSearchParams({ queue: level });
                            } else {
                                setSearchParams({});
                            }
                        }}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
                            queueFilter === level
                                ? level === "all"
                                    ? "bg-primary text-primary-foreground"
                                    : `${QUEUE_STYLES[level].bg} ${QUEUE_STYLES[level].text}`
                                : "text-muted-foreground hover:bg-muted"
                        )}
                    >
                        {level === "all" ? "All Cases" : level.charAt(0).toUpperCase() + level.slice(1)}
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-background/50 rounded">
                            {queueCounts[level]}
                        </span>
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by name, application ID, or email..."
                        className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-background text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <select
                        className="h-10 px-3 rounded-lg border border-input bg-background text-sm"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as FraudCaseStatus | "all")}
                    >
                        <option value="all">Active Cases</option>
                        <option value="pending">Pending</option>
                        <option value="in_review">In Review</option>
                        <option value="escalated">Escalated</option>
                        <option value="resolved">Resolved</option>
                    </select>
                </div>

                <button
                    onClick={() => getFraudCases(systemId || "", true)}
                    className="h-10 px-3 rounded-lg border border-input bg-background text-sm flex items-center gap-2 hover:bg-muted transition-colors"
                >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                </button>
            </div>

            {/* Results count */}
            <p className="text-sm text-muted-foreground">
                Showing {filteredCases.length} cases
            </p>

            {/* Cases Table */}
            <div className="panel overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="dt dt-hover">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="h-12 px-4 text-left font-medium text-muted-foreground">
                                    Applicant
                                </th>
                                <th className="h-12 px-4 text-left font-medium text-muted-foreground">
                                    Application
                                </th>
                                <th
                                    className="h-12 px-4 text-center font-medium text-muted-foreground cursor-pointer hover:bg-muted/70"
                                    onClick={() => toggleSort("score")}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        Score
                                        <ArrowUpDown className="h-3 w-3" />
                                    </div>
                                </th>
                                <th className="h-12 px-4 text-center font-medium text-muted-foreground">
                                    Queue
                                </th>
                                <th className="h-12 px-4 text-center font-medium text-muted-foreground">
                                    Status
                                </th>
                                <th
                                    className="h-12 px-4 text-center font-medium text-muted-foreground cursor-pointer hover:bg-muted/70"
                                    onClick={() => toggleSort("sla_deadline")}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        SLA
                                        <ArrowUpDown className="h-3 w-3" />
                                    </div>
                                </th>
                                <th className="h-12 px-4 text-center font-medium text-muted-foreground">
                                    Assigned
                                </th>
                                <th className="h-12 px-4"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCases.map((caseItem) => {
                                const slaStatus = formatTimeRemaining(caseItem.sla_deadline);
                                const queueStyle = QUEUE_STYLES[caseItem.queue];
                                const statusStyle = STATUS_STYLES[caseItem.status];

                                return (
                                    <tr
                                        key={caseItem.id}
                                        className={cn(
                                            "border-b last:border-0 hover:bg-muted/30 transition-colors",
                                            caseItem.queue === "critical" && caseItem.status !== "resolved" && "bg-down/5"
                                        )}
                                    >
                                        <td className="px-4 py-3">
                                            <div>
                                                <p className="font-medium">{caseItem.applicant_name}</p>
                                                <p className="text-xs text-muted-foreground">{caseItem.applicant_email}</p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <code className="text-xs bg-muted px-2 py-1 rounded">
                                                {caseItem.application_id}
                                            </code>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                ${caseItem.amount_requested.toLocaleString()}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={cn(
                                                "inline-block px-3 py-1 rounded-full font-bold text-sm",
                                                caseItem.fraud_score.score >= 800 ? "badge badge-red" :
                                                    caseItem.fraud_score.score >= 600 ? "badge badge-amber" :
                                                        caseItem.fraud_score.score >= 400 ? "badge badge-amber" :
                                                            "badge badge-green"
                                            )}>
                                                {caseItem.fraud_score.score}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={cn(
                                                "badge uppercase",
                                                queueStyle.bg, queueStyle.text
                                            )}>
                                                {caseItem.queue}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={cn(
                                                "badge capitalize",
                                                statusStyle.bg
                                            )}>
                                                {caseItem.status.replace("_", " ")}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {caseItem.status !== "resolved" ? (
                                                <div className={cn(
                                                    "flex items-center justify-center gap-1 text-xs font-medium",
                                                    slaStatus.urgency === "critical" ? "text-down" :
                                                        slaStatus.urgency === "warning" ? "text-warn" :
                                                            "text-up"
                                                )}>
                                                    {slaStatus.urgency === "critical" && (
                                                        <AlertTriangle className="h-3 w-3" />
                                                    )}
                                                    {slaStatus.urgency !== "critical" && (
                                                        <Clock className="h-3 w-3" />
                                                    )}
                                                    {slaStatus.text}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {caseItem.assigned_to ? (
                                                <div className="flex items-center justify-center gap-1 text-xs">
                                                    <User className="h-3 w-3 text-muted-foreground" />
                                                    <span>{caseItem.assigned_to.replace("_", " ")}</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Unassigned</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Link
                                                to={`/systems/${systemId}/fraud/cases/${caseItem.id}`}
                                                className="inline-flex items-center gap-1 text-primary hover:underline text-sm font-medium"
                                            >
                                                Review <ChevronRight className="h-4 w-4" />
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredCases.length === 0 && (
                    <div className="p-12 text-center text-muted-foreground">
                        <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p className="font-medium">No cases found</p>
                        <p className="text-sm mt-1">Try adjusting your filters or search term.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
