import TrainingPage from "@/components/training/TrainingPage";
import type { TrainingPageConfig } from "@/components/training/TrainingPage";

const creditConfig: TrainingPageConfig = {
    modelContext: "credit",
    title: "Training Jobs",
    description: "Train credit-risk models with automated hyperparameter tuning, cross-validation, and ensemble stacking.",
    classLabels: { positive: "Bad", negative: "Good" },
    targetLabel: "Target Column (Default Event)",
    targetHelper: "The binary column indicating loan default (1 = default, 0 = no default)",
    featureLabel: "Feature Columns",
    featureHelper: "Select the columns to use as predictive features",
    imbalanceWarning: "Severe class imbalance detected. The pipeline will apply class weighting automatically.",
    startButtonText: "Start Training Pipeline",
    completionRoute: "models",
    completionButtonText: "View Trained Models",
    datasetRoute: "data",
    resultsTitle: "Trained Models",
    emptyTitle: "No models trained yet",
    emptyWithDatasets: "You have datasets ready. Start a training job to build credit-risk models.",
    emptyNoDatasets: "Upload a dataset first, then come back to train models.",
    emptyLinkText: "Go to Datasets",
};

export default function TrainingJobs() {
    return <TrainingPage config={creditConfig} />;
}
