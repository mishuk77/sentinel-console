import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const api = axios.create({
    baseURL: API_BASE_URL,
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

// Handle authentication errors (403/401) - clear token and redirect to login
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 403 || error.response?.status === 401) {
            // Clear invalid token
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            // Redirect to login
            if (typeof window !== 'undefined') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

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
        gini?: number;
        accuracy?: number;
        f1?: number;
        cv_auc_mean?: number;
        cv_auc_std?: number;
        cv_fold_scores?: number[];
        classification_metrics?: {
            f1?: number; tpr?: number; fpr?: number; tnr?: number;
            ppv?: number; npv?: number; accuracy?: number; mcc?: number;
        };
        calibration?: any[];
        confusion_matrix?: any;
        feature_importance?: any[];
        feature_stats?: any[];
        data_profile?: any;
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

export type SystemType = "credit" | "fraud" | "full";

export interface DecisionSystem {
    id: string;
    name: string;
    description?: string;
    system_type: SystemType;
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

// ============================================================
// API METHODS
// ============================================================

// ==================== Authentication ====================

export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
    client_id: string;
    role: string;
}

export const authAPI = {
    login: (data: LoginRequest) => 
        api.post<LoginResponse>('/auth/login/access-token', 
            new URLSearchParams({
                username: data.username,
                password: data.password
            }), 
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        ),
};

// ==================== Decision Systems ====================

export interface CreateSystemRequest {
    name: string;
    description?: string;
    system_type?: SystemType;
}

export const systemsAPI = {
    list: () => api.get<DecisionSystem[]>('/systems'),
    get: (id: string) => api.get<DecisionSystem>(`/systems/${id}`),
    create: (data: CreateSystemRequest) => api.post<DecisionSystem>('/systems', data),
    delete: (id: string) => api.delete(`/systems/${id}`),
    upgrade: (id: string) => api.post(`/systems/${id}/upgrade`),
};

// ==================== Datasets ====================

export const datasetsAPI = {
    list: (systemId?: string) => 
        api.get<Dataset[]>('/datasets', { params: systemId ? { system_id: systemId } : {} }),
    
    upload: (systemId: string, file: File) => {
        const formData = new FormData();
        formData.append('system_id', systemId);
        formData.append('file', file);
        return api.post<Dataset>('/datasets/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },
    
    preview: (datasetId: string) => 
        api.get<{ rows: any[], columns: { name: string, type: string, sample: string }[] }>(
            `/datasets/${datasetId}/preview`
        ),
    
    delete: (datasetId: string) => api.delete(`/datasets/${datasetId}`),

    segmentColumns: (datasetId: string) =>
        api.get<{ column: string; values: string[] }[]>(`/datasets/${datasetId}/segment-columns`),
};

// ==================== Models ====================

export interface TrainModelRequest {
    target_col?: string;
    feature_cols?: string[];
}

export const modelsAPI = {
    list: (systemId?: string) => 
        api.get<MLModel[]>('/models', { params: systemId ? { system_id: systemId } : {} }),
    
    get: (modelId: string) => api.get<MLModel>(`/models/${modelId}`),
    
    train: (datasetId: string, data: TrainModelRequest) => 
        api.post<{ message: string, models: Record<string, string> }>(
            `/models/${datasetId}/train`, 
            data
        ),
    
    activate: (modelId: string) => 
        api.post<{ message: string, model: MLModel }>(`/models/${modelId}/activate`),
    
    delete: (modelId: string) => api.delete(`/models/${modelId}`),
};

// ==================== Policy Segments ====================

export interface PolicySegment {
    id: string;
    policy_id: string;
    name: string;
    filters: Record<string, string>;
    specificity: number;
    threshold: number | null;
    override_threshold: number | null;
    override_reason?: string | null;
    override_by?: string | null;
    n_samples: number | null;
    default_rate: number | null;
    confidence_score: number | null;
    confidence_tier: "green" | "yellow" | "red" | null;
    projected_approval_rate: number | null;
    fallback_segment_id: string | null;
    is_global: boolean;
    is_active: boolean;
    created_at: string;
}

export interface SegmentCreate {
    name: string;
    filters: Record<string, string>;
    threshold?: number | null;
}

export interface SegmentUpdate {
    name?: string;
    override_threshold?: number | null;
    override_reason?: string | null;
}

export const segmentsAPI = {
    list: (policyId: string) =>
        api.get<PolicySegment[]>(`/policies/${policyId}/segments`),

    create: (policyId: string, data: SegmentCreate) =>
        api.post<PolicySegment>(`/policies/${policyId}/segments`, data),

    update: (policyId: string, segmentId: string, data: SegmentUpdate) =>
        api.put<PolicySegment>(`/policies/${policyId}/segments/${segmentId}`, data),

    delete: (policyId: string, segmentId: string) =>
        api.delete(`/policies/${policyId}/segments/${segmentId}`),

    calibrate: (policyId: string, opts?: { target_bad_rate?: number }) =>
        api.post<PolicySegment[]>(`/policies/${policyId}/segments/calibrate`, opts ?? {}),

    calibration: (policyId: string, segmentId: string) =>
        api.get<{ segment_id: string; n_samples: number; calibration: any[] }>(
            `/policies/${policyId}/segments/${segmentId}/calibration`
        ),
};

// ==================== Policies ====================

export interface CreatePolicyRequest {
    model_id: string;
    threshold: number;
    projected_approval_rate?: number;
    projected_loss_rate?: number;
    target_decile?: number;
    amount_ladder?: Record<string, any>;
}

export interface LoanAmountLadderRequest {
    dataset_id: string;
    model_id: string;
    threshold: number;
}

export const policiesAPI = {
    list: (systemId?: string) => 
        api.get<Policy[]>('/policies', { params: systemId ? { system_id: systemId } : {} }),
    
    create: (data: CreatePolicyRequest) => api.post<Policy>('/policies', data),
    
    activate: (policyId: string) => 
        api.put<Policy>(`/policies/${policyId}/activate`),
    
    recommendAmounts: (data: LoanAmountLadderRequest) => 
        api.post<any>('/policies/recommend-amounts', data),
    
    delete: (policyId: string) => api.delete(`/policies/${policyId}`),
};

// ==================== Decisions ====================

export interface MakeDecisionRequest {
    applicant_name?: string;
    applicant_ssn?: string;
    inputs: Record<string, any>;
}

export const decisionsAPI = {
    make: (systemId: string, data: MakeDecisionRequest) => 
        api.post<DecisionRecord>(`/decisions/${systemId}`, data),
    
    list: (params?: { 
        system_id?: string, 
        applicant_name?: string, 
        skip?: number, 
        limit?: number 
    }) => api.get<DecisionRecord[]>('/decisions', { params }),
    
    get: (decisionId: string) => api.get<DecisionRecord>(`/decisions/${decisionId}`),
    
    stats: (systemId: string, days?: number) => 
        api.get<DecisionStats>('/decisions/stats/overview', { 
            params: { system_id: systemId, days: days || 7 } 
        }),
    
    predict: (modelId: string, inputs: Record<string, any>) => 
        api.post<{ score: number }>('/decisions/predict', { model_id: modelId, inputs }),
};

// ==================== Dashboard ====================

export const dashboardAPI = {
    stats: () => api.get<{ volume_24h: number, approval_rate_24h: number }>('/dashboard/stats'),
    
    deploymentStatus: () => api.get<{
        status: string,
        model?: { name: string, version: string, algorithm: string },
        policy?: { name: string, target_decile?: number, projected_approval: number }
    }>('/dashboard/deployment-status'),
    
    volume: () => api.get<{ date: string, total: number, approved: number }[]>('/dashboard/volume'),
};

// ==================== Fraud Management ====================

export interface CreateFraudCaseRequest {
    application_id: string;
    applicant_name: string;
    applicant_email: string;
    signals: Array<{
        signal_type: string;
        signal_name: string;
        description?: string;
        raw_value?: string;
        risk_contribution: number;
    }>;
    total_score?: number;
    identity_score?: number;
    device_score?: number;
    velocity_score?: number;
    behavioral_score?: number;
}

export interface FraudCaseDecisionRequest {
    decision: 'approved' | 'declined' | 'escalated';
    reason: string;
}

export const fraudCasesAPI = {
    list: (systemId: string, params?: Record<string, any>) => 
        api.get<{ data: any[], meta: any }>(`/systems/${systemId}/fraud/cases`, { params }),
    
    get: (systemId: string, caseId: string) => 
        api.get<any>(`/systems/${systemId}/fraud/cases/${caseId}`),
    
    create: (systemId: string, data: CreateFraudCaseRequest) => 
        api.post<any>(`/systems/${systemId}/fraud/cases`, data),
    
    decide: (systemId: string, caseId: string, data: FraudCaseDecisionRequest) => 
        api.post<any>(`/systems/${systemId}/fraud/cases/${caseId}/decide`, data),
    
    assign: (systemId: string, caseId: string, analystId: string) => 
        api.post<any>(`/systems/${systemId}/fraud/cases/${caseId}/assign`, { analyst_id: analystId }),
    
    escalate: (systemId: string, caseId: string) => 
        api.post<any>(`/systems/${systemId}/fraud/cases/${caseId}/escalate`),
};

export interface CreateVerificationRequest {
    verification_type: 'otp_sms' | 'otp_email' | 'kba' | 'document_upload' | 'video_call' | 'manual_call';
}

export const verificationsAPI = {
    list: (systemId: string, caseId: string) => 
        api.get<any[]>(`/systems/${systemId}/fraud/cases/${caseId}/verifications`),
    
    create: (systemId: string, caseId: string, data: CreateVerificationRequest) => 
        api.post<any>(`/systems/${systemId}/fraud/cases/${caseId}/verifications`, data),
    
    update: (systemId: string, caseId: string, verificationId: string, data: Record<string, any>) => 
        api.patch<any>(`/systems/${systemId}/fraud/cases/${caseId}/verifications/${verificationId}`, data),
};

export interface CreateFraudRuleRequest {
    name: string;
    description?: string;
    priority?: number;
    conditions: Array<{
        field: string;
        operator: string;
        value: any;
    }>;
    condition_logic?: 'AND' | 'OR';
    action: string;
    action_config?: Record<string, any>;
}

export const fraudRulesAPI = {
    list: (systemId: string) => 
        api.get<FraudRule[]>(`/systems/${systemId}/fraud/rules`),
    
    get: (systemId: string, ruleId: string) => 
        api.get<FraudRule>(`/systems/${systemId}/fraud/rules/${ruleId}`),
    
    create: (systemId: string, data: CreateFraudRuleRequest) => 
        api.post<FraudRule>(`/systems/${systemId}/fraud/rules`, data),
    
    update: (systemId: string, ruleId: string, data: Partial<CreateFraudRuleRequest>) => 
        api.put<FraudRule>(`/systems/${systemId}/fraud/rules/${ruleId}`, data),
    
    delete: (systemId: string, ruleId: string) => 
        api.delete(`/systems/${systemId}/fraud/rules/${ruleId}`),
    
    activate: (systemId: string, ruleId: string) => 
        api.post<FraudRule>(`/systems/${systemId}/fraud/rules/${ruleId}/activate`),
    
    deactivate: (systemId: string, ruleId: string) => 
        api.post<FraudRule>(`/systems/${systemId}/fraud/rules/${ruleId}/deactivate`),
    
    simulate: (systemId: string, data: Record<string, any>) => 
        api.post<any>(`/systems/${systemId}/fraud/rules/simulate`, data),
    
    getFields: (systemId: string) => 
        api.get<any>(`/systems/${systemId}/fraud/rules/fields`),
};

export interface CreateFraudModelRequest {
    name: string;
    description?: string;
    algorithm: string;
    training_config: Record<string, any>;
}

export const fraudModelsAPI = {
    list: (systemId: string) => 
        api.get<FraudModel[]>(`/systems/${systemId}/fraud/models`),
    
    get: (systemId: string, modelId: string) => 
        api.get<FraudModel>(`/systems/${systemId}/fraud/models/${modelId}`),
    
    create: (systemId: string, data: CreateFraudModelRequest) => 
        api.post<FraudModel>(`/systems/${systemId}/fraud/models`, data),
    
    delete: (systemId: string, modelId: string) => 
        api.delete(`/systems/${systemId}/fraud/models/${modelId}`),
    
    train: (systemId: string, modelId: string) => 
        api.post<any>(`/systems/${systemId}/fraud/models/${modelId}/train`),
    
    activate: (systemId: string, modelId: string) => 
        api.post<FraudModel>(`/systems/${systemId}/fraud/models/${modelId}/activate`),
    
    archive: (systemId: string, modelId: string) => 
        api.post<FraudModel>(`/systems/${systemId}/fraud/models/${modelId}/archive`),
    
    getFeatures: (systemId: string) => 
        api.get<any>(`/systems/${systemId}/fraud/models/features`),
};

export const signalProvidersAPI = {
    list: (systemId: string) => 
        api.get<SignalProvider[]>(`/systems/${systemId}/fraud/signals/providers`),
    
    get: (systemId: string, providerId: string) => 
        api.get<SignalProvider>(`/systems/${systemId}/fraud/signals/providers/${providerId}`),
    
    update: (systemId: string, providerId: string, data: Record<string, any>) => 
        api.patch<SignalProvider>(`/systems/${systemId}/fraud/signals/providers/${providerId}`, data),
    
    test: (systemId: string, providerId: string) => 
        api.post<any>(`/systems/${systemId}/fraud/signals/providers/${providerId}/test`),
    
    sync: (systemId: string, providerId: string) => 
        api.post<any>(`/systems/${systemId}/fraud/signals/providers/${providerId}/sync`),
};

export const fraudAutomationAPI = {
    get: (systemId: string) => 
        api.get<FraudAutomationSettings>(`/systems/${systemId}/fraud/settings`),
    
    update: (systemId: string, data: Partial<FraudAutomationSettings>) => 
        api.put<FraudAutomationSettings>(`/systems/${systemId}/fraud/settings`, data),
};

export const fraudAnalyticsAPI = {
    overview: (systemId: string, params?: Record<string, any>) => 
        api.get<FraudAnalytics>(`/systems/${systemId}/fraud/analytics`, { params }),
    
    queueDepth: (systemId: string) => 
        api.get<Record<string, number>>(`/systems/${systemId}/fraud/analytics/queue-depth`),
    
    trend: (systemId: string, days?: number) => 
        api.get<any[]>(`/systems/${systemId}/fraud/analytics/trend`, { params: { days: days || 7 } }),
    
    signals: (systemId: string, limit?: number) => 
        api.get<any[]>(`/systems/${systemId}/fraud/analytics/signals`, { params: { limit: limit || 10 } }),
    
    analysts: (systemId: string) => 
        api.get<any[]>(`/systems/${systemId}/fraud/analytics/analysts`),
};
