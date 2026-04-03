import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { Sliders, Save, AlertTriangle, CheckCircle2, Shield, ShieldAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface FraudTierConfig {
    decision_system_id: string;
    low_max: number;
    medium_max: number;
    high_max: number;
    auto_approve_low: boolean;
    auto_block_critical: boolean;
    dispositions?: Record<string, any>;
    created_at?: string;
    updated_at?: string;
}

const TIER_COLORS = {
    Low: { bg: "bg-up/5", border: "border-up/30", text: "text-up", fill: "hsl(142,68%,40%)", fillAlpha: "hsla(142,68%,40%,0.12)" },
    Medium: { bg: "bg-warn/5", border: "border-warn/20", text: "text-warn", fill: "hsl(45,93%,47%)", fillAlpha: "hsla(45,93%,47%,0.12)" },
    High: { bg: "bg-[hsl(25,95%,53%)]/5", border: "border-[hsl(25,95%,53%)]/30", text: "text-[hsl(25,95%,53%)]", fill: "hsl(25,95%,53%)", fillAlpha: "hsla(25,95%,53%,0.12)" },
    Critical: { bg: "bg-down/5", border: "border-down/30", text: "text-down", fill: "hsl(0,68%,52%)", fillAlpha: "hsla(0,68%,52%,0.12)" },
};

export default function FraudTiers() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();

    const { data: config, isLoading } = useQuery<FraudTierConfig>({
        queryKey: ["fraud-tiers", systemId],
        queryFn: async () => {
            const res = await api.get(`/fraud/tiers`, { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // Fetch active fraud model for calibration chart
    const { data: allModels } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const activeFraudModel = allModels?.find(m =>
        (m.metrics as any)?.model_context === "fraud" && m.status === "ACTIVE"
    );
    const calibration = activeFraudModel?.metrics?.calibration as any[] | undefined;

    const [lowMax, setLowMax] = useState(0.3);
    const [mediumMax, setMediumMax] = useState(0.6);
    const [highMax, setHighMax] = useState(0.8);
    const [mediumMethod, setMediumMethod] = useState<string>("otp");
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Sync from server
    useEffect(() => {
        if (config) {
            setLowMax(config.low_max);
            setMediumMax(config.medium_max);
            setHighMax(config.high_max);
            if (config.dispositions?.medium_method) {
                setMediumMethod(config.dispositions.medium_method);
            }
        }
    }, [config]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!systemId) throw new Error("No system ID");
            const payload = {
                low_max: lowMax,
                medium_max: mediumMax,
                high_max: highMax,
                auto_approve_low: true,
                auto_block_critical: false,
                dispositions: {
                    low: "no_verification",
                    medium_method: mediumMethod,
                    high: "manual_review",
                    critical: "manual_review_critical_alert",
                }
            };
            if (config?.decision_system_id) {
                await api.put(`/fraud/tiers/${config.decision_system_id}`, payload);
            } else {
                await api.post("/fraud/tiers", payload, { params: { system_id: systemId } });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["fraud-tiers"] });
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        },
        onError: (err) => {
            console.error("Failed to save tier config:", err);
            alert("Failed to save risk tier configuration");
        }
    });

    const handleSave = () => {
        if (lowMax >= mediumMax || mediumMax >= highMax || highMax >= 1.0) {
            alert("Invalid thresholds! Ensure: Low < Medium < High < 1.0");
            return;
        }
        saveMutation.mutate();
    };

    const getTierForDecile = (decile: number, totalDeciles: number) => {
        const score = decile / totalDeciles;
        if (score <= lowMax) return "Low";
        if (score <= mediumMax) return "Medium";
        if (score <= highMax) return "High";
        return "Critical";
    };

    // Build chart data from calibration
    const chartData = calibration?.map((bin: any) => ({
        decile: bin.decile,
        fraud_rate: +(bin.actual_rate * 100).toFixed(2),
        count: bin.count,
    })) || [];

    const maxDecile = chartData.length > 0 ? Math.max(...chartData.map(d => d.decile)) : 10;

    if (isLoading) {
        return (
            <div className="page">
                <div className="text-center text-muted-foreground">Loading tier configuration...</div>
            </div>
        );
    }

    return (
        <div className="page">
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <Sliders className="h-6 w-6 text-warn" />
                    Fraud Risk Tiers
                </h1>
                <p className="page-desc">
                    Define score thresholds for Low, Medium, High, and Critical fraud tiers. Each tier has a specific disposition action.
                </p>
            </div>

            {saveSuccess && (
                <div className="panel border-up/30 p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                    <CheckCircle2 className="h-5 w-5 text-up" />
                    <span className="text-foreground font-medium">Risk tier configuration saved successfully!</span>
                </div>
            )}

            {/* Chart: Calibration with tier zones */}
            {chartData.length > 0 && (
                <div className="panel">
                    <div className="panel-head">
                        <h3 className="panel-title">Fraud Rate by Risk Decile</h3>
                        <p className="text-2xs text-muted-foreground">
                            Active model: <span className="font-mono">{activeFraudModel?.name}</span>
                        </p>
                    </div>
                    <div className="p-4 h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                {/* Tier zone overlays */}
                                <ReferenceArea x1={1} x2={Math.round(lowMax * maxDecile)} fill={TIER_COLORS.Low.fillAlpha} fillOpacity={1} />
                                <ReferenceArea x1={Math.round(lowMax * maxDecile)} x2={Math.round(mediumMax * maxDecile)} fill={TIER_COLORS.Medium.fillAlpha} fillOpacity={1} />
                                <ReferenceArea x1={Math.round(mediumMax * maxDecile)} x2={Math.round(highMax * maxDecile)} fill={TIER_COLORS.High.fillAlpha} fillOpacity={1} />
                                <ReferenceArea x1={Math.round(highMax * maxDecile)} x2={maxDecile} fill={TIER_COLORS.Critical.fillAlpha} fillOpacity={1} />
                                <XAxis
                                    dataKey="decile"
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false} axisLine={false}
                                    label={{ value: "Risk Decile", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false} axisLine={false}
                                    label={{ value: "Fraud %", angle: -90, position: "insideLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                />
                                <Tooltip
                                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", fontSize: "11px" }}
                                    formatter={((value: number | undefined) => [`${(value ?? 0).toFixed(2)}%`, "Fraud Rate"]) as any}
                                    labelFormatter={(label) => `Decile ${label} — ${getTierForDecile(label, maxDecile)} Risk`}
                                />
                                <Bar dataKey="fraud_rate" radius={[3, 3, 0, 0]} fillOpacity={0.85}
                                    fill="hsl(var(--primary))"
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: Threshold Sliders */}
                <div className="space-y-6">
                    <div className="panel p-5 space-y-6">
                        <h3 className="panel-title flex items-center gap-2">
                            <Sliders className="h-4 w-4 text-warn" />
                            Score Thresholds
                        </h3>

                        {/* Visual tier bar */}
                        <div className="h-6 flex rounded-lg overflow-hidden border">
                            <div className="flex items-center justify-center text-[10px] font-bold text-up bg-up/15"
                                style={{ width: `${lowMax * 100}%` }}>Low</div>
                            <div className="flex items-center justify-center text-[10px] font-bold text-warn bg-warn/15"
                                style={{ width: `${(mediumMax - lowMax) * 100}%` }}>Med</div>
                            <div className="flex items-center justify-center text-[10px] font-bold text-[hsl(25,95%,53%)] bg-[hsl(25,95%,53%)]/15"
                                style={{ width: `${(highMax - mediumMax) * 100}%` }}>High</div>
                            <div className="flex items-center justify-center text-[10px] font-bold text-down bg-down/15"
                                style={{ width: `${(1 - highMax) * 100}%` }}>Crit</div>
                        </div>

                        {/* Low threshold */}
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Low / Medium boundary <span className="text-up font-mono">{lowMax.toFixed(2)}</span>
                            </label>
                            <input type="range" min="0.1" max="0.5" step="0.05" value={lowMax}
                                onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setLowMax(v);
                                    if (v >= mediumMax) setMediumMax(Math.min(v + 0.1, 0.9));
                                    if (v >= highMax) setHighMax(Math.min(v + 0.2, 0.95));
                                }}
                                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-[hsl(var(--primary))]"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>0.10</span><span>0.50</span>
                            </div>
                        </div>

                        {/* Medium threshold */}
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                Medium / High boundary <span className="text-warn font-mono">{mediumMax.toFixed(2)}</span>
                            </label>
                            <input type="range" min={lowMax + 0.05} max="0.85" step="0.05" value={mediumMax}
                                onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setMediumMax(v);
                                    if (v >= highMax) setHighMax(Math.min(v + 0.1, 0.95));
                                }}
                                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-[hsl(var(--primary))]"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>{(lowMax + 0.05).toFixed(2)}</span><span>0.85</span>
                            </div>
                        </div>

                        {/* High threshold */}
                        <div>
                            <label className="block text-sm font-medium mb-2">
                                High / Critical boundary <span className="text-[hsl(25,95%,53%)] font-mono">{highMax.toFixed(2)}</span>
                            </label>
                            <input type="range" min={mediumMax + 0.05} max="0.95" step="0.05" value={highMax}
                                onChange={(e) => setHighMax(parseFloat(e.target.value))}
                                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-[hsl(var(--primary))]"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                <span>{(mediumMax + 0.05).toFixed(2)}</span><span>0.95</span>
                            </div>
                        </div>
                    </div>

                    <button onClick={handleSave} disabled={saveMutation.isPending}
                        className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
                        <Save className="h-4 w-4" />
                        {saveMutation.isPending ? "Saving..." : "Save Configuration"}
                    </button>
                </div>

                {/* Right: Disposition Cards */}
                <div className="space-y-4">
                    <h3 className="panel-title">Tier Dispositions</h3>

                    {/* Low */}
                    <div className={cn("panel p-4 border-2", TIER_COLORS.Low.border, TIER_COLORS.Low.bg)}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Shield className={cn("h-4 w-4", TIER_COLORS.Low.text)} />
                                <span className={cn("font-bold text-sm", TIER_COLORS.Low.text)}>Low Risk</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground">0.00 – {lowMax.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">No additional verification required.</p>
                        <div className="flex items-center gap-2 text-xs">
                            <CheckCircle2 className="h-3.5 w-3.5 text-up" />
                            <span className="font-medium">Proceed without friction</span>
                        </div>
                    </div>

                    {/* Medium */}
                    <div className={cn("panel p-4 border-2", TIER_COLORS.Medium.border, TIER_COLORS.Medium.bg)}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Shield className={cn("h-4 w-4", TIER_COLORS.Medium.text)} />
                                <span className={cn("font-bold text-sm", TIER_COLORS.Medium.text)}>Medium Risk</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground">{lowMax.toFixed(2)} – {mediumMax.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">Proceed with additional verification / step-up.</p>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step-up method</label>
                            <div className="flex gap-2">
                                {[
                                    { value: "otp", label: "OTP" },
                                    { value: "kba", label: "KBA" },
                                    { value: "document", label: "Document" },
                                ].map(opt => (
                                    <button key={opt.value}
                                        onClick={() => setMediumMethod(opt.value)}
                                        className={cn(
                                            "px-3 py-1.5 rounded text-xs font-medium border transition-colors",
                                            mediumMethod === opt.value
                                                ? "bg-warn/20 border-warn/40 text-warn"
                                                : "border-border hover:border-warn/30"
                                        )}>
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* High */}
                    <div className={cn("panel p-4 border-2", TIER_COLORS.High.border, TIER_COLORS.High.bg)}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="h-4 w-4 text-[hsl(25,95%,53%)]" />
                                <span className="font-bold text-sm text-[hsl(25,95%,53%)]">High Risk</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground">{mediumMax.toFixed(2)} – {highMax.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">Routed to manual review queue.</p>
                        <div className="flex items-center gap-2 text-xs">
                            <AlertTriangle className="h-3.5 w-3.5 text-[hsl(25,95%,53%)]" />
                            <span className="font-medium">Manual review queue</span>
                        </div>
                    </div>

                    {/* Critical */}
                    <div className={cn("panel p-4 border-2", TIER_COLORS.Critical.border, TIER_COLORS.Critical.bg)}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className={cn("h-4 w-4", TIER_COLORS.Critical.text)} />
                                <span className={cn("font-bold text-sm", TIER_COLORS.Critical.text)}>Critical Risk</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground">{highMax.toFixed(2)} – 1.00</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">Manual review queue with critical alert.</p>
                        <div className="flex items-center gap-2 text-xs mb-3">
                            <AlertTriangle className="h-3.5 w-3.5 text-down" />
                            <span className="font-medium">Manual review + critical alert escalation</span>
                        </div>
                        <div className="flex items-start gap-2 p-2.5 rounded bg-info/5 border border-info/20">
                            <Info className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                <span className="font-semibold text-info">FCRA Compliance:</span> Declining solely on fraud score violates fair lending regulations. Critical cases are routed to manual review with priority alerting — not auto-declined.
                            </p>
                        </div>
                    </div>

                    {/* Example scores */}
                    <div className="panel p-4">
                        <h3 className="panel-title mb-3">Score Examples</h3>
                        <div className="space-y-1.5">
                            {[0.12, 0.38, 0.72, 0.93].map((score) => {
                                const tier = score <= lowMax ? "Low" : score <= mediumMax ? "Medium" : score <= highMax ? "High" : "Critical";
                                const colors = TIER_COLORS[tier as keyof typeof TIER_COLORS];
                                return (
                                    <div key={score} className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded">
                                        <span className="font-mono text-xs">Score: {score.toFixed(2)}</span>
                                        <span className={cn("text-xs font-bold px-2.5 py-0.5 rounded-full border", colors.bg, colors.border, colors.text)}>
                                            {tier}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
