import { useState, useMemo, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getFraudCase, updateFraudCase, getVerificationsForCase, createVerificationRequest } from "@/lib/fraudData";
import type { FraudSignalType, VerificationRequest } from "@/lib/api";
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
    device: { icon: Smartphone, color: "text-info bg-info/10", label: "Device" },
    velocity: { icon: Zap, color: "text-info bg-info/10", label: "Velocity" },
    identity: { icon: UserX, color: "text-down bg-down/10", label: "Identity" },
    behavioral: { icon: MousePointer, color: "text-warn bg-warn/10", label: "Behavioral" },
};

export default function FraudCaseDetail() {
    const { systemId, caseId } = useParams<{ systemId: string; caseId: string }>();
    const navigate = useNavigate();

    const [isProcessing, setIsProcessing] = useState(false);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [notes, setNotes] = useState("");
    const [verifications, setVerifications] = useState<VerificationRequest[]>([]);
    const [verificationRefresh, setVerificationRefresh] = useState(0);

    const fraudCase = useMemo(() => {
        if (!caseId || !systemId) return null;
        return getFraudCase(caseId, systemId);
    }, [caseId, systemId]);

    // Load and refresh verifications
    useEffect(() => {
        if (caseId) {
            const loadVerifications = () => {
                setVerifications(getVerificationsForCase(caseId));
            };
            loadVerifications();
            // Refresh every 2 seconds to check for completed verifications
            const interval = setInterval(loadVerifications, 2000);
            return () => clearInterval(interval);
        }
    }, [caseId, verificationRefresh]);

    if (!fraudCase) {
        return (
            <div className="page">
                <div className="panel border-down/30 p-8 text-center">
                    <AlertTriangle className="h-12 w-12 text-down mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-foreground mb-2">Case Not Found</h2>
                    <p className="text-muted-foreground mb-4">The requested fraud case could not be found.</p>
                    <Link
                        to={`/systems/${systemId}/fraud/queue`}
                        className="inline-flex items-center gap-2 text-down hover:underline"
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
        // Check if there's already a pending verification of this type
        const existingPending = verifications.find(
            v => v.verification_type === type && (v.status === "pending" || v.status === "sent")
        );
        if (existingPending) {
            return; // Don't allow duplicate pending verifications
        }

        // Create the verification request
        const newVerification = createVerificationRequest(fraudCase.id, type);
        setVerifications([...verifications, newVerification]);
        setVerificationRefresh(prev => prev + 1);
    };

    const getVerificationStatusColor = (status: VerificationRequest["status"]) => {
        switch (status) {
            case "pending": return "badge badge-muted";
            case "sent": return "badge badge-blue";
            case "completed": return "badge badge-green";
            case "failed": return "badge badge-red";
            case "expired": return "badge badge-amber";
            default: return "badge badge-muted";
        }
    };

    const getVerificationResultColor = (result: VerificationRequest["result"]) => {
        switch (result) {
            case "pass": return "text-up";
            case "fail": return "text-down";
            case "inconclusive": return "text-warn";
            default: return "text-muted-foreground";
        }
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
        <div className="page">
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
                        <h1 className="page-title">
                            {fraudCase.applicant_name}
                        </h1>
                        <span className={cn(
                            "badge",
                            fraudCase.queue === "critical" ? "badge-red" :
                                fraudCase.queue === "high" ? "badge-amber" :
                                    fraudCase.queue === "medium" ? "badge-amber" :
                                        "badge-green"
                        )}>
                            {fraudCase.queue} risk
                        </span>
                        <span className={cn(
                            "badge",
                            fraudCase.status === "resolved" ? "badge-green" :
                                fraudCase.status === "in_review" ? "badge-blue" :
                                    fraudCase.status === "escalated" ? "badge-muted" :
                                        "badge-muted"
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
                        slaOverdue ? "bg-down/10 border-down/30" :
                            slaCritical ? "bg-warn/10 border-warn/30" :
                                "bg-up/10 border-up/30"
                    )}>
                        <div className="flex items-center gap-2">
                            <Clock className={cn(
                                "h-5 w-5",
                                slaOverdue ? "text-down" :
                                    slaCritical ? "text-warn" : "text-up"
                            )} />
                            <div>
                                <p className={cn(
                                    "font-bold",
                                    slaOverdue ? "text-down" :
                                        slaCritical ? "text-warn" : "text-up"
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
                    <div className="panel p-5">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5 text-warn" />
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
                                            score.score >= 800 ? "text-down" :
                                                score.score >= 600 ? "text-warn" :
                                                    score.score >= 400 ? "text-warn" :
                                                        "text-up"
                                        )}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-center">
                                        <span className={cn(
                                            "text-3xl font-bold",
                                            score.score >= 800 ? "text-down" :
                                                score.score >= 600 ? "text-warn" :
                                                    score.score >= 400 ? "text-warn" :
                                                        "text-up"
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
                                    <div className="h-2 bg-up/20 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>Medium Risk</span>
                                        <span className="text-muted-foreground">400-599</span>
                                    </div>
                                    <div className="h-2 bg-warn/20 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>High Risk</span>
                                        <span className="text-muted-foreground">600-799</span>
                                    </div>
                                    <div className="h-2 bg-warn/30 rounded-full" />

                                    <div className="flex justify-between text-sm">
                                        <span>Critical Risk</span>
                                        <span className="text-muted-foreground">800+</span>
                                    </div>
                                    <div className="h-2 bg-down/20 rounded-full" />
                                </div>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-4">
                            Model: <code>{score.model_version}</code> | Scored: {new Date(score.scored_at).toLocaleString()}
                        </p>
                    </div>

                    {/* Risk Signals */}
                    <div className="panel overflow-hidden">
                        <div className="panel-head">
                            <h3 className="panel-title">Contributing Signals</h3>
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
                                                        "badge",
                                                        signal.risk_contribution > 60 ? "badge-red" :
                                                            signal.risk_contribution > 40 ? "badge-amber" :
                                                                "badge-amber"
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
                        <div className="panel p-5">
                            <h3 className="font-semibold mb-4">Decision</h3>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handleAction("approve")}
                                    disabled={isProcessing}
                                    className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <CheckCircle2 className="h-5 w-5" />
                                    Approve Application
                                </button>

                                <button
                                    onClick={() => handleAction("decline")}
                                    disabled={isProcessing}
                                    className="w-full btn-danger flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <XCircle className="h-5 w-5" />
                                    Decline Application
                                </button>

                                <button
                                    onClick={() => handleAction("escalate")}
                                    disabled={isProcessing}
                                    className="w-full flex items-center justify-center gap-2 border border-info/30 text-info px-4 py-3 rounded-lg font-medium hover:bg-info/10 transition-colors disabled:opacity-50"
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
                        <div className="panel border-up/30 p-6 text-center">
                            <CheckCircle2 className="h-12 w-12 text-up mx-auto mb-3" />
                            <p className="font-bold text-foreground">
                                Case {actionSuccess === "escalate" ? "Escalated" : actionSuccess === "approve" ? "Approved" : "Declined"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Redirecting to queue...
                            </p>
                        </div>
                    )}

                    {/* Resolved Status */}
                    {isResolved && !actionSuccess && (
                        <div className={cn(
                            "panel p-6",
                            fraudCase.outcome === "approved" ? "border-up/30" :
                                fraudCase.outcome === "declined" ? "border-down/30" :
                                    "border-info/30"
                        )}>
                            <div className="flex items-center gap-3 mb-3">
                                {fraudCase.outcome === "approved" ? (
                                    <CheckCircle2 className="h-6 w-6 text-up" />
                                ) : fraudCase.outcome === "declined" ? (
                                    <XCircle className="h-6 w-6 text-down" />
                                ) : (
                                    <ArrowUpRight className="h-6 w-6 text-info" />
                                )}
                                <span className={cn(
                                    "font-bold capitalize",
                                    fraudCase.outcome === "approved" ? "text-up" :
                                        fraudCase.outcome === "declined" ? "text-down" :
                                            "text-info"
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
                        <div className="panel p-5">
                            <h3 className="panel-title mb-4">Request Verification</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Send a verification request to the applicant.
                            </p>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => handleVerification("otp")}
                                    disabled={verifications.some(v => v.verification_type === "otp" && (v.status === "pending" || v.status === "sent"))}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send className="h-5 w-5 text-info" />
                                    <span className="text-xs font-medium">OTP</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("kba")}
                                    disabled={verifications.some(v => v.verification_type === "kba" && (v.status === "pending" || v.status === "sent"))}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <KeyRound className="h-5 w-5 text-info" />
                                    <span className="text-xs font-medium">KBA</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("document")}
                                    disabled={verifications.some(v => v.verification_type === "document" && (v.status === "pending" || v.status === "sent"))}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <FileText className="h-5 w-5 text-up" />
                                    <span className="text-xs font-medium">Document</span>
                                </button>
                                <button
                                    onClick={() => handleVerification("call")}
                                    disabled={verifications.some(v => v.verification_type === "call" && (v.status === "pending" || v.status === "sent"))}
                                    className="flex flex-col items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Phone className="h-5 w-5 text-warn" />
                                    <span className="text-xs font-medium">Call</span>
                                </button>
                            </div>

                            {/* Verification History */}
                            {verifications.length > 0 && (
                                <div className="mt-4 pt-4 border-t">
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Verification History</p>
                                    <div className="space-y-2">
                                        {verifications.map((v) => (
                                            <div key={v.id} className="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-lg">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium uppercase">{v.verification_type}</span>
                                                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", getVerificationStatusColor(v.status))}>
                                                        {v.status === "sent" && "Awaiting Response"}
                                                        {v.status === "pending" && "Pending"}
                                                        {v.status === "completed" && "Completed"}
                                                        {v.status === "failed" && "Failed"}
                                                        {v.status === "expired" && "Expired"}
                                                    </span>
                                                </div>
                                                {v.result && (
                                                    <span className={cn("text-xs font-bold uppercase", getVerificationResultColor(v.result))}>
                                                        {v.result === "pass" && "✓ Passed"}
                                                        {v.result === "fail" && "✗ Failed"}
                                                        {v.result === "inconclusive" && "? Inconclusive"}
                                                    </span>
                                                )}
                                                {!v.result && v.status === "sent" && (
                                                    <span className="text-xs text-muted-foreground animate-pulse">Processing...</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Case Timeline */}
                    <div className="panel p-5">
                        <h3 className="panel-title mb-4">Timeline</h3>
                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <div className="w-2 h-2 mt-2 rounded-full bg-info" />
                                <div>
                                    <p className="text-sm font-medium">Application Received</p>
                                    <p className="text-xs text-muted-foreground">
                                        {new Date(fraudCase.created_at).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-2 h-2 mt-2 rounded-full bg-warn" />
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
                                    fraudCase.status === "pending" ? "bg-muted-foreground/30" :
                                        fraudCase.status === "in_review" ? "bg-info" :
                                            "bg-up"
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
                                    <div className="w-2 h-2 mt-2 rounded-full bg-up" />
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
