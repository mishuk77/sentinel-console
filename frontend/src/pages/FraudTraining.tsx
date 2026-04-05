import TrainingPage from "@/components/training/TrainingPage";
import type { TrainingPageConfig } from "@/components/training/TrainingPage";

const fraudConfig: TrainingPageConfig = {
    modelContext: "fraud",
    title: "Fraud Training",
    description: "Train fraud-detection models with automated hyperparameter tuning, cross-validation, and ensemble stacking.",
    targetHints: ["is_fraud", "fraud_flag", "fraud", "fraudulent", "label"],
    classLabels: { positive: "Fraud", negative: "Legit" },
    targetLabel: "Target Column (Fraud Label)",
    targetHelper: "The binary column indicating fraud (1 = fraud, 0 = legitimate)",
    featureLabel: "Feature Columns",
    featureHelper: "Select the columns to use as predictive features",
    imbalanceWarning: "Severe class imbalance detected. The pipeline will apply class weighting automatically.",
    startButtonText: "Start Fraud Training Pipeline",
    completionRoute: "fraud/models",
    completionButtonText: "View Fraud Models",
    datasetRoute: "fraud/data",
    resultsTitle: "Fraud Models",
    emptyTitle: "No fraud models trained yet",
    emptyWithDatasets: "You have datasets ready. Start a training job to build fraud-detection models.",
    emptyNoDatasets: "Upload a fraud dataset first, then come back to train models.",
    emptyLinkText: "Go to Fraud Datasets",
};

export default function FraudTraining() {
    return <TrainingPage config={fraudConfig} />;
}
