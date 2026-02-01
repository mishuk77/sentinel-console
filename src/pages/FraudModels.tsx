import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
    getFraudModels,
    createFraudModel,
    activateFraudModel,
    FRAUD_MODEL_FEATURES,
} from "@/lib/fraudData";
import type { FraudModel, FraudModelAlgorithm } from "@/lib/api";
import {
    Brain,
    Plus,
    Play,
    CheckCircle2,
    Clock,
    Archive,
    AlertTriangle,
    X,
    Target,
    BarChart3,
    RefreshCw,
    Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    ResponsiveContainer,
    Tooltip,
} from "recharts";

const STATUS_CONFIG: Record<FraudModel["status"], { color: string; icon: typeof Clock; label: string }> = {
    training: { color: "bg-blue-100 text-blue-700", icon: RefreshCw, label: "Training" },
    validating: { color: "bg-purple-100 text-purple-700", icon: Clock, label: "Validating" },
    ready: { color: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Ready" },
    active: { color: "bg-emerald-100 text-emerald-700", icon: Zap, label: "Active" },
    archived: { color: "bg-gray-100 text-gray-600", icon: Archive, label: "Archived" },
    failed: { color: "bg-red-100 text-red-700", icon: AlertTriangle, label: "Failed" },
};

const ALGORITHM_LABELS: Record<FraudModelAlgorithm, string> = {
    gradient_boosting: "Gradient Boosting",
    random_forest: "Random Forest",
    neural_network: "Neural Network",
    ensemble: "Ensemble (Multi-Model)",
};

interface TrainingModalProps {
    onClose: () => void;
    onSubmit: (data: {
        name: string;
        description: string;
        algorithm: FraudModelAlgorithm;
        features: string[];
    }) => void;
}

function TrainingModal({ onClose, onSubmit }: TrainingModalProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [algorithm, setAlgorithm] = useState<FraudModelAlgorithm>("gradient_boosting");
    const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
        "fraud_score", "device_fingerprint_age", "ip_risk_score", "ssn_velocity"
    ]);

    const featuresByCategory = FRAUD_MODEL_FEATURES.reduce((acc, f) => {
        if (!acc[f.category]) acc[f.category] = [];
        acc[f.category].push(f);
        return acc;
    }, {} as Record<string, typeof FRAUD_MODEL_FEATURES>);

    const toggleFeature = (featureId: string) => {
        setSelectedFeatures(prev =>
            prev.includes(featureId)
                ? prev.filter(f => f !== featureId)
                : [...prev, featureId]
        );
    };

    const handleSubmit = () => {
        if (!name.trim() || selectedFeatures.length < 3) return;
        onSubmit({ name, description, algorithm, features: selectedFeatures });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-600" />
                        Train New Fraud Model
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium block mb-1">Model Name *</label>
                            <input
                                type="text"
                                className="w-full h-10 px-3 border rounded-lg text-sm"
                                placeholder="e.g., Fraud Detection v4.0"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium block mb-1">Algorithm</label>
                            <select
                                className="w-full h-10 px-3 border rounded-lg text-sm"
                                value={algorithm}
                                onChange={(e) => setAlgorithm(e.target.value as FraudModelAlgorithm)}
                            >
                                {Object.entries(ALGORITHM_LABELS).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium block mb-1">Description</label>
                        <textarea
                            className="w-full h-20 px-3 py-2 border rounded-lg text-sm resize-none"
                            placeholder="Describe the purpose and approach of this model..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    {/* Feature Selection */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-medium">
                                Select Features ({selectedFeatures.length} selected)
                            </label>
                            <span className="text-xs text-muted-foreground">
                                Minimum 3 features required
                            </span>
                        </div>

                        <div className="border rounded-lg divide-y">
                            {Object.entries(featuresByCategory).map(([category, features]) => (
                                <div key={category} className="p-4">
                                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">
                                        {category}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {features.map((feature) => (
                                            <button
                                                key={feature.id}
                                                onClick={() => toggleFeature(feature.id)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                                                    selectedFeatures.includes(feature.id)
                                                        ? "bg-purple-100 text-purple-800 border-2 border-purple-300"
                                                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                                                )}
                                            >
                                                {feature.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Training Info */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800">
                            <strong>Training will use:</strong> Historical fraud-labeled data from the last 12 months.
                            Model will be validated against a 20% holdout set. Estimated training time: 5-10 minutes.
                        </p>
                    </div>
                </div>

                <div className="p-6 border-t flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!name.trim() || selectedFeatures.length < 3}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        <Play className="h-4 w-4" />
                        Start Training
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function FraudModels() {
    const { systemId } = useParams<{ systemId: string }>();
    const [models, setModels] = useState<FraudModel[]>([]);
    const [showTrainingModal, setShowTrainingModal] = useState(false);
    const [selectedModel, setSelectedModel] = useState<FraudModel | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        setModels(getFraudModels(systemId || ""));
    }, [systemId, refreshKey]);

    // Refresh periodically to catch training completion
    useEffect(() => {
        const interval = setInterval(() => {
            setRefreshKey(k => k + 1);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleTrainModel = (data: {
        name: string;
        description: string;
        algorithm: FraudModelAlgorithm;
        features: string[];
    }) => {
        createFraudModel(systemId || "", {
            name: data.name,
            description: data.description,
            algorithm: data.algorithm,
            training_config: {
                features: data.features,
                target_variable: "is_fraud",
                train_test_split: 0.8,
                hyperparameters: {},
            },
        });
        setRefreshKey(k => k + 1);
    };

    const handleActivate = (model: FraudModel) => {
        activateFraudModel(model.id);
        setRefreshKey(k => k + 1);
    };

    const activeModel = models.find(m => m.is_active);

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        <Brain className="h-8 w-8 text-purple-600" />
                        Fraud Models
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Train and manage machine learning models for fraud detection.
                    </p>
                </div>
                <button
                    onClick={() => setShowTrainingModal(true)}
                    className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 transition-colors"
                >
                    <Plus className="h-4 w-4" /> Train New Model
                </button>
            </div>

            {/* Training Modal */}
            {showTrainingModal && (
                <TrainingModal
                    onClose={() => setShowTrainingModal(false)}
                    onSubmit={handleTrainModel}
                />
            )}

            {/* Active Model Banner */}
            {activeModel && (
                <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-5 w-5 text-emerald-600" />
                                <span className="text-sm font-medium text-emerald-700 uppercase">Active Model</span>
                            </div>
                            <h3 className="text-xl font-bold text-emerald-900">{activeModel.name}</h3>
                            <p className="text-sm text-emerald-700 mt-1">{activeModel.description}</p>
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-2xl font-bold text-emerald-700">
                                    {((activeModel.metrics?.auc || 0) * 100).toFixed(1)}%
                                </p>
                                <p className="text-xs text-emerald-600">AUC</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-700">
                                    {((activeModel.metrics?.detection_rate || 0) * 100).toFixed(0)}%
                                </p>
                                <p className="text-xs text-emerald-600">Detection</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-700">
                                    {((activeModel.metrics?.false_positive_rate || 0) * 100).toFixed(1)}%
                                </p>
                                <p className="text-xs text-emerald-600">FPR</p>
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-emerald-700">
                                    {activeModel.metrics?.lift_at_10_percent?.toFixed(1)}x
                                </p>
                                <p className="text-xs text-emerald-600">Lift @10%</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Model List */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold">All Models</h2>

                {models.map((model) => {
                    const statusConfig = STATUS_CONFIG[model.status];
                    const StatusIcon = statusConfig.icon;

                    return (
                        <div
                            key={model.id}
                            className={cn(
                                "bg-card border rounded-xl overflow-hidden transition-all",
                                selectedModel?.id === model.id ? "ring-2 ring-purple-500" : ""
                            )}
                        >
                            {/* Model Header */}
                            <div
                                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => setSelectedModel(selectedModel?.id === model.id ? null : model)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={cn("p-2 rounded-lg", statusConfig.color)}>
                                            {model.status === "training" ? (
                                                <RefreshCw className="h-5 w-5 animate-spin" />
                                            ) : (
                                                <StatusIcon className="h-5 w-5" />
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold">{model.name}</h3>
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-xs font-medium",
                                                    statusConfig.color
                                                )}>
                                                    {statusConfig.label}
                                                </span>
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    v{model.version}
                                                </span>
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-0.5">
                                                {ALGORITHM_LABELS[model.algorithm]}
                                            </p>
                                        </div>
                                    </div>

                                    {model.metrics && (
                                        <div className="flex items-center gap-6 text-sm">
                                            <div className="text-center">
                                                <p className="font-bold">{((model.metrics.auc || 0) * 100).toFixed(1)}%</p>
                                                <p className="text-xs text-muted-foreground">AUC</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="font-bold">{((model.metrics.precision || 0) * 100).toFixed(0)}%</p>
                                                <p className="text-xs text-muted-foreground">Precision</p>
                                            </div>
                                            <div className="text-center">
                                                <p className="font-bold">{((model.metrics.recall || 0) * 100).toFixed(0)}%</p>
                                                <p className="text-xs text-muted-foreground">Recall</p>
                                            </div>
                                        </div>
                                    )}

                                    {!model.is_active && model.status === "ready" && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleActivate(model);
                                            }}
                                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
                                        >
                                            Activate
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Expanded Details */}
                            {selectedModel?.id === model.id && model.metrics && (
                                <div className="border-t p-6 bg-muted/20">
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Metrics */}
                                        <div>
                                            <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                                                <Target className="h-4 w-4" />
                                                Performance Metrics
                                            </h4>
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{((model.metrics.auc) * 100).toFixed(1)}%</p>
                                                    <p className="text-xs text-muted-foreground">AUC-ROC</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{((model.metrics.precision) * 100).toFixed(0)}%</p>
                                                    <p className="text-xs text-muted-foreground">Precision</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{((model.metrics.recall) * 100).toFixed(0)}%</p>
                                                    <p className="text-xs text-muted-foreground">Recall</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{((model.metrics.f1_score) * 100).toFixed(0)}%</p>
                                                    <p className="text-xs text-muted-foreground">F1 Score</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{((model.metrics.false_positive_rate) * 100).toFixed(1)}%</p>
                                                    <p className="text-xs text-muted-foreground">FPR</p>
                                                </div>
                                                <div className="bg-card border rounded-lg p-3 text-center">
                                                    <p className="text-xl font-bold">{model.metrics.lift_at_10_percent.toFixed(1)}x</p>
                                                    <p className="text-xs text-muted-foreground">Lift @10%</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Feature Importance */}
                                        <div>
                                            <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                                                <BarChart3 className="h-4 w-4" />
                                                Feature Importance
                                            </h4>
                                            <div className="h-[200px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <BarChart
                                                        data={model.feature_importance?.slice(0, 7).map(f => ({
                                                            ...f,
                                                            importance: f.importance * 100,
                                                        }))}
                                                        layout="vertical"
                                                    >
                                                        <XAxis type="number" domain={[0, 100]} hide />
                                                        <YAxis
                                                            dataKey="feature"
                                                            type="category"
                                                            width={120}
                                                            tick={{ fontSize: 11 }}
                                                        />
                                                        <Tooltip
                                                            formatter={(value) => value != null ? `${Number(value).toFixed(1)}%` : ''}
                                                        />
                                                        <Bar dataKey="importance" fill="#9333ea" radius={[0, 4, 4, 0]} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Training Info */}
                                    <div className="mt-6 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                                        <div className="flex items-center gap-6">
                                            <span>Training Samples: <strong className="text-foreground">{model.training_samples.toLocaleString()}</strong></span>
                                            <span>Fraud Samples: <strong className="text-foreground">{model.fraud_samples.toLocaleString()}</strong></span>
                                            <span>Fraud Rate: <strong className="text-foreground">{((model.fraud_samples / model.training_samples) * 100).toFixed(2)}%</strong></span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span>Created: {new Date(model.created_at).toLocaleDateString()}</span>
                                            {model.trained_at && (
                                                <span>Trained: {new Date(model.trained_at).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {models.length === 0 && (
                    <div className="border rounded-xl p-12 text-center text-muted-foreground">
                        <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p className="font-medium">No fraud models yet</p>
                        <p className="text-sm mt-1">Train your first model to start detecting fraud with ML.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
