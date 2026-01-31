import { useState } from "react";
import { useParams } from "react-router-dom";
import {
    getFraudRules,
    updateFraudRule,
    deleteFraudRule,
    createFraudRule,
    simulateFraudRule,
    RULE_FIELDS,
} from "@/lib/fraudData";
import type { FraudRule, FraudRuleCondition, FraudRuleSimulation } from "@/lib/api";
import {
    Shield,
    Plus,
    Trash2,
    Edit2,
    Play,
    Power,
    PowerOff,
    AlertTriangle,
    CheckCircle2,
    X,
    ChevronDown,
    ChevronUp,
    Zap,
    Target,
    TrendingUp,
    Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

const ACTION_CONFIG = {
    flag: { label: "Flag for Review", color: "bg-yellow-100 text-yellow-800", icon: AlertTriangle },
    auto_decline: { label: "Auto Decline", color: "bg-red-100 text-red-800", icon: X },
    escalate: { label: "Escalate", color: "bg-purple-100 text-purple-800", icon: TrendingUp },
    require_verification: { label: "Require Verification", color: "bg-blue-100 text-blue-800", icon: Shield },
};

const OPERATOR_LABELS: Record<string, string> = {
    eq: "equals",
    neq: "not equals",
    gt: "greater than",
    gte: "greater than or equal",
    lt: "less than",
    lte: "less than or equal",
    contains: "contains",
    in: "is one of",
};

interface RuleEditorProps {
    rule?: FraudRule;
    onSave: (rule: Omit<FraudRule, "id" | "decision_system_id" | "created_at" | "updated_at" | "trigger_count_30d" | "last_triggered_at">) => void;
    onCancel: () => void;
}

function RuleEditor({ rule, onSave, onCancel }: RuleEditorProps) {
    const [name, setName] = useState(rule?.name || "");
    const [description, setDescription] = useState(rule?.description || "");
    const [ruleType, setRuleType] = useState<FraudRule["rule_type"]>(rule?.rule_type || "threshold");
    const [conditions, setConditions] = useState<FraudRuleCondition[]>(
        rule?.conditions || [{ id: "c1", field: "fraud_score", operator: "gte", value: 800 }]
    );
    const [logic, setLogic] = useState<"AND" | "OR">(rule?.logic || "AND");
    const [action, setAction] = useState<FraudRule["action"]>(rule?.action || "flag");
    const [scoreImpact, setScoreImpact] = useState(rule?.score_impact || 50);
    const [priority, setPriority] = useState(rule?.priority || 10);
    const [isActive, setIsActive] = useState(rule?.is_active ?? true);

    const addCondition = () => {
        setConditions([
            ...conditions,
            { id: `c${conditions.length + 1}`, field: "fraud_score", operator: "gte", value: 500 },
        ]);
    };

    const removeCondition = (index: number) => {
        if (conditions.length > 1) {
            setConditions(conditions.filter((_, i) => i !== index));
        }
    };

    const updateCondition = (index: number, updates: Partial<FraudRuleCondition>) => {
        setConditions(conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)));
    };

    const handleSubmit = () => {
        if (!name.trim()) return;
        onSave({
            name,
            description,
            rule_type: ruleType,
            conditions,
            logic,
            action,
            score_impact: scoreImpact,
            priority,
            is_active: isActive,
        });
    };

    return (
        <div className="bg-card border rounded-xl p-6 shadow-lg">
            <h3 className="font-semibold text-lg mb-4">
                {rule ? "Edit Rule" : "Create New Rule"}
            </h3>

            <div className="space-y-4">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium block mb-1">Rule Name *</label>
                        <input
                            type="text"
                            className="w-full h-10 px-3 border rounded-lg text-sm"
                            placeholder="e.g., High Risk Auto-Decline"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium block mb-1">Rule Type</label>
                        <select
                            className="w-full h-10 px-3 border rounded-lg text-sm"
                            value={ruleType}
                            onChange={(e) => setRuleType(e.target.value as FraudRule["rule_type"])}
                        >
                            <option value="threshold">Threshold</option>
                            <option value="velocity">Velocity</option>
                            <option value="pattern">Pattern</option>
                            <option value="combination">Combination</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-sm font-medium block mb-1">Description</label>
                    <textarea
                        className="w-full h-20 px-3 py-2 border rounded-lg text-sm resize-none"
                        placeholder="Describe what this rule does..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>

                {/* Conditions */}
                <div className="border rounded-lg p-4 bg-muted/20">
                    <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium">Conditions</label>
                        {conditions.length > 1 && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Match</span>
                                <select
                                    className="h-8 px-2 border rounded text-sm"
                                    value={logic}
                                    onChange={(e) => setLogic(e.target.value as "AND" | "OR")}
                                >
                                    <option value="AND">ALL conditions (AND)</option>
                                    <option value="OR">ANY condition (OR)</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        {conditions.map((condition, index) => (
                            <div key={condition.id} className="flex items-center gap-2 bg-background p-2 rounded-lg">
                                <span className="text-xs text-muted-foreground w-8">
                                    {index === 0 ? "IF" : logic}
                                </span>
                                <select
                                    className="h-8 px-2 border rounded text-sm flex-1"
                                    value={condition.field}
                                    onChange={(e) => updateCondition(index, { field: e.target.value })}
                                >
                                    {RULE_FIELDS.map((f) => (
                                        <option key={f.field} value={f.field}>
                                            {f.label}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="h-8 px-2 border rounded text-sm w-40"
                                    value={condition.operator}
                                    onChange={(e) => updateCondition(index, { operator: e.target.value as FraudRuleCondition["operator"] })}
                                >
                                    {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                                        <option key={op} value={op}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    className="h-8 px-2 border rounded text-sm w-32"
                                    value={Array.isArray(condition.value) ? condition.value.join(", ") : condition.value}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        // Check if it looks like a comma-separated list
                                        if (condition.operator === "in" && val.includes(",")) {
                                            updateCondition(index, { value: val.split(",").map((s) => s.trim()) });
                                        } else if (!isNaN(Number(val)) && val !== "") {
                                            updateCondition(index, { value: Number(val) });
                                        } else {
                                            updateCondition(index, { value: val });
                                        }
                                    }}
                                    placeholder="Value"
                                />
                                <button
                                    onClick={() => removeCondition(index)}
                                    disabled={conditions.length === 1}
                                    className="p-1 text-muted-foreground hover:text-red-600 disabled:opacity-30"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={addCondition}
                        className="mt-2 text-sm text-primary hover:underline flex items-center gap-1"
                    >
                        <Plus className="h-3 w-3" /> Add Condition
                    </button>
                </div>

                {/* Action */}
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="text-sm font-medium block mb-1">Action</label>
                        <select
                            className="w-full h-10 px-3 border rounded-lg text-sm"
                            value={action}
                            onChange={(e) => setAction(e.target.value as FraudRule["action"])}
                        >
                            {Object.entries(ACTION_CONFIG).map(([key, config]) => (
                                <option key={key} value={key}>
                                    {config.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium block mb-1">Score Impact</label>
                        <input
                            type="number"
                            className="w-full h-10 px-3 border rounded-lg text-sm"
                            value={scoreImpact}
                            onChange={(e) => setScoreImpact(Number(e.target.value))}
                            min={0}
                            max={500}
                            step={25}
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium block mb-1">Priority (lower = higher)</label>
                        <input
                            type="number"
                            className="w-full h-10 px-3 border rounded-lg text-sm"
                            value={priority}
                            onChange={(e) => setPriority(Number(e.target.value))}
                            min={1}
                            max={100}
                        />
                    </div>
                </div>

                {/* Active Toggle */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsActive(!isActive)}
                        className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            isActive ? "bg-green-500" : "bg-gray-300"
                        )}
                    >
                        <span
                            className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                isActive ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                    <span className="text-sm font-medium">
                        {isActive ? "Rule is Active" : "Rule is Inactive"}
                    </span>
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!name.trim()}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                        {rule ? "Save Changes" : "Create Rule"}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface SimulationResultProps {
    simulation: FraudRuleSimulation;
    rule: FraudRule;
    onClose: () => void;
}

function SimulationResult({ simulation, rule, onClose }: SimulationResultProps) {
    return (
        <div className="bg-card border rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Target className="h-5 w-5 text-purple-600" />
                    Simulation Results
                </h3>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="h-5 w-5" />
                </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
                Simulating rule <strong>{rule.name}</strong> against the last 30 days of applications.
            </p>

            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-muted/30 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold">{simulation.total_applications}</p>
                    <p className="text-xs text-muted-foreground">Total Applications</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-4 text-center border border-orange-200">
                    <p className="text-2xl font-bold text-orange-700">{simulation.would_trigger}</p>
                    <p className="text-xs text-orange-600">Would Trigger</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4 text-center border border-blue-200">
                    <p className="text-2xl font-bold text-blue-700">{simulation.trigger_rate}%</p>
                    <p className="text-xs text-blue-600">Trigger Rate</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 text-center border border-yellow-200">
                    <p className="text-2xl font-bold text-yellow-700">~{simulation.false_positive_estimate}</p>
                    <p className="text-xs text-yellow-600">Est. False Positives</p>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-4 py-2 border-b">
                    <p className="text-sm font-medium">Sample Matches</p>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                        <tr>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Application</th>
                            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Applicant</th>
                            <th className="px-4 py-2 text-right font-medium text-muted-foreground">Current Score</th>
                            <th className="px-4 py-2 text-right font-medium text-muted-foreground">New Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {simulation.sample_matches.map((match) => (
                            <tr key={match.application_id} className="border-t">
                                <td className="px-4 py-2">
                                    <code className="text-xs bg-muted px-1 rounded">{match.application_id}</code>
                                </td>
                                <td className="px-4 py-2">{match.applicant_name}</td>
                                <td className="px-4 py-2 text-right font-mono">{match.current_score}</td>
                                <td className="px-4 py-2 text-right font-mono text-orange-600">
                                    {match.would_be_score} (+{rule.score_impact})
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function FraudRules() {
    const { systemId } = useParams<{ systemId: string }>();

    const [rules, setRules] = useState<FraudRule[]>(() => getFraudRules(systemId || ""));
    const [showEditor, setShowEditor] = useState(false);
    const [editingRule, setEditingRule] = useState<FraudRule | undefined>();
    const [simulation, setSimulation] = useState<{ rule: FraudRule; result: FraudRuleSimulation } | null>(null);
    const [expandedRule, setExpandedRule] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const activeRules = rules.filter((r) => r.is_active);
    const inactiveRules = rules.filter((r) => !r.is_active);

    const handleSaveRule = (ruleData: Omit<FraudRule, "id" | "decision_system_id" | "created_at" | "updated_at" | "trigger_count_30d" | "last_triggered_at">) => {
        if (editingRule) {
            const updated = updateFraudRule(editingRule.id, ruleData);
            if (updated) {
                setRules(rules.map((r) => (r.id === updated.id ? updated : r)));
            }
        } else {
            const newRule = createFraudRule(systemId || "", ruleData);
            setRules([...rules, newRule]);
        }
        setShowEditor(false);
        setEditingRule(undefined);
    };

    const handleToggleActive = (rule: FraudRule) => {
        const updated = updateFraudRule(rule.id, { is_active: !rule.is_active });
        if (updated) {
            setRules(rules.map((r) => (r.id === updated.id ? updated : r)));
        }
    };

    const handleDelete = (ruleId: string) => {
        if (deleteFraudRule(ruleId)) {
            setRules(rules.filter((r) => r.id !== ruleId));
        }
        setDeleteConfirm(null);
    };

    const handleSimulate = (rule: FraudRule) => {
        const result = simulateFraudRule(rule, systemId || "");
        setSimulation({ rule, result });
    };

    const RuleCard = ({ rule }: { rule: FraudRule }) => {
        const isExpanded = expandedRule === rule.id;
        const actionConfig = ACTION_CONFIG[rule.action];
        const ActionIcon = actionConfig.icon;

        return (
            <div className={cn(
                "border rounded-lg transition-all",
                rule.is_active ? "bg-card" : "bg-muted/30 opacity-75"
            )}>
                <div
                    className="p-4 cursor-pointer"
                    onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium truncate">{rule.name}</h4>
                                <span className={cn(
                                    "px-2 py-0.5 rounded text-xs font-medium",
                                    actionConfig.color
                                )}>
                                    <ActionIcon className="h-3 w-3 inline mr-1" />
                                    {actionConfig.label}
                                </span>
                                {!rule.is_active && (
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-600">
                                        Inactive
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">{rule.description}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                            <div className="text-right">
                                <p className="text-sm font-medium">{rule.trigger_count_30d}</p>
                                <p className="text-xs text-muted-foreground">triggers (30d)</p>
                            </div>
                            {isExpanded ? (
                                <ChevronUp className="h-5 w-5 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            )}
                        </div>
                    </div>
                </div>

                {isExpanded && (
                    <div className="px-4 pb-4 border-t pt-4">
                        {/* Conditions */}
                        <div className="mb-4">
                            <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Conditions ({rule.logic})</p>
                            <div className="space-y-1">
                                {rule.conditions.map((condition, index) => {
                                    const fieldDef = RULE_FIELDS.find((f) => f.field === condition.field);
                                    return (
                                        <div key={condition.id} className="text-sm bg-muted/30 px-3 py-2 rounded flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground w-8">
                                                {index === 0 ? "IF" : rule.logic}
                                            </span>
                                            <span className="font-medium">{fieldDef?.label || condition.field}</span>
                                            <span className="text-muted-foreground">{OPERATOR_LABELS[condition.operator]}</span>
                                            <code className="bg-muted px-2 py-0.5 rounded text-xs">
                                                {Array.isArray(condition.value) ? condition.value.join(", ") : condition.value}
                                            </code>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-4 gap-4 mb-4 text-center">
                            <div className="bg-muted/30 rounded p-2">
                                <p className="text-lg font-bold">+{rule.score_impact}</p>
                                <p className="text-xs text-muted-foreground">Score Impact</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <p className="text-lg font-bold">{rule.priority}</p>
                                <p className="text-xs text-muted-foreground">Priority</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <p className="text-lg font-bold capitalize">{rule.rule_type}</p>
                                <p className="text-xs text-muted-foreground">Type</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {rule.last_triggered_at
                                        ? new Date(rule.last_triggered_at).toLocaleDateString()
                                        : "Never"}
                                </p>
                                <p className="text-xs text-muted-foreground">Last Triggered</p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingRule(rule);
                                        setShowEditor(true);
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors"
                                >
                                    <Edit2 className="h-3 w-3" /> Edit
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSimulate(rule);
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors"
                                >
                                    <Play className="h-3 w-3" /> Simulate
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleActive(rule);
                                    }}
                                    className={cn(
                                        "inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg transition-colors",
                                        rule.is_active
                                            ? "text-orange-600 border-orange-300 hover:bg-orange-50"
                                            : "text-green-600 border-green-300 hover:bg-green-50"
                                    )}
                                >
                                    {rule.is_active ? (
                                        <><PowerOff className="h-3 w-3" /> Disable</>
                                    ) : (
                                        <><Power className="h-3 w-3" /> Enable</>
                                    )}
                                </button>
                            </div>
                            {deleteConfirm === rule.id ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-red-600">Delete this rule?</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(rule.id);
                                        }}
                                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                                    >
                                        Confirm
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setDeleteConfirm(null);
                                        }}
                                        className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteConfirm(rule.id);
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                                >
                                    <Trash2 className="h-3 w-3" /> Delete
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        <Zap className="h-8 w-8 text-purple-600" />
                        Fraud Rules
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Configure automated fraud detection rules and thresholds.
                    </p>
                </div>
                <button
                    onClick={() => {
                        setEditingRule(undefined);
                        setShowEditor(true);
                    }}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
                >
                    <Plus className="h-4 w-4" /> Create Rule
                </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Active Rules</p>
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{activeRules.length}</p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Inactive Rules</p>
                        <PowerOff className="h-5 w-5 text-gray-400" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{inactiveRules.length}</p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Total Triggers (30d)</p>
                        <Target className="h-5 w-5 text-orange-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">
                        {rules.reduce((sum, r) => sum + r.trigger_count_30d, 0)}
                    </p>
                </div>
            </div>

            {/* Editor Modal */}
            {showEditor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                        <RuleEditor
                            rule={editingRule}
                            onSave={handleSaveRule}
                            onCancel={() => {
                                setShowEditor(false);
                                setEditingRule(undefined);
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Simulation Modal */}
            {simulation && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-3xl">
                        <SimulationResult
                            simulation={simulation.result}
                            rule={simulation.rule}
                            onClose={() => setSimulation(null)}
                        />
                    </div>
                </div>
            )}

            {/* Active Rules */}
            <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    Active Rules
                </h2>
                <div className="space-y-3">
                    {activeRules.length > 0 ? (
                        activeRules
                            .sort((a, b) => a.priority - b.priority)
                            .map((rule) => <RuleCard key={rule.id} rule={rule} />)
                    ) : (
                        <div className="border rounded-lg p-8 text-center text-muted-foreground">
                            <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p>No active rules. Create one to get started.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Inactive Rules */}
            {inactiveRules.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
                        <PowerOff className="h-5 w-5" />
                        Inactive Rules
                    </h2>
                    <div className="space-y-3">
                        {inactiveRules.map((rule) => (
                            <RuleCard key={rule.id} rule={rule} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
