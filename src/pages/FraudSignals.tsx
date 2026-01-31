import { useState } from "react";
import { useParams } from "react-router-dom";
import { getSignalProviders, updateSignalProvider } from "@/lib/fraudData";
import type { SignalProvider } from "@/lib/api";
import {
    Radio,
    Power,
    PowerOff,
    CheckCircle2,
    AlertTriangle,
    Clock,
    XCircle,
    Activity,
    DollarSign,
    Zap,
    Shield,
    Smartphone,
    MousePointer,
    Building,
    CreditCard,
    Settings,
    RefreshCw,
    ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDER_TYPE_CONFIG: Record<SignalProvider["provider_type"], { icon: typeof Shield; color: string; label: string }> = {
    identity: { icon: Shield, color: "bg-blue-100 text-blue-700", label: "Identity Verification" },
    device: { icon: Smartphone, color: "bg-purple-100 text-purple-700", label: "Device Intelligence" },
    behavior: { icon: MousePointer, color: "bg-orange-100 text-orange-700", label: "Behavioral Biometrics" },
    consortium: { icon: Building, color: "bg-green-100 text-green-700", label: "Consortium Data" },
    bureau: { icon: CreditCard, color: "bg-indigo-100 text-indigo-700", label: "Credit Bureau" },
};

const STATUS_CONFIG: Record<SignalProvider["status"], { color: string; icon: typeof CheckCircle2 }> = {
    connected: { color: "text-green-600", icon: CheckCircle2 },
    disconnected: { color: "text-gray-400", icon: XCircle },
    error: { color: "text-red-600", icon: AlertTriangle },
    pending: { color: "text-yellow-600", icon: Clock },
};

export default function FraudSignals() {
    const { systemId } = useParams<{ systemId: string }>();
    const [providers, setProviders] = useState<SignalProvider[]>(() =>
        getSignalProviders(systemId || "")
    );
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

    const handleToggleProvider = (providerId: string) => {
        const provider = providers.find(p => p.id === providerId);
        if (!provider) return;

        const updated = updateSignalProvider(providerId, { is_enabled: !provider.is_enabled });
        if (updated) {
            setProviders(providers.map(p => p.id === providerId ? updated : p));
        }
    };

    const handleTestConnection = (providerId: string) => {
        // Simulate connection test
        const updated = updateSignalProvider(providerId, {
            status: "connected",
            last_sync_at: new Date().toISOString(),
        });
        if (updated) {
            setProviders(providers.map(p => p.id === providerId ? updated : p));
        }
    };

    // Calculate totals
    const enabledProviders = providers.filter(p => p.is_enabled);
    const totalSignals = enabledProviders.reduce((sum, p) => sum + p.signals_provided.length, 0);
    const totalCallsToday = providers.reduce((sum, p) => sum + p.calls_today, 0);
    const avgCost = enabledProviders.length > 0
        ? enabledProviders.reduce((sum, p) => sum + p.cost_per_call, 0) / enabledProviders.length
        : 0;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                    <Radio className="h-8 w-8 text-indigo-600" />
                    Signal Providers
                </h1>
                <p className="text-muted-foreground mt-2">
                    Configure external signal providers for federated fraud intelligence.
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Connected</p>
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{enabledProviders.length}</p>
                    <p className="text-xs text-muted-foreground">of {providers.length} providers</p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Total Signals</p>
                        <Zap className="h-5 w-5 text-purple-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{totalSignals}</p>
                    <p className="text-xs text-muted-foreground">available signals</p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Calls Today</p>
                        <Activity className="h-5 w-5 text-blue-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">{totalCallsToday.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">API calls</p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-muted-foreground">Avg Cost</p>
                        <DollarSign className="h-5 w-5 text-green-500" />
                    </div>
                    <p className="text-3xl font-bold mt-2">${avgCost.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">per call</p>
                </div>
            </div>

            {/* Provider List */}
            <div className="space-y-4">
                {providers.map((provider) => {
                    const typeConfig = PROVIDER_TYPE_CONFIG[provider.provider_type];
                    const statusConfig = STATUS_CONFIG[provider.status];
                    const TypeIcon = typeConfig.icon;
                    const StatusIcon = statusConfig.icon;
                    const isExpanded = selectedProvider === provider.id;

                    return (
                        <div
                            key={provider.id}
                            className={cn(
                                "bg-card border rounded-xl overflow-hidden transition-all",
                                !provider.is_enabled && "opacity-60"
                            )}
                        >
                            {/* Provider Header */}
                            <div
                                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => setSelectedProvider(isExpanded ? null : provider.id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={cn("p-2 rounded-lg", typeConfig.color)}>
                                            <TypeIcon className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold">{provider.name}</h3>
                                                <StatusIcon className={cn("h-4 w-4", statusConfig.color)} />
                                                {!provider.is_enabled && (
                                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                                        Disabled
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-0.5">
                                                {typeConfig.label} • {provider.signals_provided.length} signals
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        {provider.is_enabled && provider.status === "connected" && (
                                            <div className="flex items-center gap-6 text-sm">
                                                <div className="text-center">
                                                    <p className="font-mono">{provider.avg_latency_ms}ms</p>
                                                    <p className="text-xs text-muted-foreground">Latency</p>
                                                </div>
                                                <div className="text-center">
                                                    <p className={cn(
                                                        "font-mono",
                                                        provider.success_rate >= 99 ? "text-green-600" :
                                                            provider.success_rate >= 95 ? "text-yellow-600" : "text-red-600"
                                                    )}>
                                                        {provider.success_rate}%
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">Success</p>
                                                </div>
                                                <div className="text-center">
                                                    <p className="font-mono">{provider.calls_today.toLocaleString()}</p>
                                                    <p className="text-xs text-muted-foreground">Today</p>
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleProvider(provider.id);
                                            }}
                                            className={cn(
                                                "p-2 rounded-lg transition-colors",
                                                provider.is_enabled
                                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                            )}
                                        >
                                            {provider.is_enabled ? (
                                                <Power className="h-5 w-5" />
                                            ) : (
                                                <PowerOff className="h-5 w-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Details */}
                            {isExpanded && (
                                <div className="border-t p-6 bg-muted/20">
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Description & Signals */}
                                        <div>
                                            <p className="text-sm text-muted-foreground mb-4">
                                                {provider.description}
                                            </p>

                                            <h4 className="text-sm font-medium mb-2">Signals Provided</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {provider.signals_provided.map((signal) => (
                                                    <span
                                                        key={signal}
                                                        className="px-2 py-1 bg-muted rounded text-xs font-mono"
                                                    >
                                                        {signal}
                                                    </span>
                                                ))}
                                            </div>

                                            {provider.api_endpoint && (
                                                <div className="mt-4">
                                                    <h4 className="text-sm font-medium mb-1">API Endpoint</h4>
                                                    <code className="text-xs bg-muted px-2 py-1 rounded">
                                                        {provider.api_endpoint}
                                                    </code>
                                                </div>
                                            )}
                                        </div>

                                        {/* Stats & Actions */}
                                        <div>
                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div className="bg-card border rounded-lg p-3">
                                                    <p className="text-xl font-bold">${provider.cost_per_call.toFixed(2)}</p>
                                                    <p className="text-xs text-muted-foreground">Cost per call</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3">
                                                    <p className="text-xl font-bold">
                                                        ${(provider.calls_today * provider.cost_per_call).toFixed(2)}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">Cost today</p>
                                                </div>
                                            </div>

                                            {provider.last_sync_at && (
                                                <p className="text-xs text-muted-foreground mb-4">
                                                    Last sync: {new Date(provider.last_sync_at).toLocaleString()}
                                                </p>
                                            )}

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleTestConnection(provider.id)}
                                                    className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                                                >
                                                    <RefreshCw className="h-4 w-4" />
                                                    Test Connection
                                                </button>
                                                <button className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                                                    <Settings className="h-4 w-4" />
                                                    Configure
                                                </button>
                                                <button className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                                                    <ExternalLink className="h-4 w-4" />
                                                    Docs
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                        <p className="text-sm text-blue-900 font-medium">Federated Signal Processing</p>
                        <p className="text-sm text-blue-700 mt-1">
                            Signals from enabled providers are automatically integrated into your fraud scoring pipeline.
                            Each API call is logged and billed according to your provider agreements.
                            Configure signal weights in the Rules section.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
