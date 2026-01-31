import { useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getFraudCase, updateFraudCase } from "@/lib/fraudData";
import type { FraudSignalType } from "@/lib/api";
import {
    ArrowLeft,
    ShieldAlert,
    Clock,
    User,
    Mail,
    DollarSign,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ArrowUpRight,
    Smartphone,
    Zap,
    UserX,
    MousePointer,
    Send,
    Phone,
    FileText,
    KeyRound
} from "lucide-react";
import { cn } from "@/lib/utils";

const SIGNAL_TYPE_CONFIG: Record<FraudSignalType, { icon: typeof Smartphone; color: string; label: string }> = {
    device: { icon: Smartphone, color: "text-blue-600 bg-blue-100", label: "Device" },
    velocity: { icon: Zap, color: "text-purple-600 bg-purple-100", label: "Velocity" },
    identity: { icon: UserX, color: "text-red-600 bg-red-100", label: "Identity" },
    behavioral: { icon: MousePointer, color: "text-orange-600 bg-orange-100", label: "Behavioral" },
};

export default function FraudCaseDetail() {
    const { systemId, caseId } = useParams<{ systemId: string; caseId: string }>();
    const navigate = useNavigate();

    const [isProcessing, setIsProcessing] = useState(false);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [notes, setNotes] = useState("");

    const fraudCase = useMemo(() => {
        if (!caseId || !systemId) return null;
        return getFraudCase(caseId, systemId);
    }, [caseId, systemId]);

    if (!fraudCase) {
        return (
            <div className="p-8 max-w-4xl mx-auto">
                <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
                    <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-red-900 mb-2">Case Not Found</h2>
                    <p className="text-red-700 mb-4">The requested fraud case could not be found.</p>
                    <Link
                        to={`/systems/${systemId}/fraud/queue`}
                        className="inline-flex items-center gap-2 text-red-700 hover:underline"
                    >
                        <ArrowLeft className="h-4 w-4" /> Back to Queue
                    </Link>
                </div>
            </div>
        );
    }

    const handleAction = async (action: "approve" | "decline" | "escalate") => {
        setIsProcessing(true);
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));

        updateFraudCase(fraudCase.id, {
            status: action === "escalate" ? "escalated" : "resolved",
            outcome: action === "escalate" ? "escalated" : action === "approve" ? "approved" : "declined",
            resolved_at: new Date().toISOString(),
            resolution_notes: notes || `Case ${action}d by analyst.`,
            assigned_to: "analyst_1",
        });

        setIsProcessing(false);
        setActionSuccess(action);

        // Navigate back to queue after brief delay
        setTimeout(() => {
            navigate(`/systems/${systemId}/fraud/queue`);
        }, 1500);
    };

    const handleVerification = (type: "otp" | "kba" | "document" | "call") => {
        // In production, this would initiate a verification request
        alert(`Verification request (${type}) would be sent to ${fraudCase.applicant_email}`);
    };

    const score = fraudCase.fraud_score;
    const isResolved = fraudCase.status === "resolved";

    // Calculate SLA status
    const slaDeadline = new Date(fraudCase.sla_deadline);
    const now = new Date();
    const slaRemaining = slaDeadline.getTime() - now.getTime();
    const slaOverdue = slaRemaining < 0;
    const slaCritical = slaRemaining < 900000; // 15 minutes

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            {/* Back Link */}
            <Link
                to={`/systems/${systemId}/fraud/queue`}
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to Queue
            </Link>

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-foreground">
                            {fraudCase.applicant_name}
                        </h1>
                        <span className={cn(
                            "px-2 py-1 rounded text-xs font-bold uppercase",
                            fraudCase.queue === "critical" ? "bg-red-100 text-red-800" :
                                fraudCase.queue === "high" ? "bg-orange-100 text-orange-800" :
                                    fraudCase.queue === "medium" ? "bg-yellow-100 text-yellow-800" :
                                        "bg-green-100 text-green-800"
                        )}>
                            {fraudCase.queue} risk
                        </span>
                        <span className={cn(
                            "px-2 py-1 rounded text-xs font-medium capitalize",
                            fraudCase.status === "resolved" ? "bg-green-100 text-green-700" :
                                fraudCase.status === "in_review" ? "bg-blue-100 text-blue-700" :
                                    fraudCase.status === "escalated" ? "bg-purple-100 text-purple-700" :
                                        "bg-gray-100 text-gray-700"
                        )}>
                            {fraudCase.status.replace("_", " ")}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Mail className="h-4 w-4" />
                            {fraudCase.applicant_email}
                        </span>
                        <span className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4" />
                            ${fraudCase.amount_requested.toLocaleString()} requested
                        </span>
                        <code className="bg-muted px-2 py-1 rounded text-xs">
                            {fraudCase.application_id}
                        </code>
                    </div>
                </div>

                {/* SLA Countdown */}
                {!isResolved && (
                    <div className={cn(
                        "px-4 py-3 rounded-lg border",
                        slaOverdue ? "bg-red-50 border-red-200" :
                            slaCritical ? "bg-yellow-50 border-yellow-200" :
                                "bg-green-50 border-green-200"
                    )}>
                        <div className="flex items-center gap-2">
                            <Clock className={cn(
                                "h-5 w-5",
                                slaOverdue ? "text-red-600" :
                                    slaCritical ? "text-yellow-600" : "text-green-600"
                            )} />
                            <div>
                                <p className={cn(
                                    "font-bold",
                                    slaOverdue ? "text-red-700" :
                                        slaCritical ? "text-yellow-700" : "text-green-700"
                                )}>
                                    {slaOverdue ? "SLA OVERDUE" :
                                        slaCritical ? "SLA Critical" : "SLA On Track"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Deadline: {slaDeadline.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Score & Signals */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Fraud Score Gauge */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5 text-orange-500" />
                            Fraud Score
                        </h3>

                        <div className="flex items-center gap-8">
                            {/* Score Circle */}
                            <div className="relative">
                                <svg className="w-32 h-32 -rotate-90">
                                    <circle
                                        cx="64"
                                        cy="64"
                                        r="56"
                                        stroke="currentColor"
                                        strokeWidth="12"
                                        fill="none"
                                        className="text-muted/30"
                                    />
                                    <circle
                                        cx="64"
                                        cy="64"
                                        r="56"
                                        stroke="currentColor"
                                        strokeWidth="12"
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(score.score / 1000) * 352} 352`}
                                        className={cn(
                                            score.score >= 800 ? "text-red-500" :
                                                score.score >= 600 ? "text-orange-500" :
                                                    score.score >= 400 ? "text-yellow-500" :
                                                        "text-green-500"
                                        )}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-center">
                                        <span className={cn(
                                            "text-3xl font-bold",
                                            score.score >= 800 ? "text-red-600" :
                                                score.score >= 600 ? "text-orange-600" :
                                                    score.score >= 400 ? "text-yellow-600" :
                                                        "text-green-600"
                                        )}>
                                            {score.score}
                                        </span>
                                        <p className="text-xs text-muted-foreground">/1000</p>
                                    </div>
                                </div>
                            </div>

                            {/* Score Breakdown */}
                            <div className="flex-1">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Low Risk</span>
                                        <span className="text-muted-foreground">0-399</span>
                                    </div>
                                    <div className="h-2 bg-green-200 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>Medium Risk</span>
                                        <span className="text-muted-foreground">400-599</span>
                                    </div>
                                    <div className="h-2 bg-yellow-200 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>High Risk</span>
                                        <span className="text-muted-foreground">600-799</span>
                                    </div>
                                    <div className="h-2 bg-orange-200 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>Critical Risk</span>
                                        <span className="text-muted-foreground">800+</span>
                                    </div>
                                    <div className="h-2 bg-red-200 rounded-full" />
                                </div>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-4">
                            Model: <code>{score.model_version}</code> | Scored: {new Date(score.scored_at).toLocaleString()}
                        </p>
                    </div>

                    {/* Risk Signals */}
                    <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b">
                            <h3 className="font-semibold">Contributing Signals</h3>
                            <p className="text-sm text-muted-foreground">
                                Top factors that contributed to this fraud score
                            </p>
                        </div>
                        <div className="divide-y">
                            {score.reason_codes.map((signal) => {
                                const config = SIGNAL_TYPE_CONFIG[signal.signal_type];
                                const Icon = config.icon;

                                return (
                                    <div key={signal.id} className="px-6 py-4 hover:bg-muted/30 transition-colors">
                                        <div className="flex items-start gap-4">
                                            <div className={cn("p-2 rounded-lg", config.color)}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <code className="text-sm font-medium">
                                                            {signal.signal_name}
                                                        </code>
                                                        <span className={cn(
                                                            "ml-2 px-1.5 py-0.5 rounded text-xs font-medium",
                                                            config.color
                                                        )}>
                                                            {config.label}
                                                        </span>
                                                    </div>
                                                    <span className={cn(
                                                        "text-sm font-bold px-2 py-1 rounded",
                                                        signal.risk_contribution > 60 ? "bg-red-100 text-red-700" :
                                                            signal.risk_contribution > 40 ? "bg-orange-100 text-orange-700" :
                                                                "bg-yellow-100 text-yellow-700"
                                                    )}>
                                                        +{signal.risk_contribution}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {signal.description}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column - Actions */}
                <div className="space-y-6">
                    {/* Quick Actions */}
                    {!isResolved && !actionSuccess && (
                        <div className="bg-card border rounded-xl p-6 shadow-sm">
                            <h3 className="font-semibold mb-4">Decision</h3>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handleAction("approve")}
                                    disabled={isProcessing}
                                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                    <CheckCircle2 className="h-5 w-5" />
                                    Approve Application
                                </button>

                                <button
                                    onClick={() => handleAction("decline")}
                                    disabled={isProcessing}
                                    className="w-full flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    <XCircle className="h-5 w-5" />
                                    Decline Application
                                </button>

                                <button
                                    onClick={() => handleAction("escalate")}
                                    disabled={isProcessing}
                                    className="w-full flex items-center justify-center gap-2 border border-purple-300 text-purple-700 px-4 py-3 rounded-lg font-medium hover:bg-purple-50 transition-colors disabled:opacity-50"
                                >
                                    <ArrowUpRight className="h-5 w-5" />
                                    Escalate to Senior
                                </button>
                            </div>

                            <div className="mt-4">
                                <label className="text-sm font-medium block mb-2">
                                    Resolution Notes (optional)
                                </label>
                                <textarea
                                    className="w-full h-24 px-3 py-2 border rounded-lg text-sm resize-none"
                                    placeholder="Add notes about your decision..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </div>
                        </div>
                    )}

                    {/* Success Message */}
                    {actionSuccess && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
                            <p className="font-bold text-green-900">
                                Case {actionSuccess === "escalate" ? "Escalated" : actionSuccess === "approve" ? "Approved" : "Declined"}
                            </p>
                            <p className="text-sm text-green-700 mt-1">
                                Redirecting to queue...
                            </p>
                        </div>
                    )}

                    {/* Resolved Status */}
                    {isResolved && !actionSuccess && (
                        <div className={cn(
                            "border rounded-xl p-6",
                            fraudCase.outcome === "approved" ? "bg-green-50 border-green-200" :
                                fraudCase.outcome === "declined" ? "bg-red-50 border-red-200" :
                                    "bg-purple-50 border-purple-200"
                        )}>
                            <div className="flex items-center gap-3 mb-3">
                                {fraudCase.outcome === "approved" ? (
                                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                                ) : fraudCase.outcome === "declined" ? (
                                    <XCircle className="h-6 w-6 text-red-600" />
                                ) : (
                                    <ArrowUpRight className="h-6 w-6 text-purple-600" />
                                )}
                                <span className={cn(
                                    "font-bold capitalize",
                                    fraudCase.outcome === "approved" ? "text-green-900" :
                                        fraudCase.outcome === "declined" ? "text-red-900" :
                                            "text-purple-900"
                                )}>
                                    {fraudCase.outcome}
                                </span>
                            </div>
                            {fraudCase.resolution_notes && (
                                <p className="text-sm text-muted-foreground mb-2">
                                    {fraudCase.resolution_notes}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Resolved: {new Date(fraudCase.resolved_at!).toLocaleString()}
                            </p>
                            {fraudCase.assigned_to && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                    <User className="h-3 w-3" />
                                    {fraudCase.assigned_to.replace("_", " ")}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Step-up Verification */}
                    {!isResolved && (
                        <div className="bg-card border rounded-xl p-6 shadow-sm">
                            <h3 className="font-semibold mb-4">Request Verification</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Send a verification request to the applicant.
                            </p>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => handleVerification("otp")}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                >
                                    <Send className="h-5 w-5 text-blue-600" />
                                    <span className="text-xs font-medium">OTP</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("kba")}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                >
                                    <KeyRound className="h-5 w-5 text-purple-600" />
                                    <span className="text-xs font-medium">KBA</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("document")}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                >
                                    <FileText className="h-5 w-5 text-green-600" />
                                    <span className="text-xs font-medium">Document</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("call")}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                >
                                    <Phone className="h-5 w-5 text-orange-600" />
                                    <span className="text-xs font-medium">Call</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Case Timeline */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold mb-4">Timeline</h3>
                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
                                <div>
                                    <p className="text-sm font-medium">Application Received</p>
                                    <p className="text-xs text-muted-foreground">
                                        {new Date(fraudCase.created_at).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-2 h-2 mt-2 rounded-full bg-orange-500" />
                                <div>
                                    <p className="text-sm font-medium">Fraud Score Generated</p>
                                    <p className="text-xs text-muted-foreground">
                                        Score: {score.score} | {new Date(score.scored_at).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className={cn(
                                    "w-2 h-2 mt-2 rounded-full",
                                    fraudCase.status === "pending" ? "bg-gray-300" :
                                        fraudCase.status === "in_review" ? "bg-blue-500" :
                                            "bg-green-500"
                                )} />
                                <div>
                                    <p className="text-sm font-medium capitalize">
                                        {fraudCase.status.replace("_", " ")}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {fraudCase.assigned_to
                                            ? `Assigned to ${fraudCase.assigned_to.replace("_", " ")}`
                                            : "Awaiting assignment"}
                                    </p>
                                </div>
                            </div>
                            {fraudCase.resolved_at && (
                                <div className="flex gap-3">
                                    <div className="w-2 h-2 mt-2 rounded-full bg-green-500" />
                                    <div>
                                        <p className="text-sm font-medium capitalize">
                                            {fraudCase.outcome}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(fraudCase.resolved_at).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
