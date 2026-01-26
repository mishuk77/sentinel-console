import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { useSystem } from "@/lib/hooks";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { DollarSign, AlertTriangle, Sparkles, RefreshCw, TrendingDown, Shield, ArrowRight, Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Generate simulated risk-amount matrix data
// In production, this would come from backend analysis
const generateRiskAmountMatrix = (calibration: any[]) => {
    const amountBuckets = [10000, 20000, 30000, 40000, 50000];
    const matrix: Record<number, Record<number, number>> = {};

    // For each decile, calculate risk at different amounts
    // Higher amounts amplify risk for higher deciles
    calibration.forEach((bin: any) => {
        const decile = bin.decile;
        const baseRate = bin.actual_rate;
        matrix[decile] = {};

        amountBuckets.forEach((amount, idx) => {
            // Risk increases with amount, more so for higher deciles
            const amountMultiplier = 1 + (idx * 0.15 * (decile / 5));
            matrix[decile][amount] = Math.min(baseRate * amountMultiplier, 1);
        });
    });

    return { matrix, amountBuckets };
};

// Get color intensity based on risk
const getRiskBgOpacity = (risk: number): string => {
    const intensity = Math.min(risk * 1.2, 1);
    return `rgba(239, 68, 68, ${intensity * 0.6})`;
};

export default function ExposureControl() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const { system } = useSystem();

    const [amountLadder, setAmountLadder] = useState<Record<string, number>>({
        "1": 50000, "2": 45000, "3": 40000, "4": 35000, "5": 30000,
        "6": 25000, "7": 20000, "8": 15000, "9": 10000, "10": 5000
    });
    const [isGeneratingAmounts, setIsGeneratingAmounts] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Fetch the active model
    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const activeModel = models?.find(m => m.id === system?.active_model_id);
    const calibration = activeModel?.metrics?.calibration || [];

    // Generate risk-amount matrix
    const { matrix: riskMatrix, amountBuckets } = useMemo(() => {
        if (!calibration.length) return { matrix: {}, amountBuckets: [] };
        return generateRiskAmountMatrix(calibration);
    }, [calibration]);

    // Calculate impact metrics
    const impactMetrics = useMemo(() => {
        if (!calibration.length) return null;

        let currentTotalExposure = 0;
        let proposedTotalExposure = 0;
        let currentWeightedLoss = 0;
        let proposedWeightedLoss = 0;

        calibration.forEach((bin: any) => {
            const decile = bin.decile;
            const count = bin.count;
            const baseRate = bin.actual_rate;

            // Current: assume max amount ($50k) for everyone
            const currentAmount = 50000;
            currentTotalExposure += count * currentAmount;
            currentWeightedLoss += count * currentAmount * baseRate;

            // Proposed: use ladder amounts
            const proposedAmount = amountLadder[String(decile)] || 0;
            proposedTotalExposure += count * proposedAmount;

            // Adjusted loss rate based on amount (simplified model)
            const amountRatio = proposedAmount / 50000;
            const adjustedRate = baseRate * (0.7 + 0.3 * amountRatio);
            proposedWeightedLoss += count * proposedAmount * adjustedRate;
        });

        const currentLossRate = currentWeightedLoss / currentTotalExposure;
        const proposedLossRate = proposedWeightedLoss / proposedTotalExposure;

        return {
            currentAvgAmount: currentTotalExposure / calibration.reduce((sum: number, b: any) => sum + b.count, 0),
            proposedAvgAmount: proposedTotalExposure / calibration.reduce((sum: number, b: any) => sum + b.count, 0),
            currentLossRate,
            proposedLossRate,
            lossReduction: ((currentLossRate - proposedLossRate) / currentLossRate) * 100,
            exposureReduction: ((currentTotalExposure - proposedTotalExposure) / currentTotalExposure) * 100
        };
    }, [calibration, amountLadder]);

    // Generate AI recommendations using client-side logic based on calibration data
    const generateAmountRecommendations = () => {
        if (!activeModel || !calibration.length) return;
        setIsGeneratingAmounts(true);

        // Simulate async processing for UX
        setTimeout(() => {
            // Calculate recommendations based on risk rates
            // Lower risk deciles get higher amounts, higher risk deciles get lower amounts
            const maxAmount = 50000;
            const minAmount = 5000;

            // Sort calibration by decile
            const sortedCalibration = [...calibration].sort((a: any, b: any) => a.decile - b.decile);

            // Find min and max risk rates for normalization
            const riskRates = sortedCalibration.map((bin: any) => bin.actual_rate);
            const minRisk = Math.min(...riskRates);
            const maxRisk = Math.max(...riskRates);
            const riskRange = maxRisk - minRisk || 1;

            const newLadder: Record<string, number> = {};

            sortedCalibration.forEach((bin: any) => {
                const decile = bin.decile;
                const riskRate = bin.actual_rate;

                // Normalize risk to 0-1 scale
                const normalizedRisk = (riskRate - minRisk) / riskRange;

                // Inverse relationship: higher risk = lower amount
                // Use exponential decay for more aggressive reduction at high risk
                const riskFactor = Math.pow(1 - normalizedRisk, 1.5);

                // Calculate amount: scale between min and max
                const amount = Math.round((minAmount + (maxAmount - minAmount) * riskFactor) / 1000) * 1000;

                newLadder[String(decile)] = amount;
            });

            setAmountLadder(newLadder);
            setIsGeneratingAmounts(false);
        }, 800); // Brief delay for perceived processing
    };

    // Save exposure settings
    const saveMutation = useMutation({
        mutationFn: async () => {
            // Update the active policy with new amount ladder
            await api.post("/policies/update-exposure", {
                decision_system_id: systemId,
                amount_ladder: amountLadder
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        },
        onError: (err) => {
            console.error("Failed to save exposure settings:", err);
        }
    });

    // Update individual amount
    const updateAmount = (decile: string, amount: number) => {
        setAmountLadder(prev => ({
            ...prev,
            [decile]: Math.max(0, amount)
        }));
    };

    if (!activeModel) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
                    <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-yellow-900 mb-2">No Active Model</h2>
                    <p className="text-yellow-800 mb-4">
                        You need an active policy before configuring exposure controls.
                    </p>
                    <Link
                        to={`/systems/${systemId}/policy`}
                        className="inline-flex items-center gap-2 bg-yellow-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-yellow-700 transition-colors"
                    >
                        Configure Policy First <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Exposure Control</h1>
                <p className="text-muted-foreground mt-2">
                    Manage loan amounts by risk segment to optimize risk-adjusted returns.
                </p>
            </div>

            {/* Educational Banner */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
                <div className="flex items-start gap-4">
                    <div className="bg-blue-100 p-2 rounded-full shrink-0">
                        <Info className="h-5 w-5 text-blue-700" />
                    </div>
                    <div>
                        <h3 className="font-bold text-blue-900 mb-1">Why This Matters</h3>
                        <p className="text-blue-800 text-sm">
                            Higher-risk borrowers with larger loans have disproportionately higher default rates.
                            A <strong>Decile 10</strong> borrower at <strong>$50k</strong> has up to <strong>3x the loss exposure</strong> of
                            the same borrower at <strong>$15k</strong>. By setting per-decile amount limits, you can
                            maintain approval rates while significantly reducing portfolio losses.
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Content - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Controls */}
                <div className="space-y-6">
                    {/* Amount Ladder Configuration */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2">
                                <DollarSign className="h-5 w-5 text-primary" />
                                Amount Ladder
                            </h3>
                            <button
                                onClick={generateAmountRecommendations}
                                disabled={isGeneratingAmounts}
                                className="inline-flex items-center gap-2 rounded-md text-xs font-medium h-8 px-3 border border-primary/30 text-primary hover:bg-primary/5 transition-colors"
                            >
                                {isGeneratingAmounts ? (
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                    <Sparkles className="h-3 w-3" />
                                )}
                                {isGeneratingAmounts ? "Generating..." : "AI Recommend"}
                            </button>
                        </div>

                        <p className="text-sm text-muted-foreground mb-4">
                            Set maximum loan amounts per risk decile. Lower values for higher-risk segments reduce exposure.
                        </p>

                        <div className="space-y-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(decile => (
                                <div key={decile} className="flex items-center gap-3">
                                    <span className={cn(
                                        "text-xs font-bold w-8 text-center rounded py-1",
                                        decile <= 3 ? "bg-green-100 text-green-800" :
                                            decile <= 7 ? "bg-yellow-100 text-yellow-800" :
                                                "bg-red-100 text-red-800"
                                    )}>
                                        D{decile}
                                    </span>
                                    <input
                                        type="range"
                                        min={0}
                                        max={50000}
                                        step={1000}
                                        value={amountLadder[String(decile)] || 0}
                                        onChange={(e) => updateAmount(String(decile), Number(e.target.value))}
                                        className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                                    />
                                    <div className="w-24 flex items-center gap-1">
                                        <span className="text-muted-foreground text-xs">$</span>
                                        <input
                                            type="number"
                                            className="w-full h-7 rounded border border-input bg-background px-2 text-xs font-mono text-right"
                                            value={amountLadder[String(decile)] || 0}
                                            onChange={(e) => updateAmount(String(decile), Number(e.target.value))}
                                            step={1000}
                                            min={0}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Impact Simulation */}
                    {impactMetrics && (
                        <div className="bg-card border rounded-xl p-6 shadow-sm">
                            <h3 className="font-semibold mb-4 flex items-center gap-2">
                                <TrendingDown className="h-5 w-5 text-green-600" />
                                Impact Simulation
                            </h3>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-muted/30 rounded-lg">
                                    <p className="text-xs text-muted-foreground uppercase font-medium mb-1">Current (No Limits)</p>
                                    <p className="text-lg font-bold">${Math.round(impactMetrics.currentAvgAmount).toLocaleString()}</p>
                                    <p className="text-sm text-muted-foreground">avg. amount</p>
                                    <p className="text-red-600 font-semibold mt-2">
                                        {(impactMetrics.currentLossRate * 100).toFixed(2)}% loss
                                    </p>
                                </div>
                                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                                    <p className="text-xs text-green-700 uppercase font-medium mb-1">With Ladder</p>
                                    <p className="text-lg font-bold text-green-900">${Math.round(impactMetrics.proposedAvgAmount).toLocaleString()}</p>
                                    <p className="text-sm text-green-700">avg. amount</p>
                                    <p className="text-green-700 font-semibold mt-2">
                                        {(impactMetrics.proposedLossRate * 100).toFixed(2)}% loss
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
                                <div className="grid grid-cols-2 gap-4 text-center">
                                    <div>
                                        <p className="text-2xl font-bold text-green-700">
                                            -{impactMetrics.lossReduction.toFixed(0)}%
                                        </p>
                                        <p className="text-xs text-green-600 font-medium">Loss Reduction</p>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-amber-600">
                                            -{impactMetrics.exposureReduction.toFixed(0)}%
                                        </p>
                                        <p className="text-xs text-amber-600 font-medium">Exposure Reduction</p>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending}
                                className={cn(
                                    "w-full mt-4 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors h-10 px-4",
                                    saveSuccess
                                        ? "bg-green-600 text-white"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                            >
                                {saveMutation.isPending ? "Saving..." : saveSuccess ? (
                                    <>Saved! <Check className="ml-2 h-4 w-4" /></>
                                ) : (
                                    <>
                                        <Shield className="mr-2 h-4 w-4" />
                                        Save Exposure Settings
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Right: Visualizations */}
                <div className="space-y-6">
                    {/* Risk-Amount Heatmap */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold mb-4">Risk-Amount Matrix</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Darker cells indicate higher loss rates. Your limits cut off exposure in the danger zone.
                        </p>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr>
                                        <th className="p-2 text-left font-medium text-muted-foreground"></th>
                                        {amountBuckets.map(amount => (
                                            <th key={amount} className="p-2 text-center font-medium text-muted-foreground">
                                                ${(amount / 1000)}k
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(decile => (
                                        <tr key={decile}>
                                            <td className="p-2 font-bold">D{decile}</td>
                                            {amountBuckets.map(amount => {
                                                const risk = riskMatrix[decile]?.[amount] || 0;
                                                const limit = amountLadder[String(decile)] || 0;
                                                const isAboveLimit = amount > limit;

                                                return (
                                                    <td key={amount} className="p-1">
                                                        <div
                                                            className={cn(
                                                                "h-10 w-full rounded flex items-center justify-center font-mono text-[10px] relative transition-all",
                                                                isAboveLimit
                                                                    ? "bg-muted/30 text-muted-foreground line-through opacity-50"
                                                                    : ""
                                                            )}
                                                            style={{
                                                                backgroundColor: isAboveLimit ? undefined : getRiskBgOpacity(risk),
                                                                color: isAboveLimit ? undefined : risk > 0.5 ? 'white' : 'inherit'
                                                            }}
                                                        >
                                                            {(risk * 100).toFixed(0)}%
                                                            {isAboveLimit && (
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <div className="h-[1px] w-full bg-muted-foreground/50 rotate-[-15deg]" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <div className="w-4 h-4 rounded" style={{ backgroundColor: getRiskBgOpacity(0.2) }} />
                                <span>Low Risk</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-4 h-4 rounded" style={{ backgroundColor: getRiskBgOpacity(0.5) }} />
                                <span>Medium</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-4 h-4 rounded" style={{ backgroundColor: getRiskBgOpacity(0.8) }} />
                                <span>High Risk</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-4 h-4 rounded bg-muted/30 relative">
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="h-[1px] w-full bg-muted-foreground/50 rotate-[-15deg]" />
                                    </div>
                                </div>
                                <span>Cut Off</span>
                            </div>
                        </div>
                    </div>

                    {/* Ladder Visualization */}
                    <div className="bg-card border rounded-xl p-6 shadow-sm">
                        <h3 className="font-semibold mb-4">Exposure Ladder</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Visual representation of your amount limits by decile.
                        </p>

                        <div className="space-y-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(decile => {
                                const amount = amountLadder[String(decile)] || 0;
                                const percentage = (amount / 50000) * 100;

                                return (
                                    <div key={decile} className="flex items-center gap-2">
                                        <span className="text-xs font-mono w-6 text-muted-foreground">D{decile}</span>
                                        <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden relative">
                                            <div
                                                className={cn(
                                                    "h-full rounded-full transition-all duration-300",
                                                    decile <= 3 ? "bg-gradient-to-r from-green-400 to-green-500" :
                                                        decile <= 7 ? "bg-gradient-to-r from-yellow-400 to-yellow-500" :
                                                            "bg-gradient-to-r from-red-400 to-red-500"
                                                )}
                                                style={{ width: `${percentage}%` }}
                                            />
                                            <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-mono font-bold text-muted-foreground">
                                                ${(amount / 1000).toFixed(0)}k
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-between mt-4 text-xs text-muted-foreground border-t pt-4">
                            <span>$0</span>
                            <span>$25k</span>
                            <span>$50k</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
