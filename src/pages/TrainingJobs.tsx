import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset, MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Play, Loader2, Trophy, ArrowRight, FileText, CheckCircle2, Clock, Cpu, X } from "lucide-react";
import { cn } from "@/lib/utils";

type TrainingState = 'IDLE' | 'STARTING' | 'TRAINING' | 'COMPLETED';

export default function TrainingJobs() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [selectedDataset, setSelectedDataset] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [configuration, setConfiguration] = useState<{ targetCol: string, featureCols: string[] }>({ targetCol: "", featureCols: [] });

    // Wizard State: 0 = Select Dataset, 1 = Preview, 2 = Configure
    const [wizardStep, setWizardStep] = useState<number>(0);
    const [previewData, setPreviewData] = useState<any>(null);

    // Explicit State Machine for Training Process
    const [trainingState, setTrainingState] = useState<TrainingState>('IDLE');

    // Elapsed time tracking
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Snapshot of model count before training starts
    const initialModelCountRef = useRef<number>(0);

    // Fetch Datasets
    const { data: datasets } = useQuery<Dataset[]>({
        queryKey: ["datasets", systemId],
        queryFn: async () => {
            const res = await api.get("/datasets/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // Fetch Models (Jobs)
    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
        // Poll aggressively during STARTING and TRAINING phases
        refetchInterval: (query) => {
            const anyTraining = query.state.data?.some(m => m.status === "TRAINING");

            // If we are actively polling or just starting, poll every 1s
            if (trainingState === 'STARTING' || trainingState === 'TRAINING') return 1000;

            // If we passively see something training (e.g. page refresh), also poll
            if (anyTraining) return 1000;

            return false;
        }
    });

    // Elapsed time effect
    useEffect(() => {
        if (trainingState === 'STARTING' || trainingState === 'TRAINING') {
            if (!startTimeRef.current) {
                startTimeRef.current = Date.now();
            }
            timerRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (trainingState === 'IDLE') {
                startTimeRef.current = null;
                setElapsedSeconds(0);
            }
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [trainingState]);

    // State Transitions Effect
    useEffect(() => {
        if (!models) return;

        const currentCount = models.length;
        const initialCount = initialModelCountRef.current;
        const hasNewModels = currentCount > initialCount;
        const hasTrainingModels = models.some(m => m.status === "TRAINING");

        if (trainingState === 'STARTING') {
            // We only transition if we see a NEW model appear
            if (hasNewModels) {
                // Determine if the new model is already done or still training
                if (hasTrainingModels) {
                    setTrainingState('TRAINING');
                } else {
                    // It finished instantly!
                    setTrainingState('COMPLETED');
                }
            }
        } else if (trainingState === 'TRAINING') {
            if (!hasTrainingModels) {
                // Transition to COMPLETED once all jobs finish
                setTrainingState('COMPLETED');
            }
        }
    }, [models, trainingState]);

    // Start Training Mutation
    const trainMutation = useMutation({
        mutationFn: async ({ datasetId, payload }: { datasetId: string, payload: any }) => {
            await api.post(`/models/${datasetId}/train`, payload);
        },
        onSuccess: () => {
            // Snapshot the current model count BEFORE invalidating or fetching new ones
            initialModelCountRef.current = models?.length || 0;

            queryClient.invalidateQueries({ queryKey: ["models"] });
            setError(null);
            setWizardStep(0); // Reset wizard
            setSelectedDataset("");

            // Start the State Machine
            setTrainingState('STARTING');
        },
        onError: (err) => {
            console.error(err);
            setError("Failed to start training. Please try again.");
            setTrainingState('IDLE');
        },
    });

    // Cancel/dismiss training UI (acknowledge it may still be running)
    const handleDismissTraining = () => {
        setTrainingState('IDLE');
        startTimeRef.current = null;
        setElapsedSeconds(0);
    };

    // Auto-select dataset if available and not selected
    if (datasets?.length && !selectedDataset) {
        setSelectedDataset(datasets[0].id);
    }

    const handleStartTraining = () => {
        if (!configuration.targetCol) {
            setError("Please select a target column (Y).");
            return;
        }
        if (configuration.featureCols.length === 0) {
            setError("Please select at least one feature column (X).");
            return;
        }

        trainMutation.mutate({
            datasetId: selectedDataset,
            payload: {
                target_col: configuration.targetCol,
                feature_cols: configuration.featureCols
            }
        });
    };

    const currentDataset = datasets?.find(d => d.id === selectedDataset);
    const columns = (currentDataset?.metadata_info?.columns as string[]) || [];

    // Format elapsed time
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    };

    // Determine training progress step
    const getTrainingStep = () => {
        if (trainingState === 'STARTING') return 1;
        if (trainingState === 'TRAINING') return 2;
        if (trainingState === 'COMPLETED') return 3;
        return 0;
    };

    const trainingStep = getTrainingStep();
    const isTrainingActive = trainingState === 'STARTING' || trainingState === 'TRAINING';

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Training Jobs</h1>
                <p className="text-muted-foreground mt-2">
                    Launch model training jobs on your uploaded datasets.
                </p>
            </div>

            {/* Training Progress Card - Shows during active training */}
            {isTrainingActive && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="bg-blue-100 p-3 rounded-full">
                                <Cpu className="h-6 w-6 text-blue-700 animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-blue-900">Training in Progress</h3>
                                <p className="text-blue-700 text-sm">
                                    Sentinel is training 3 models using different algorithms
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleDismissTraining}
                            className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-100 rounded-full transition-colors"
                            title="Dismiss (training will continue in background)"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Progress Steps */}
                    <div className="flex items-center gap-2 mb-6">
                        {[
                            { step: 1, label: "Request Sent", icon: CheckCircle2 },
                            { step: 2, label: "Models Training", icon: Cpu },
                            { step: 3, label: "Complete", icon: Trophy },
                        ].map((item, idx) => (
                            <div key={item.step} className="flex items-center flex-1">
                                <div className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-all flex-1",
                                    trainingStep >= item.step
                                        ? "bg-blue-600 text-white"
                                        : "bg-white/50 text-blue-400 border border-blue-200"
                                )}>
                                    <item.icon className={cn(
                                        "h-4 w-4",
                                        trainingStep === item.step && item.step < 3 && "animate-pulse"
                                    )} />
                                    <span className="text-sm font-medium">{item.label}</span>
                                </div>
                                {idx < 2 && (
                                    <div className={cn(
                                        "h-0.5 w-4 mx-1",
                                        trainingStep > item.step ? "bg-blue-600" : "bg-blue-200"
                                    )} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Elapsed Time & Status */}
                    <div className="bg-white/60 rounded-lg p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Clock className="h-5 w-5 text-blue-600" />
                            <div>
                                <p className="text-sm font-medium text-blue-900">Elapsed Time</p>
                                <p className="text-2xl font-mono font-bold text-blue-700">{formatTime(elapsedSeconds)}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-medium text-blue-900">Status</p>
                            <p className="text-sm text-blue-700">
                                {trainingState === 'STARTING' && elapsedSeconds < 30 && (
                                    "Initializing training environment..."
                                )}
                                {trainingState === 'STARTING' && elapsedSeconds >= 30 && (
                                    <span className="text-amber-600">
                                        Taking longer than usual. Models are still being created...
                                    </span>
                                )}
                                {trainingState === 'TRAINING' && (
                                    "Models are actively training. This typically takes 30-60 seconds."
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Helpful message for long waits */}
                    {trainingState === 'STARTING' && elapsedSeconds >= 45 && (
                        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                            <strong>Note:</strong> The backend is processing your request. Models will appear automatically once created.
                            You can dismiss this and check back later - training continues in the background.
                        </div>
                    )}
                </div>
            )}

            {/* Success Banner - Only show when explicitly COMPLETED */}
            {trainingState === 'COMPLETED' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center justify-between mb-8 animate-in zoom-in-95 duration-300 shadow-md">
                    <div className="flex items-center gap-4">
                        <div className="bg-green-100 p-3 rounded-full">
                            <Trophy className="h-6 w-6 text-green-700" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-green-900">Successfully Trained Models</h3>
                            <p className="text-green-800">
                                {elapsedSeconds > 0 ? `Completed in ${formatTime(elapsedSeconds)}. ` : ''}
                                Your models are ready for evaluation.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/models`)}
                        className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-bold shadow-sm flex items-center gap-2 transition-transform active:scale-95"
                    >
                        Proceed to Model Selection <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Wizard Card - Disable/Hide interaction when training is in progress */}
            {(trainingState === 'IDLE' || trainingState === 'COMPLETED') && (
                <div className="bg-card border rounded-xl p-6 shadow-sm max-w-3xl">

                    {/* Step 1: Dataset Selection (READ ONLY NOW) */}
                    {wizardStep === 0 && (
                        <div className="flex items-end gap-4 animate-in fade-in slide-in-from-left-4">
                            <div className="flex-1 space-y-2">
                                <label className="text-sm font-medium leading-none text-muted-foreground">
                                    Training Dataset
                                </label>
                                <div className="text-lg font-semibold flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-blue-600" />
                                    {currentDataset?.metadata_info?.original_filename || "Loading..."}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {currentDataset ? `${currentDataset.metadata_info?.row_count?.toLocaleString()} rows • Uploaded ${new Date(currentDataset.created_at).toLocaleDateString()}` : ""}
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!selectedDataset) return;
                                    // Fetch Preview
                                    try {
                                        const res = await api.get(`/datasets/${selectedDataset}/preview`);
                                        setPreviewData(res.data);
                                        setWizardStep(1);
                                        setError(null);
                                        setTrainingState('IDLE'); // Reset any complete state if restarting wizard
                                    } catch (e) {
                                        setError("Failed to load preview.");
                                    }
                                }}
                                disabled={!selectedDataset}
                                className="bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-6 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                Next: Preview &rarr;
                            </button>
                        </div>
                    )}

                    {/* Step 2: Preview & Confirmation */}
                    {wizardStep === 1 && previewData && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="flex items-center justify-between border-b pb-4">
                                <h3 className="font-semibold text-lg">2. Preview Dataset</h3>
                                {/* Removed Change Dataset Button */}
                            </div>

                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    Verify that the data looks correct. Showing first 5 rows.
                                </p>

                                <div className="border rounded-md overflow-x-auto bg-muted/10">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-muted text-muted-foreground">
                                            <tr>
                                                {previewData.columns.map((c: any) => (
                                                    <th key={c.name} className="px-3 py-2 font-medium whitespace-nowrap">
                                                        {c.name} <span className="text-[10px] text-gray-500 font-normal">({c.type})</span>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.rows.map((row: any, i: number) => (
                                                <tr key={i} className="border-t border-muted/20">
                                                    {previewData.columns.map((c: any) => (
                                                        <td key={c.name} className="px-3 py-2 whitespace-nowrap">
                                                            {row[c.name]}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-end pt-4">
                                    <button
                                        onClick={() => setWizardStep(2)}
                                        className="bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-6 py-2 rounded-md text-sm font-medium transition-colors"
                                    >
                                        Confirm & Configure &rarr;
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Configuration */}
                    {wizardStep === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="flex items-center justify-between border-b pb-4">
                                <h3 className="font-semibold text-lg">3. Configure Training Job</h3>
                            </div>

                            {columns.length === 0 ? (
                                <div className="p-4 bg-yellow-50 text-yellow-800 rounded-md text-sm">
                                    Warning: No column information found. You may need to re-upload this dataset.
                                    <br />
                                    <button onClick={handleStartTraining} className="mt-2 underline font-bold">Try Training with Defaults</button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-8">
                                    {/* Target (Y) */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-bold flex items-center gap-2">
                                            Target Variable (Y)
                                            <span className="text-xs font-normal text-muted-foreground">(The outcome to predict)</span>
                                        </label>
                                        <div className="p-1 max-h-[300px] overflow-y-auto border rounded-md">
                                            {columns.map(col => (
                                                <label key={`target-${col}`} className={cn(
                                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm",
                                                    configuration.targetCol === col ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"
                                                )}>
                                                    <input
                                                        type="radio"
                                                        name="targetCol"
                                                        value={col}
                                                        checked={configuration.targetCol === col}
                                                        onChange={(e) => setConfiguration(prev => ({
                                                            ...prev,
                                                            targetCol: e.target.value,
                                                            // Remove from features if selected as target
                                                            featureCols: prev.featureCols.filter(c => c !== e.target.value)
                                                        }))}
                                                        className="accent-primary"
                                                    />
                                                    {col}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Features (X) */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-bold flex items-center gap-2">
                                            Feature Variables (X)
                                            <span className="text-xs font-normal text-muted-foreground">(Inputs for prediction)</span>
                                        </label>
                                        <div className="flex items-center justify-between text-xs px-1">
                                            <span className="text-muted-foreground">{configuration.featureCols.length} selected</span>
                                            <button
                                                onClick={() => setConfiguration(prev => ({ ...prev, featureCols: columns.filter(c => c !== prev.targetCol) }))}
                                                className="text-primary hover:underline"
                                            >Select All</button>
                                        </div>
                                        <div className="p-1 max-h-[300px] overflow-y-auto border rounded-md bg-muted/10">
                                            {columns.filter(c => c !== configuration.targetCol).map(col => (
                                                <label key={`feature-${col}`} className={cn(
                                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm",
                                                    configuration.featureCols.includes(col) ? "bg-white shadow-sm" : "hover:bg-muted/50"
                                                )}>
                                                    <input
                                                        type="checkbox"
                                                        value={col}
                                                        checked={configuration.featureCols.includes(col)}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            setConfiguration(prev => ({
                                                                ...prev,
                                                                featureCols: checked
                                                                    ? [...prev.featureCols, col]
                                                                    : prev.featureCols.filter(c => c !== col)
                                                            }));
                                                        }}
                                                        className="accent-primary rounded"
                                                    />
                                                    {col}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Configuration Summary & Action */}
                            <div className="pt-6 border-t space-y-6">

                                {/* New: Algorithms & Split Info (Static) */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Algorithms</div>
                                        <ul className="text-sm list-disc list-inside space-y-1">
                                            <li>Logistic Regression (Baseline)</li>
                                            <li>Random Forest (Ensemble)</li>
                                            <li>XGBoost (Gradient Boosting)</li>
                                        </ul>
                                    </div>
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Validation Split</div>
                                        <div className="flex items-center gap-2 text-sm mb-2">
                                            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden flex">
                                                <div className="h-full bg-blue-500 w-[80%]"></div>
                                                <div className="h-full bg-orange-500 w-[20%]"></div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>80% Training</span>
                                            <span>20% Validation</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Sentinel will train multiple models and recommend the best performer based on AUC on the validation set.
                                    </p>
                                    <button
                                        onClick={handleStartTraining}
                                        disabled={trainMutation.isPending}
                                        className={cn(
                                            "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                                            "bg-primary text-primary-foreground shadow hover:bg-primary/90",
                                            "h-10 px-8 py-2"
                                        )}
                                    >
                                        {trainMutation.isPending ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Training...
                                            </>
                                        ) : (
                                            <>
                                                <Play className="mr-2 h-4 w-4" /> Start Training
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-md text-sm font-medium">{error}</div>}
                </div>
            )}

            {/* Models List (Refined to Card Layout) */}
            <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-lg">Active Jobs & Results</h3>
                </div>

                {models && models.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(() => {
                            // Find best model by AUC
                            const bestModel = [...models].sort((a, b) => (b.metrics?.auc || 0) - (a.metrics?.auc || 0))[0];
                            const isCompletedPhase = trainingState === 'COMPLETED';

                            return models.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((m) => (
                                <div key={m.id} className="bg-card border rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow relative">
                                    {isCompletedPhase && m.id === bestModel?.id && m.metrics?.auc && (
                                        <span className="absolute -top-2 -right-2 bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm uppercase tracking-wider">
                                            Recommended
                                        </span>
                                    )}
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h4 className="font-bold text-base capitalize">{m.algorithm?.replace("_", " ")}</h4>
                                            <p className="text-xs text-muted-foreground font-mono mt-1">{m.name}</p>
                                        </div>
                                        <span className={cn(
                                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                                            m.status === "TRAINING" && "bg-blue-100 text-blue-800 animate-pulse",
                                            m.status === "CANDIDATE" && "bg-gray-100 text-gray-800",
                                            m.status === "ACTIVE" && "bg-green-100 text-green-800",
                                            m.status === "FAILED" && "bg-red-100 text-red-800",
                                        )}>
                                            {m.status === "TRAINING" ? "IN PROGRESS" : m.status}
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-end">
                                            <span className="text-sm text-muted-foreground">AUC (Performance)</span>
                                            <span className={cn(
                                                "text-2xl font-bold",
                                                (m.metrics?.auc || 0) > 0.8 ? "text-green-600" : "text-gray-900"
                                            )}>
                                                {m.metrics?.auc ? (m.metrics.auc * 100).toFixed(1) + "%" : "--"}
                                            </span>
                                        </div>
                                        {/* Progress Bar for AUC */}
                                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-green-500 rounded-full transition-all duration-500"
                                                style={{ width: `${(m.metrics?.auc || 0) * 100}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(m.created_at).toLocaleTimeString()}
                                        </span>
                                        {m.status !== "TRAINING" && m.status !== "FAILED" && (
                                            <button
                                                /* Navigate to Model Detail */
                                                onClick={() => navigate(`/systems/${systemId}/models/${m.id}`)}
                                                className="text-sm font-medium text-primary hover:underline"
                                            >
                                                View Details &rarr;
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        })()}
                    </div>
                ) : (
                    // Only show "No training jobs" if we are IDLE and not actively training
                    !isTrainingActive && (
                        <div className="p-12 text-center bg-gray-50 rounded-xl border border-dashed">
                            <div className="bg-muted/30 rounded-full h-14 w-14 flex items-center justify-center mx-auto mb-4">
                                <Play className="h-7 w-7 text-muted-foreground/50" />
                            </div>
                            <h3 className="text-base font-semibold text-foreground mb-2">No Training Jobs Yet</h3>
                            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                                {datasets && datasets.length > 0
                                    ? "Use the wizard above to configure and start your first training job."
                                    : "Upload a dataset first, then return here to train models."}
                            </p>
                            {(!datasets || datasets.length === 0) && (
                                <button
                                    onClick={() => navigate(`/systems/${systemId}/datasets`)}
                                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                                >
                                    <FileText className="h-4 w-4" />
                                    Upload Dataset First
                                </button>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
