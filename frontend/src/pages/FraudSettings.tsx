import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
    getAutomationSettings,
    updateAutomationSettings,
} from "@/lib/fraudData";
import type { FraudAutomationSettings } from "@/lib/api";
import {
    Settings,
    Users,
    Zap,
    Clock,
    Bell,
    Layers,
    Save,
    CheckCircle2,
    Mail,
    MessageSquare,
    Webhook,
    AlertTriangle,
    Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    label: string;
    description?: string;
}

function Toggle({ enabled, onChange, label, description }: ToggleProps) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
                <label className="font-medium text-gray-900 dark:text-gray-100">
                    {label}
                </label>
                {description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {description}
                    </p>
                )}
            </div>
            <button
                onClick={() => onChange(!enabled)}
                className={cn(
                    "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                    enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
                )}
            >
                <span
                    className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        enabled ? "translate-x-5" : "translate-x-0"
                    )}
                />
            </button>
        </div>
    );
}

interface NumberInputProps {
    value: number;
    onChange: (value: number) => void;
    label: string;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
}

function NumberInput({
    value,
    onChange,
    label,
    description,
    min = 0,
    max = 1000,
    step = 1,
    unit,
}: NumberInputProps) {
    return (
        <div className="space-y-1">
            <label className="font-medium text-gray-900 dark:text-gray-100">
                {label}
            </label>
            {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {description}
                </p>
            )}
            <div className="flex items-center gap-2 mt-2">
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    min={min}
                    max={max}
                    step={step}
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {unit && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        {unit}
                    </span>
                )}
            </div>
        </div>
    );
}

interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    description?: string;
    options: { value: string; label: string }[];
}

function Select({ value, onChange, label, description, options }: SelectProps) {
    return (
        <div className="space-y-1">
            <label className="font-medium text-gray-900 dark:text-gray-100">
                {label}
            </label>
            {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {description}
                </p>
            )}
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

interface NotificationChannelProps {
    channels: ("email" | "slack" | "webhook")[];
    onChange: (channels: ("email" | "slack" | "webhook")[]) => void;
}

function NotificationChannels({ channels, onChange }: NotificationChannelProps) {
    const channelConfig = [
        { id: "email" as const, label: "Email", icon: Mail },
        { id: "slack" as const, label: "Slack", icon: MessageSquare },
        { id: "webhook" as const, label: "Webhook", icon: Webhook },
    ];

    const toggleChannel = (channelId: "email" | "slack" | "webhook") => {
        if (channels.includes(channelId)) {
            onChange(channels.filter((c) => c !== channelId));
        } else {
            onChange([...channels, channelId]);
        }
    };

    return (
        <div className="space-y-2">
            <label className="font-medium text-gray-900 dark:text-gray-100">
                Notification Channels
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400">
                Select how you want to receive fraud alerts
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
                {channelConfig.map((channel) => {
                    const Icon = channel.icon;
                    const isActive = channels.includes(channel.id);
                    return (
                        <button
                            key={channel.id}
                            onClick={() => toggleChannel(channel.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                                isActive
                                    ? "bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/30 dark:border-blue-400 dark:text-blue-300"
                                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            {channel.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface SettingsSectionProps {
    title: string;
    description: string;
    icon: typeof Settings;
    children: React.ReactNode;
}

function SettingsSection({
    title,
    description,
    icon: Icon,
    children,
}: SettingsSectionProps) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-start gap-4 mb-6">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                    <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {description}
                    </p>
                </div>
            </div>
            <div className="space-y-6">{children}</div>
        </div>
    );
}

export default function FraudSettings() {
    const { systemId = "sys_default" } = useParams<{ systemId: string }>();
    const [settings, setSettings] = useState<FraudAutomationSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        const data = getAutomationSettings(systemId);
        setSettings(data);
    }, [systemId]);

    const updateSetting = <K extends keyof FraudAutomationSettings>(
        key: K,
        value: FraudAutomationSettings[K]
    ) => {
        if (settings) {
            setSettings({ ...settings, [key]: value });
            setHasChanges(true);
            setSaved(false);
        }
    };

    const handleSave = () => {
        if (!settings) return;
        setSaving(true);
        // Simulate save delay
        setTimeout(() => {
            updateAutomationSettings(systemId, settings);
            setSaving(false);
            setSaved(true);
            setHasChanges(false);
            // Reset saved indicator after 3 seconds
            setTimeout(() => setSaved(false), 3000);
        }, 500);
    };

    if (!settings) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                        Automation Settings
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-1">
                        Configure fraud case handling automation and workflows
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                        hasChanges && !saving
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : saved
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800"
                    )}
                >
                    {saving ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                            Saving...
                        </>
                    ) : saved ? (
                        <>
                            <CheckCircle2 className="w-4 h-4" />
                            Saved
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save Changes
                        </>
                    )}
                </button>
            </div>

            {/* Warning Banner */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium text-amber-800 dark:text-amber-200">
                        Changes affect live fraud processing
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                        Automation settings are applied immediately to incoming fraud cases.
                        Review changes carefully before saving.
                    </p>
                </div>
            </div>

            {/* Auto-Assignment Section */}
            <SettingsSection
                title="Case Auto-Assignment"
                description="Automatically distribute fraud cases to analysts"
                icon={Users}
            >
                <Toggle
                    enabled={settings.auto_assign_enabled}
                    onChange={(v) => updateSetting("auto_assign_enabled", v)}
                    label="Enable Auto-Assignment"
                    description="Automatically assign new fraud cases to available analysts"
                />

                {settings.auto_assign_enabled && (
                    <>
                        <Select
                            value={settings.assignment_strategy}
                            onChange={(v) =>
                                updateSetting(
                                    "assignment_strategy",
                                    v as "round_robin" | "load_balanced" | "skill_based"
                                )
                            }
                            label="Assignment Strategy"
                            description="How cases are distributed among analysts"
                            options={[
                                { value: "round_robin", label: "Round Robin - Equal distribution" },
                                {
                                    value: "load_balanced",
                                    label: "Load Balanced - Based on current workload",
                                },
                                { value: "skill_based", label: "Skill Based - Match case complexity" },
                            ]}
                        />

                        <NumberInput
                            value={settings.max_cases_per_analyst}
                            onChange={(v) => updateSetting("max_cases_per_analyst", v)}
                            label="Max Cases Per Analyst"
                            description="Maximum number of active cases an analyst can have"
                            min={1}
                            max={100}
                            unit="cases"
                        />
                    </>
                )}
            </SettingsSection>

            {/* Auto-Decisioning Section */}
            <SettingsSection
                title="Auto-Decisioning"
                description="Automatically approve or decline cases based on risk score"
                icon={Zap}
            >
                <Toggle
                    enabled={settings.auto_decision_enabled}
                    onChange={(v) => updateSetting("auto_decision_enabled", v)}
                    label="Enable Auto-Decisioning"
                    description="Automatically decision cases outside of manual review thresholds"
                />

                {settings.auto_decision_enabled && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-6">
                        <div className="flex items-start gap-2">
                            <Info className="w-4 h-4 text-blue-500 mt-0.5" />
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Cases with scores between the thresholds will require manual review.
                            </p>
                        </div>

                        <NumberInput
                            value={settings.auto_approve_below_score}
                            onChange={(v) => updateSetting("auto_approve_below_score", v)}
                            label="Auto-Approve Below Score"
                            description="Cases with scores below this threshold are automatically approved"
                            min={0}
                            max={settings.auto_decline_above_score - 50}
                            unit="score"
                        />

                        <NumberInput
                            value={settings.auto_decline_above_score}
                            onChange={(v) => updateSetting("auto_decline_above_score", v)}
                            label="Auto-Decline Above Score"
                            description="Cases with scores above this threshold are automatically declined"
                            min={settings.auto_approve_below_score + 50}
                            max={1000}
                            unit="score"
                        />

                        {/* Visual Score Range */}
                        <div className="mt-4">
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Score Range Visualization
                            </div>
                            <div className="relative h-8 rounded-lg overflow-hidden flex">
                                <div
                                    className="bg-green-500 flex items-center justify-center text-xs font-medium text-white"
                                    style={{
                                        width: `${(settings.auto_approve_below_score / 1000) * 100}%`,
                                    }}
                                >
                                    {settings.auto_approve_below_score > 100 && "Auto-Approve"}
                                </div>
                                <div
                                    className="bg-amber-400 flex items-center justify-center text-xs font-medium text-amber-900"
                                    style={{
                                        width: `${
                                            ((settings.auto_decline_above_score -
                                                settings.auto_approve_below_score) /
                                                1000) *
                                            100
                                        }%`,
                                    }}
                                >
                                    Manual Review
                                </div>
                                <div
                                    className="bg-red-500 flex items-center justify-center text-xs font-medium text-white"
                                    style={{
                                        width: `${
                                            ((1000 - settings.auto_decline_above_score) / 1000) * 100
                                        }%`,
                                    }}
                                >
                                    {1000 - settings.auto_decline_above_score > 100 && "Auto-Decline"}
                                </div>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                <span>0</span>
                                <span>{settings.auto_approve_below_score}</span>
                                <span>{settings.auto_decline_above_score}</span>
                                <span>1000</span>
                            </div>
                        </div>
                    </div>
                )}
            </SettingsSection>

            {/* Escalation Section */}
            <SettingsSection
                title="Escalation Rules"
                description="Configure automatic case escalation behavior"
                icon={Clock}
            >
                <NumberInput
                    value={settings.escalation_timeout_minutes}
                    onChange={(v) => updateSetting("escalation_timeout_minutes", v)}
                    label="Escalation Timeout"
                    description="Time before a case is considered overdue"
                    min={15}
                    max={480}
                    step={15}
                    unit="minutes"
                />

                <Toggle
                    enabled={settings.auto_escalate_on_timeout}
                    onChange={(v) => updateSetting("auto_escalate_on_timeout", v)}
                    label="Auto-Escalate on Timeout"
                    description="Automatically escalate cases that exceed the timeout threshold"
                />
            </SettingsSection>

            {/* Notifications Section */}
            <SettingsSection
                title="Notifications"
                description="Configure fraud alert notifications"
                icon={Bell}
            >
                <Toggle
                    enabled={settings.notify_on_critical}
                    onChange={(v) => updateSetting("notify_on_critical", v)}
                    label="Critical Case Alerts"
                    description="Send immediate notification for critical risk cases"
                />

                <Toggle
                    enabled={settings.notify_on_sla_breach}
                    onChange={(v) => updateSetting("notify_on_sla_breach", v)}
                    label="SLA Breach Alerts"
                    description="Notify when cases are approaching or breaching SLA targets"
                />

                <NotificationChannels
                    channels={settings.notification_channels}
                    onChange={(v) => updateSetting("notification_channels", v)}
                />
            </SettingsSection>

            {/* Batch Operations Section */}
            <SettingsSection
                title="Batch Operations"
                description="Configure bulk case processing"
                icon={Layers}
            >
                <Toggle
                    enabled={settings.batch_review_enabled}
                    onChange={(v) => updateSetting("batch_review_enabled", v)}
                    label="Enable Batch Review"
                    description="Allow analysts to review and decision multiple cases at once"
                />

                {settings.batch_review_enabled && (
                    <NumberInput
                        value={settings.batch_size_limit}
                        onChange={(v) => updateSetting("batch_size_limit", v)}
                        label="Maximum Batch Size"
                        description="Maximum number of cases that can be processed in a single batch"
                        min={5}
                        max={100}
                        step={5}
                        unit="cases"
                    />
                )}
            </SettingsSection>
        </div>
    );
}
