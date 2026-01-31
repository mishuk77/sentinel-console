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

export interface DecisionSystem {
    id: string;
    name: string;
    description?: string;
    created_at: string;

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
}
