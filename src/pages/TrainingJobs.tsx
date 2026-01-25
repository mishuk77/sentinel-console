import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset, MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Play, Loader2, Trophy, ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

type TrainingState = 'IDLE' | 'STARTING' | 'POLLING' | 'COMPLETED';

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

    // Safety timer ref
    const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // Poll aggressively during STARTING and POLLING phases
        refetchInterval: (query) => {
            const anyTraining = query.state.data?.some(m => m.status === "TRAINING");

            // If we are actively polling or just starting, poll every 1s
            if (trainingState === 'STARTING' || trainingState === 'POLLING') return 1000;

            // If we passively see something training (e.g. page refresh), also poll
            if (anyTraining) return 1000;

            return false;
        }
    });

    // State Transitions Effect
    useEffect(() => {
        if (!models) return;

        const currentCount = models.length;
        const initialCount = initialModelCountRef.current;
        const hasNewModels = currentCount > initialCount;
        const hasTrainingModels = models.some(m => m.status === "TRAINING");

        if (trainingState === 'STARTING') {
            // We only transition if we see a NEW model appear.
            if (hasNewModels) {
                // Determine if the new model is already done or still training
                if (hasTrainingModels) {
                    setTrainingState('POLLING');
                } else {
                    // It finished instantly!
                    setTrainingState('COMPLETED');
                }

                // Clear safety timer as we have success
                if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
            }
        } else if (trainingState === 'POLLING') {
            if (!hasTrainingModels) {
                // Transition to COMPLETED once all jobs finish
                setTrainingState('COMPLETED');
            }
        }
    }, [models, trainingState]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        };
    }, []);

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

            // Safety: If we don't see models appear within 20s, reset state to avoid infinite loading
            if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
            safetyTimerRef.current = setTimeout(() => {
                setTrainingState((current) => {
                    if (current === 'STARTING') {
                        setError("Training request timed out or no models were created.");
                        return 'IDLE';
                    }
                    return current;
                });
            }, 20000);
        },
        onError: (err) => {
            console.error(err);
            setError("Failed to start training.");
            setTrainingState('IDLE');
        },
    });

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

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Training Jobs</h1>
                <p className="text-muted-foreground mt-2">
                    Launch model training jobs on your uploaded datasets.
                </p>
            </div>

            {/* Success Banner - Only show when explicitly COMPLETED */}
            {trainingState === 'COMPLETED' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center justify-between mb-8 animate-in zoom-in-95 duration-300 shadow-md">
                    <div className="flex items-center gap-4">
                        <div className="bg-green-100 p-3 rounded-full">
                            <Trophy className="h-6 w-6 text-green-700" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-green-900">Successfully Trained Models</h3>
                            <p className="text-green-800">Your models are ready for evaluation.</p>
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

                {/* VISUAL FEEDBACK: Force show initializing state if we are STARTING or POLLING even if the list is empty at first */}
                {(trainingState === 'STARTING' || trainingState === 'POLLING') && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-5 animate-pulse flex items-center gap-4 mb-4">
                        <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                        <div>
                            <h4 className="font-semibold text-blue-900">
                                {trainingState === 'STARTING' ? "Initializing Training Environment..." : "Training in Progress..."}
                            </h4>
                            <p className="text-sm text-blue-700">
                                {trainingState === 'STARTING' ? "Sending job requests and allocating resources." : "Models are being trained. This may take a few minutes."}
                            </p>
                        </div>
                    </div>
                )}

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
                    // Only show "No training jobs" if we are IDLE. If starting/polling, the pulse card above handles it.
                    trainingState === 'IDLE' && (
                        <div className="p-12 text-center text-muted-foreground bg-gray-50 rounded-xl border border-dashed">
                            No training jobs started yet.
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
