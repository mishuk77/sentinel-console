import axios from 'axios';

export const api = axios.create({
    baseURL: 'http://localhost:8000/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
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
