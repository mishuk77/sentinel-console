import { useState } from "react";
import {
    X,
    ArrowRight,
    ArrowLeft,
    Check,
    AlertCircle,
    Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    MODULE_REGISTRY,
    MODULE_ORDER,
    SYSTEM_TEMPLATES,
    resolveModuleDependencies,
    type SystemModule,
    type SystemTemplate,
} from "@/lib/modules";

interface CreateSystemWizardProps {
    onClose: () => void;
    onSubmit: (data: {
        name: string;
        description: string;
        enabled_modules: SystemModule[];
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
    const [step, setStep] = useState<1 | 2>(1);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [selectedModules, setSelectedModules] = useState<SystemModule[]>([
        "credit_scoring",
        "policy_engine",
    ]);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(
        "credit_decisioning"
    );

    const toggleModule = (moduleId: SystemModule) => {
        setSelectedTemplate(null); // clear template selection when customizing

        let updated: SystemModule[];
        if (selectedModules.includes(moduleId)) {
            updated = selectedModules.filter((m) => m !== moduleId);
        } else {
            updated = [...selectedModules, moduleId];
        }
        // Resolve dependencies
        setSelectedModules(resolveModuleDependencies(updated));
    };

    const selectTemplate = (template: SystemTemplate) => {
        setSelectedTemplate(template.id);
        setSelectedModules([...template.modules]);
    };

    const handleCreate = () => {
        if (!name.trim() || selectedModules.length === 0) return;
        onSubmit({
            name: name.trim(),
            description: description.trim(),
            enabled_modules: selectedModules,
        });
    };

    const isModuleRequired = (moduleId: SystemModule): boolean => {
        // A module is "required" if another selected module depends on it
        return selectedModules.some(
            (m) =>
                m !== moduleId &&
                MODULE_REGISTRY[m].dependencies.includes(moduleId)
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div>
                        <h2 className="text-lg font-semibold">
                            Create Decision System
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Step {step} of 2 —{" "}
                            {step === 1 ? "System Details" : "Choose Modules"}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="h-1 bg-muted">
                    <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: step === 1 ? "50%" : "100%" }}
                    />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {step === 1 && (
                        <div className="space-y-5">
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    System Name{" "}
                                    <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="w-full border rounded-lg px-3 py-2.5 bg-background focus:ring-2 focus:ring-primary focus:border-primary outline-none"
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
                                    className="w-full border rounded-lg px-3 py-2.5 bg-background focus:ring-2 focus:ring-primary focus:border-primary outline-none resize-none"
                                    placeholder="Brief description of this decision context"
                                    rows={3}
                                    value={description}
                                    onChange={(e) =>
                                        setDescription(e.target.value)
                                    }
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            {/* Templates */}
                            <div>
                                <h3 className="text-sm font-medium mb-3">
                                    Start from a template
                                </h3>
                                <div className="grid grid-cols-3 gap-3">
                                    {SYSTEM_TEMPLATES.map((template) => (
                                        <button
                                            key={template.id}
                                            onClick={() =>
                                                selectTemplate(template)
                                            }
                                            className={cn(
                                                "text-left p-4 rounded-xl border-2 transition-all",
                                                selectedTemplate ===
                                                    template.id
                                                    ? "border-primary bg-primary/5"
                                                    : "border-transparent bg-muted/50 hover:bg-muted"
                                            )}
                                        >
                                            <div className="text-2xl mb-2">
                                                {template.emoji}
                                            </div>
                                            <div className="font-medium text-sm">
                                                {template.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                {template.description}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Divider */}
                            <div className="flex items-center gap-3">
                                <div className="flex-1 border-t" />
                                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                                    or customize
                                </span>
                                <div className="flex-1 border-t" />
                            </div>

                            {/* Module Picker */}
                            <div className="space-y-2">
                                {MODULE_ORDER.map((moduleId) => {
                                    const mod = MODULE_REGISTRY[moduleId];
                                    const Icon = mod.icon;
                                    const isSelected =
                                        selectedModules.includes(moduleId);
                                    const isRequired =
                                        isModuleRequired(moduleId);
                                    const hasDeps =
                                        mod.dependencies.length > 0;

                                    return (
                                        <button
                                            key={moduleId}
                                            onClick={() =>
                                                !isRequired &&
                                                toggleModule(moduleId)
                                            }
                                            className={cn(
                                                "w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left",
                                                isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-transparent bg-muted/30 hover:bg-muted/50"
                                            )}
                                        >
                                            {/* Checkbox */}
                                            <div
                                                className={cn(
                                                    "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
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
                                                        ? `bg-${mod.color}-100 dark:bg-${mod.color}-900/30`
                                                        : "bg-muted"
                                                )}
                                            >
                                                <Icon
                                                    className={cn(
                                                        "h-5 w-5",
                                                        isSelected
                                                            ? `text-${mod.color}-600 dark:text-${mod.color}-400`
                                                            : "text-muted-foreground"
                                                    )}
                                                />
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                    {mod.name}
                                                    {isRequired && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                                            required
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                    {mod.description}
                                                    {hasDeps && (
                                                        <span className="ml-1 text-muted-foreground/70">
                                                            (requires{" "}
                                                            {mod.dependencies
                                                                .map(
                                                                    (d) =>
                                                                        MODULE_REGISTRY[
                                                                            d
                                                                        ]
                                                                            .shortName
                                                                )
                                                                .join(", ")}
                                                            )
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Selected Summary */}
                            <div className="flex flex-wrap gap-1.5 pt-2">
                                {selectedModules.map((moduleId) => {
                                    const mod = MODULE_REGISTRY[moduleId];
                                    return (
                                        <span
                                            key={moduleId}
                                            className={cn(
                                                "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium",
                                                mod.badgeClasses
                                            )}
                                        >
                                            {mod.shortName}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-6 mb-2 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
                    <div>
                        {step === 2 && (
                            <button
                                onClick={() => setStep(1)}
                                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Back
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </button>
                        {step === 1 ? (
                            <button
                                onClick={() => setStep(2)}
                                disabled={!name.trim()}
                                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        ) : (
                            <button
                                onClick={handleCreate}
                                disabled={
                                    !name.trim() ||
                                    selectedModules.length === 0 ||
                                    isPending
                                }
                                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
