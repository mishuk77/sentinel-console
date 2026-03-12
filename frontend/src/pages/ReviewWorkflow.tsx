import { useState } from "react";
import { useParams } from "react-router-dom";
import {
    Users,
    Clock,
    AlertTriangle,
    CheckCircle2,
    ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ReviewWorkflow() {
    useParams<{ systemId: string }>();

    const [queueSettings] = useState({
        critical_sla_minutes: 15,
        high_sla_minutes: 60,
        medium_sla_minutes: 240,
        low_sla_minutes: 1440,
        critical_threshold: 800,
        high_threshold: 600,
        medium_threshold: 400
    });

    const priorityLevels = [
        {
            name: "Critical",
            color: "text-down",
            bgColor: "bg-down/5",
            borderColor: "border-down/30",
            threshold: queueSettings.critical_threshold,
            sla: queueSettings.critical_sla_minutes,
            description: "Requires immediate attention - highest fraud risk"
        },
        {
            name: "High",
            color: "text-warn",
            bgColor: "bg-warn/5",
            borderColor: "border-warn/30",
            threshold: queueSettings.high_threshold,
            sla: queueSettings.high_sla_minutes,
            description: "Elevated risk - requires prompt review"
        },
        {
            name: "Medium",
            color: "text-warn",
            bgColor: "bg-warn/5",
            borderColor: "border-warn/20",
            threshold: queueSettings.medium_threshold,
            sla: queueSettings.medium_sla_minutes,
            description: "Moderate risk - standard review timeline"
        },
        {
            name: "Low",
            color: "text-up",
            bgColor: "bg-up/5",
            borderColor: "border-up/30",
            threshold: 0,
            sla: queueSettings.low_sla_minutes,
            description: "Lower risk - routine verification"
        }
    ];

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <ShieldAlert className="h-6 w-6 text-warn" />
                    Review Workflow Configuration
                </h1>
                <p className="page-desc">
                    Configure case queuing, SLA settings, assignment rules, and escalation workflows for fraud review operations.
                </p>
            </div>

            {/* Info Banner */}
            <div className="panel border-info/30 p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-info mt-0.5" />
                    <div>
                        <p className="font-semibold text-foreground">About Review Workflows</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Define how flagged cases are prioritized, assigned, and escalated. Configure SLA targets and routing rules
                            to ensure high-risk cases get immediate attention while maintaining efficient operations.
                        </p>
                    </div>
                </div>
            </div>

            {/* Priority Queue Configuration */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div>
                        <h3 className="panel-title flex items-center gap-2">
                            <Clock className="h-4 w-4 text-info" />
                            Priority Queue Configuration
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Define priority levels based on fraud scores and set SLA targets for each tier
                        </p>
                    </div>
                </div>
                <div className="p-5 space-y-4">
                    {priorityLevels.map((level) => (
                        <div
                            key={level.name}
                            className={cn("border rounded-lg p-4", level.borderColor, level.bgColor)}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <div className={cn("font-bold text-lg", level.color)}>
                                        {level.name}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {level.description}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className="flex items-center gap-1 text-up">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Active
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                                        Fraud Score Threshold
                                    </label>
                                    <div className="bg-background border rounded px-3 py-2 text-sm font-mono">
                                        {level.threshold > 0 ? `≥ ${level.threshold}` : "< 400"}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                                        SLA Target
                                    </label>
                                    <div className="bg-background border rounded px-3 py-2 text-sm font-mono">
                                        {level.sla < 60 ? `${level.sla} minutes` :
                                         level.sla < 1440 ? `${(level.sla / 60).toFixed(0)} hours` :
                                         `${(level.sla / 1440).toFixed(0)} days`}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Assignment Rules */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div>
                        <h3 className="panel-title flex items-center gap-2">
                            <Users className="h-4 w-4 text-info" />
                            Assignment Rules
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Configure how cases are routed to reviewers
                        </p>
                    </div>
                </div>
                <div className="p-5 space-y-4">
                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">Round Robin Assignment</div>
                            <span className="badge badge-green">
                                Enabled
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Cases are distributed evenly across all available reviewers
                        </p>
                    </div>

                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">Skill-Based Routing</div>
                            <span className="badge badge-muted">
                                Not Configured
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Route cases to reviewers based on expertise level and case complexity
                        </p>
                    </div>

                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">Workload Balancing</div>
                            <span className="badge badge-green">
                                Enabled
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Prevent overloading reviewers by capping active cases per analyst
                        </p>
                        <div className="mt-2">
                            <label className="text-xs font-medium text-muted-foreground">Max Active Cases</label>
                            <div className="bg-muted/50 border rounded px-3 py-2 text-sm font-mono mt-1">
                                10 cases per reviewer
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Escalation Workflows */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div>
                        <h3 className="panel-title flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-down" />
                            Escalation Workflows
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Define when and how cases are escalated to supervisors or specialists
                        </p>
                    </div>
                </div>
                <div className="p-5 space-y-4">
                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">SLA Breach Escalation</div>
                            <span className="badge badge-green">
                                Enabled
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                            Automatically escalate cases to supervisors when SLA deadline is approaching
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Warning Threshold</label>
                                <div className="bg-muted/50 border rounded px-3 py-2 text-sm font-mono mt-1">
                                    80% of SLA
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Escalate To</label>
                                <div className="bg-muted/50 border rounded px-3 py-2 text-sm font-mono mt-1">
                                    Supervisor Queue
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="font-medium">High-Value Case Escalation</div>
                            <span className="badge badge-muted">
                                Not Configured
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Route high-value or high-risk cases to senior reviewers for additional scrutiny
                        </p>
                    </div>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3">
                <button className="px-4 py-2 border rounded-lg hover:bg-muted transition-colors">
                    Reset to Defaults
                </button>
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                    Save Configuration
                </button>
            </div>
        </div>
    );
}
