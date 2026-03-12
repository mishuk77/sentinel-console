import { useState } from "react";
import {
    X,
    Check,
    AlertCircle,
    Loader2,
    BrainCircuit,
    ShieldAlert,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemType } from "@/lib/api";

const SYSTEM_TYPE_OPTIONS: {
    id: SystemType;
    name: string;
    description: string;
    icon: typeof BrainCircuit;
    details: string[];
}[] = [
    {
        id: "credit",
        name: "Credit Risk",
        description: "Score applications and auto-approve with policy thresholds",
        icon: BrainCircuit,
        details: [
            "Upload data & train credit models",
            "Configure approval policies & thresholds",
            "Exposure control & amount ladders",
            "Adverse action (SHAP-based)",
        ],
    },
    {
        id: "fraud",
        name: "Fraud Detection",
        description: "Detect fraud with ML scoring, risk tiers, and disposition management",
        icon: ShieldAlert,
        details: [
            "Upload fraud data & train models",
            "Configure risk tier thresholds",
            "Fraud score & recommended actions",
            "Fraud disposition workflows",
        ],
    },
    {
        id: "full",
        name: "Full Pipeline",
        description: "Complete decisioning with credit, fraud, policy, and exposure control",
        icon: Zap,
        details: [
            "Everything in Credit Risk",
            "Everything in Fraud Detection",
            "Combined bureau-style response",
            "Unified decision endpoint",
        ],
    },
];

interface CreateSystemWizardProps {
    onClose: () => void;
    onSubmit: (data: {
        name: string;
        description: string;
        system_type: SystemType;
    }) => void;
    isPending: boolean;
    error: string | null;
}

export default function CreateSystemWizard({
    onClose,
    onSubmit,
    isPending,
    error,
}: CreateSystemWizardProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [systemType, setSystemType] = useState<SystemType>("full");

    const handleCreate = () => {
        if (!name.trim()) return;
        onSubmit({
            name: name.trim(),
            description: description.trim(),
            system_type: systemType,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="panel w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div>
                        <h2 className="text-lg font-semibold">
                            Create Decision System
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Configure a new isolated workspace
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Name & Description */}
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                System Name{" "}
                                <span className="text-down">*</span>
                            </label>
                            <input
                                type="text"
                                className="field-input"
                                placeholder="e.g. Personal Loan Credit Risk"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Description
                            </label>
                            <textarea
                                className="field-input resize-none h-auto py-2"
                                placeholder="Brief description of this decision context"
                                rows={2}
                                value={description}
                                onChange={(e) =>
                                    setDescription(e.target.value)
                                }
                            />
                        </div>
                    </div>

                    {/* System Type Selection */}
                    <div>
                        <label className="text-sm font-medium mb-3 block">
                            System Type
                        </label>
                        <div className="space-y-3">
                            {SYSTEM_TYPE_OPTIONS.map((opt) => {
                                const Icon = opt.icon;
                                const isSelected = systemType === opt.id;
                                return (
                                    <button
                                        key={opt.id}
                                        onClick={() => setSystemType(opt.id)}
                                        className={cn(
                                            "w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left",
                                            isSelected
                                                ? "border-primary bg-primary/5"
                                                : "border-transparent bg-muted/30 hover:bg-muted/50"
                                        )}
                                    >
                                        {/* Radio */}
                                        <div
                                            className={cn(
                                                "flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                                                isSelected
                                                    ? "bg-primary border-primary"
                                                    : "border-muted-foreground/30"
                                            )}
                                        >
                                            {isSelected && (
                                                <Check className="h-3 w-3 text-primary-foreground" />
                                            )}
                                        </div>

                                        {/* Icon */}
                                        <div
                                            className={cn(
                                                "flex-shrink-0 p-2 rounded-lg",
                                                isSelected
                                                    ? "bg-primary/20"
                                                    : "bg-muted"
                                            )}
                                        >
                                            <Icon
                                                className={cn(
                                                    "h-5 w-5",
                                                    isSelected
                                                        ? "text-primary"
                                                        : "text-muted-foreground"
                                                )}
                                            />
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm">
                                                {opt.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {opt.description}
                                            </div>
                                            {isSelected && (
                                                <ul className="mt-2 space-y-1">
                                                    {opt.details.map((d, i) => (
                                                        <li
                                                            key={i}
                                                            className="text-xs text-muted-foreground flex items-center gap-1.5"
                                                        >
                                                            <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                                                            {d}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-5 mb-2 flex items-center gap-2 p-3 panel border-down/30 text-down text-xs">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* Footer */}
                <div className="panel-head border-b-0 border-t">
                    <div />
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="btn-ghost btn-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleCreate}
                            disabled={!name.trim() || isPending}
                            className="btn-primary btn-sm"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    Create System
                                    <Check className="h-4 w-4" />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
