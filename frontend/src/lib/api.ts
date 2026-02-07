import axios from 'axios';

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Standardized API Types

export interface Dataset {
    id: string;
    decision_system_id?: string;
    s3_key: string;
    status: "PENDING" | "VALID" | "INVALID";
    metadata_info?: {
        original_filename: string;
        row_count?: number;
        columns?: string[];
        location?: string;
    };
    created_at: string;
}

export interface MLModel {
    id: string;
    decision_system_id?: string;
    dataset_id: string;
    name: string;
    algorithm: string;
    status: "TRAINING" | "CANDIDATE" | "ACTIVE" | "ARCHIVED" | "FAILED";
    metrics?: {
        auc?: number;
        accuracy?: number;
        f1?: number;
        calibration?: any[]; // Array of decile blobs
        confusion_matrix?: any;
        feature_importance?: any[]; // Array of {feature, importance}
    };
    created_at: string;
}

export interface Policy {
    id: string;
    model_id: string;
    decision_system_id?: string;
    threshold: number;
    target_decile?: number;
    projected_approval_rate?: number;
    projected_loss_rate?: number;
    is_active: boolean;
    created_at?: string;
}

export type SystemModule =
    | "credit_scoring"
    | "policy_engine"
    | "fraud_detection"
    | "exposure_control";

export interface DecisionSystem {
    id: string;
    name: string;
    description?: string;
    created_at: string;

    // Enabled modules
    enabled_modules: SystemModule[];

    // Active pointers
    active_model_id?: string;
    active_policy_id?: string;

    // Summaries for easy UI display
    active_model_summary?: {
        id: string;
        name: string;
        algorithm: string;
        auc: number;
    };
    active_policy_summary?: {
        name: string;
        target_decile?: number;
        threshold: number;
        approval_rate: number;
    };
}

export interface DecisionRecord {
    id: string;
    decision_system_id: string;
    applicant_name?: string;
    applicant_ssn?: string;
    input_payload: any;
    score?: number;
    decision: "APPROVE" | "DECLINE";
    reason_codes?: string[];
    model_version_id?: string;
    policy_version_id?: string;
    timestamp: string;
}

export interface DecisionStats {
    period: string;
    total_volume_24h: number;
    approval_rate_24h: number;
    history: {
        date: string;
        volume: number;
        approved: number;
        rejected: number;
        approval_rate: number;
    }[];
}

// Fraud Management Types

export type FraudRiskLevel = "critical" | "high" | "medium" | "low";
export type FraudCaseStatus = "pending" | "in_review" | "escalated" | "resolved";
export type FraudCaseOutcome = "approved" | "declined" | "escalated" | "timeout" | null;
export type FraudSignalType = "device" | "velocity" | "identity" | "behavioral";
export type VerificationType = "kba" | "otp" | "document" | "call";
export type VerificationStatus = "pending" | "sent" | "completed" | "failed" | "expired";

export interface FraudSignal {
    id: string;
    signal_type: FraudSignalType;
    signal_name: string;
    description: string;
    raw_value: string | number;
    risk_contribution: number; // 0-100
    triggered_at: string;
}

export interface FraudScore {
    id: string;
    application_id: string;
    decision_system_id: string;
    score: number; // 0-1000
    risk_level: FraudRiskLevel;
    reason_codes: FraudSignal[];
    model_version: string;
    scored_at: string;
}

export interface FraudCase {
    id: string;
    application_id: string;
    applicant_name: string;
    applicant_email: string;
    amount_requested: number;
    fraud_score: FraudScore;
    queue: FraudRiskLevel;
    status: FraudCaseStatus;
    assigned_to: string | null;
    outcome: FraudCaseOutcome;
    resolution_notes: string | null;
    created_at: string;
    resolved_at: string | null;
    sla_deadline: string;
}

export interface VerificationRequest {
    id: string;
    case_id: string;
    verification_type: VerificationType;
    status: VerificationStatus;
    result: "pass" | "fail" | "inconclusive" | null;
    attempts: number;
    sent_at: string | null;
    completed_at: string | null;
    expires_at: string;
}

export interface FraudAnalytics {
    cases_today: number;
    cases_pending: number;
    sla_compliance: number; // percentage
    approval_rate: number; // percentage
    avg_review_time_minutes: number;
    queue_depth: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    daily_trend: {
        date: string;
        total: number;
        approved: number;
        declined: number;
    }[];
    score_distribution: {
        range: string;
        count: number;
    }[];
    top_signals: {
        signal_name: string;
        trigger_count: number;
        avg_risk_contribution: number;
    }[];
    analyst_performance?: {
        analyst_id: string;
        analyst_name: string;
        cases_reviewed: number;
        avg_review_time_minutes: number;
        approval_rate: number;
        sla_compliance: number;
    }[];
}

// Fraud Rules Types

export type FraudRuleType = "threshold" | "velocity" | "pattern" | "combination";
export type FraudRuleAction = "flag" | "auto_decline" | "escalate" | "require_verification";
export type FraudRuleOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export interface FraudRuleCondition {
    id: string;
    field: string;
    operator: FraudRuleOperator;
    value: string | number | string[];
}

export interface FraudRule {
    id: string;
    decision_system_id: string;
    name: string;
    description: string;
    rule_type: FraudRuleType;
    conditions: FraudRuleCondition[];
    logic: "AND" | "OR";
    action: FraudRuleAction;
    score_impact: number; // Points to add to fraud score when triggered
    is_active: boolean;
    priority: number; // Lower = higher priority
    created_at: string;
    updated_at: string;
    trigger_count_30d: number;
    last_triggered_at: string | null;
}

export interface FraudRuleSimulation {
    rule_id: string;
    total_applications: number;
    would_trigger: number;
    trigger_rate: number;
    false_positive_estimate: number;
    sample_matches: {
        application_id: string;
        applicant_name: string;
        current_score: number;
        would_be_score: number;
    }[];
}

// Fraud ML Model Types

export type FraudModelStatus = "training" | "validating" | "ready" | "active" | "archived" | "failed";
export type FraudModelAlgorithm = "gradient_boosting" | "random_forest" | "neural_network" | "ensemble";

export interface FraudModel {
    id: string;
    decision_system_id: string;
    name: string;
    description: string;
    algorithm: FraudModelAlgorithm;
    status: FraudModelStatus;
    is_active: boolean;
    training_config: {
        features: string[];
        target_variable: string;
        train_test_split: number;
        hyperparameters: Record<string, number | string>;
    };
    metrics?: {
        auc: number;
        precision: number;
        recall: number;
        f1_score: number;
        false_positive_rate: number;
        detection_rate: number;
        lift_at_10_percent: number;
    };
    feature_importance?: {
        feature: string;
        importance: number;
    }[];
    training_samples: number;
    fraud_samples: number;
    created_at: string;
    trained_at: string | null;
    version: string;
}

// Signal Provider Types

export type SignalProviderStatus = "connected" | "disconnected" | "error" | "pending";
export type SignalProviderType = "identity" | "device" | "behavior" | "consortium" | "bureau";

export interface SignalProvider {
    id: string;
    decision_system_id: string;
    name: string;
    provider_type: SignalProviderType;
    description: string;
    status: SignalProviderStatus;
    is_enabled: boolean;
    api_endpoint?: string;
    signals_provided: string[];
    avg_latency_ms: number;
    success_rate: number;
    cost_per_call: number;
    calls_today: number;
    last_sync_at: string | null;
    config: Record<string, string | boolean | number>;
}

// Automation Settings Types

export interface FraudAutomationSettings {
    decision_system_id: string;
    // Auto-assignment
    auto_assign_enabled: boolean;
    assignment_strategy: "round_robin" | "load_balanced" | "skill_based";
    max_cases_per_analyst: number;
    // Auto-decisioning
    auto_approve_below_score: number;
    auto_decline_above_score: number;
    auto_decision_enabled: boolean;
    // Escalation
    escalation_timeout_minutes: number;
    auto_escalate_on_timeout: boolean;
    // Notifications
    notify_on_critical: boolean;
    notify_on_sla_breach: boolean;
    notification_channels: ("email" | "slack" | "webhook")[];
    // Batch operations
    batch_review_enabled: boolean;
    batch_size_limit: number;
}
