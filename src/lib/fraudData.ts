import type {
    FraudCase,
    FraudScore,
    FraudSignal,
    FraudAnalytics,
    FraudRiskLevel,
    FraudCaseStatus,
    FraudSignalType,
    FraudRule,
    FraudRuleSimulation,
    VerificationRequest
} from "./api";

// Signal definitions for realistic fraud detection
const SIGNAL_DEFINITIONS: Record<FraudSignalType, { name: string; description: string }[]> = {
    device: [
        { name: "emulator_detected", description: "Application submitted from emulated device" },
        { name: "vpn_proxy_detected", description: "VPN or proxy connection detected" },
        { name: "device_fingerprint_mismatch", description: "Device fingerprint doesn't match historical pattern" },
        { name: "geolocation_mismatch", description: "IP geolocation doesn't match stated address" },
        { name: "new_device", description: "First time seeing this device for this identity" },
    ],
    velocity: [
        { name: "multiple_apps_same_device", description: "Multiple applications from same device in 24h" },
        { name: "multiple_apps_same_ssn", description: "Multiple applications with same SSN in 7 days" },
        { name: "address_reuse", description: "Address used across multiple unrelated applications" },
        { name: "rapid_application_sequence", description: "Applications submitted in rapid succession" },
        { name: "ip_velocity_spike", description: "Unusual volume of applications from this IP" },
    ],
    identity: [
        { name: "ssn_mismatch", description: "SSN does not match name on file" },
        { name: "synthetic_id_indicators", description: "Patterns consistent with synthetic identity" },
        { name: "watchlist_hit", description: "Name or SSN appears on fraud watchlist" },
        { name: "deceased_ssn", description: "SSN belongs to deceased individual" },
        { name: "age_discrepancy", description: "Stated age doesn't match SSN issuance date" },
    ],
    behavioral: [
        { name: "copy_paste_detected", description: "Form fields populated via copy/paste" },
        { name: "session_anomaly", description: "Unusual session behavior patterns" },
        { name: "form_completion_too_fast", description: "Form completed faster than typical human input" },
        { name: "navigation_pattern_anomaly", description: "Non-human navigation patterns detected" },
        { name: "multiple_tab_activity", description: "Suspicious multi-tab activity during session" },
    ],
};

const FIRST_NAMES = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];

function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateId(): string {
    return Math.random().toString(36).substring(2, 11);
}

function generateSignals(score: number): FraudSignal[] {
    const signalCount = score > 800 ? randomInt(4, 6) : score > 600 ? randomInt(3, 4) : score > 400 ? randomInt(2, 3) : randomInt(1, 2);
    const signals: FraudSignal[] = [];
    const usedSignals = new Set<string>();

    // Higher scores get more severe signals
    const signalTypes: FraudSignalType[] = ["device", "velocity", "identity", "behavioral"];

    for (let i = 0; i < signalCount; i++) {
        const type = randomChoice(signalTypes);
        const signalDef = randomChoice(SIGNAL_DEFINITIONS[type]);

        if (usedSignals.has(signalDef.name)) continue;
        usedSignals.add(signalDef.name);

        // Higher score = higher risk contributions
        const baseContribution = score > 800 ? 70 : score > 600 ? 50 : score > 400 ? 30 : 15;
        const contribution = Math.min(100, baseContribution + randomInt(-10, 20));

        signals.push({
            id: generateId(),
            signal_type: type,
            signal_name: signalDef.name,
            description: signalDef.description,
            raw_value: type === "velocity" ? randomInt(2, 10).toString() : "true",
            risk_contribution: contribution,
            triggered_at: new Date(Date.now() - randomInt(0, 3600000)).toISOString(),
        });
    }

    // Sort by risk contribution descending
    return signals.sort((a, b) => b.risk_contribution - a.risk_contribution);
}

function scoreToRiskLevel(score: number): FraudRiskLevel {
    if (score >= 800) return "critical";
    if (score >= 600) return "high";
    if (score >= 400) return "medium";
    return "low";
}

function generateFraudScore(applicationId: string, systemId: string): FraudScore {
    // Generate realistic score distribution (more low scores, fewer critical)
    const rand = Math.random();
    let score: number;
    if (rand < 0.5) score = randomInt(100, 399);      // 50% low risk
    else if (rand < 0.75) score = randomInt(400, 599); // 25% medium
    else if (rand < 0.92) score = randomInt(600, 799); // 17% high
    else score = randomInt(800, 950);                  // 8% critical

    return {
        id: generateId(),
        application_id: applicationId,
        decision_system_id: systemId,
        score,
        risk_level: scoreToRiskLevel(score),
        reason_codes: generateSignals(score),
        model_version: "fraud-v2.3.1",
        scored_at: new Date(Date.now() - randomInt(0, 86400000)).toISOString(),
    };
}

function getSLADeadline(riskLevel: FraudRiskLevel, createdAt: Date): Date {
    const slaMinutes = {
        critical: 15,
        high: 120,
        medium: 1440,  // 24 hours
        low: 2880,     // 48 hours
    };
    return new Date(createdAt.getTime() + slaMinutes[riskLevel] * 60 * 1000);
}

export function generateFraudCase(systemId: string, overrides?: Partial<FraudCase>): FraudCase {
    const applicationId = `APP-${generateId().toUpperCase()}`;
    const fraudScore = generateFraudScore(applicationId, systemId);
    const createdAt = new Date(Date.now() - randomInt(0, 172800000)); // Last 48 hours

    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);

    // Determine status based on age and risk level
    const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
    let status: FraudCaseStatus = "pending";
    let outcome: FraudCase["outcome"] = null;
    let resolvedAt: string | null = null;
    let assignedTo: string | null = null;

    // Older cases more likely to be resolved
    if (ageHours > 24 && Math.random() > 0.3) {
        status = "resolved";
        outcome = Math.random() > 0.3 ? "approved" : "declined";
        resolvedAt = new Date(createdAt.getTime() + randomInt(1800000, 14400000)).toISOString();
        assignedTo = randomChoice(["analyst_1", "analyst_2", "analyst_3"]);
    } else if (ageHours > 4 && Math.random() > 0.5) {
        status = "in_review";
        assignedTo = randomChoice(["analyst_1", "analyst_2", "analyst_3"]);
    }

    return {
        id: generateId(),
        application_id: applicationId,
        applicant_name: `${firstName} ${lastName}`,
        applicant_email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
        amount_requested: randomInt(5, 50) * 1000,
        fraud_score: fraudScore,
        queue: fraudScore.risk_level,
        status,
        assigned_to: assignedTo,
        outcome,
        resolution_notes: outcome ? "Verification completed successfully." : null,
        created_at: createdAt.toISOString(),
        resolved_at: resolvedAt,
        sla_deadline: getSLADeadline(fraudScore.risk_level, createdAt).toISOString(),
        ...overrides,
    };
}

export function generateFraudCases(systemId: string, count: number = 50): FraudCase[] {
    return Array.from({ length: count }, () => generateFraudCase(systemId));
}

export function generateFraudAnalytics(cases: FraudCase[]): FraudAnalytics {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const casesToday = cases.filter(c => new Date(c.created_at) >= todayStart);
    const pendingCases = cases.filter(c => c.status === "pending" || c.status === "in_review");
    const resolvedCases = cases.filter(c => c.status === "resolved");

    // Calculate SLA compliance
    const resolvedWithSLA = resolvedCases.filter(c => {
        if (!c.resolved_at) return false;
        return new Date(c.resolved_at) <= new Date(c.sla_deadline);
    });
    const slaCompliance = resolvedCases.length > 0
        ? (resolvedWithSLA.length / resolvedCases.length) * 100
        : 100;

    // Calculate approval rate
    const approvedCases = resolvedCases.filter(c => c.outcome === "approved");
    const approvalRate = resolvedCases.length > 0
        ? (approvedCases.length / resolvedCases.length) * 100
        : 0;

    // Queue depth
    const queueDepth = {
        critical: pendingCases.filter(c => c.queue === "critical").length,
        high: pendingCases.filter(c => c.queue === "high").length,
        medium: pendingCases.filter(c => c.queue === "medium").length,
        low: pendingCases.filter(c => c.queue === "low").length,
    };

    // Daily trend (last 7 days)
    const dailyTrend = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - (6 - i));
        const dateStr = date.toISOString().split("T")[0];
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(dayStart.getTime() + 86400000);

        const dayCases = cases.filter(c => {
            const created = new Date(c.created_at);
            return created >= dayStart && created < dayEnd;
        });

        const dayResolved = dayCases.filter(c => c.status === "resolved");

        return {
            date: dateStr,
            total: dayCases.length,
            approved: dayResolved.filter(c => c.outcome === "approved").length,
            declined: dayResolved.filter(c => c.outcome === "declined").length,
        };
    });

    // Score distribution
    const scoreRanges = [
        { range: "0-199", min: 0, max: 199 },
        { range: "200-399", min: 200, max: 399 },
        { range: "400-599", min: 400, max: 599 },
        { range: "600-799", min: 600, max: 799 },
        { range: "800-1000", min: 800, max: 1000 },
    ];
    const scoreDistribution = scoreRanges.map(({ range, min, max }) => ({
        range,
        count: cases.filter(c => c.fraud_score.score >= min && c.fraud_score.score <= max).length,
    }));

    // Top signals
    const signalCounts: Record<string, { count: number; totalContribution: number }> = {};
    cases.forEach(c => {
        c.fraud_score.reason_codes.forEach(signal => {
            if (!signalCounts[signal.signal_name]) {
                signalCounts[signal.signal_name] = { count: 0, totalContribution: 0 };
            }
            signalCounts[signal.signal_name].count++;
            signalCounts[signal.signal_name].totalContribution += signal.risk_contribution;
        });
    });

    const topSignals = Object.entries(signalCounts)
        .map(([name, data]) => ({
            signal_name: name,
            trigger_count: data.count,
            avg_risk_contribution: Math.round(data.totalContribution / data.count),
        }))
        .sort((a, b) => b.trigger_count - a.trigger_count)
        .slice(0, 10);

    // Analyst performance
    const analysts = ["analyst_1", "analyst_2", "analyst_3"];
    const analystPerformance = analysts.map(analystId => {
        const analystCases = resolvedCases.filter(c => c.assigned_to === analystId);
        const analystApproved = analystCases.filter(c => c.outcome === "approved");
        const analystWithinSLA = analystCases.filter(c => {
            if (!c.resolved_at) return false;
            return new Date(c.resolved_at) <= new Date(c.sla_deadline);
        });

        return {
            analyst_id: analystId,
            analyst_name: analystId.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase()),
            cases_reviewed: analystCases.length,
            avg_review_time_minutes: randomInt(12, 35),
            approval_rate: analystCases.length > 0 ? Math.round((analystApproved.length / analystCases.length) * 100) : 0,
            sla_compliance: analystCases.length > 0 ? Math.round((analystWithinSLA.length / analystCases.length) * 100) : 100,
        };
    });

    return {
        cases_today: casesToday.length,
        cases_pending: pendingCases.length,
        sla_compliance: Math.round(slaCompliance),
        approval_rate: Math.round(approvalRate),
        avg_review_time_minutes: randomInt(15, 45),
        queue_depth: queueDepth,
        daily_trend: dailyTrend,
        score_distribution: scoreDistribution,
        top_signals: topSignals,
        analyst_performance: analystPerformance,
    };
}

// Singleton store for consistent data across components
let cachedCases: FraudCase[] | null = null;

export function getFraudCases(systemId: string, forceRefresh = false): FraudCase[] {
    if (!cachedCases || forceRefresh) {
        cachedCases = generateFraudCases(systemId, 75);
    }
    return cachedCases;
}

export function getFraudCase(caseId: string, systemId: string): FraudCase | undefined {
    const cases = getFraudCases(systemId);
    return cases.find(c => c.id === caseId);
}

export function updateFraudCase(caseId: string, updates: Partial<FraudCase>): FraudCase | undefined {
    if (!cachedCases) return undefined;
    const index = cachedCases.findIndex(c => c.id === caseId);
    if (index === -1) return undefined;

    cachedCases[index] = { ...cachedCases[index], ...updates };
    return cachedCases[index];
}

// ============================================
// FRAUD RULES
// ============================================

// Available fields for rule conditions
export const RULE_FIELDS = [
    { field: "fraud_score", label: "Fraud Score", type: "number" },
    { field: "amount_requested", label: "Amount Requested", type: "number" },
    { field: "device_type", label: "Device Type", type: "string" },
    { field: "ip_country", label: "IP Country", type: "string" },
    { field: "email_domain", label: "Email Domain", type: "string" },
    { field: "applications_24h", label: "Applications (24h)", type: "number" },
    { field: "applications_7d", label: "Applications (7d)", type: "number" },
    { field: "device_age_days", label: "Device Age (days)", type: "number" },
    { field: "address_match", label: "Address Match Score", type: "number" },
    { field: "phone_carrier", label: "Phone Carrier", type: "string" },
    { field: "ssn_velocity", label: "SSN Velocity (30d)", type: "number" },
    { field: "ip_velocity", label: "IP Velocity (24h)", type: "number" },
];

// Pre-built rule templates
const RULE_TEMPLATES: Omit<FraudRule, "id" | "decision_system_id" | "created_at" | "updated_at" | "trigger_count_30d" | "last_triggered_at">[] = [
    {
        name: "High Score Auto-Decline",
        description: "Automatically decline applications with fraud scores above 900",
        rule_type: "threshold",
        conditions: [{ id: "c1", field: "fraud_score", operator: "gte", value: 900 }],
        logic: "AND",
        action: "auto_decline",
        score_impact: 0,
        is_active: true,
        priority: 1,
    },
    {
        name: "Velocity Alert - Multiple Apps",
        description: "Flag when more than 3 applications from same identity in 24 hours",
        rule_type: "velocity",
        conditions: [{ id: "c1", field: "applications_24h", operator: "gt", value: 3 }],
        logic: "AND",
        action: "escalate",
        score_impact: 150,
        is_active: true,
        priority: 2,
    },
    {
        name: "High Amount + New Device",
        description: "Require verification for large amounts from devices seen less than 7 days",
        rule_type: "combination",
        conditions: [
            { id: "c1", field: "amount_requested", operator: "gte", value: 25000 },
            { id: "c2", field: "device_age_days", operator: "lt", value: 7 },
        ],
        logic: "AND",
        action: "require_verification",
        score_impact: 100,
        is_active: true,
        priority: 3,
    },
    {
        name: "Suspicious Email Domain",
        description: "Flag applications using temporary email providers",
        rule_type: "pattern",
        conditions: [{ id: "c1", field: "email_domain", operator: "in", value: ["tempmail.com", "throwaway.email", "guerrillamail.com", "10minutemail.com"] }],
        logic: "AND",
        action: "flag",
        score_impact: 75,
        is_active: true,
        priority: 4,
    },
    {
        name: "Foreign IP + High Amount",
        description: "Escalate high-value applications from non-US IPs",
        rule_type: "combination",
        conditions: [
            { id: "c1", field: "ip_country", operator: "neq", value: "US" },
            { id: "c2", field: "amount_requested", operator: "gte", value: 15000 },
        ],
        logic: "AND",
        action: "escalate",
        score_impact: 125,
        is_active: false,
        priority: 5,
    },
    {
        name: "SSN Velocity Spike",
        description: "Flag when SSN is used more than 2 times in 30 days",
        rule_type: "velocity",
        conditions: [{ id: "c1", field: "ssn_velocity", operator: "gt", value: 2 }],
        logic: "AND",
        action: "flag",
        score_impact: 200,
        is_active: true,
        priority: 6,
    },
    {
        name: "Address Mismatch",
        description: "Require verification when address match score is below 50%",
        rule_type: "threshold",
        conditions: [{ id: "c1", field: "address_match", operator: "lt", value: 50 }],
        logic: "AND",
        action: "require_verification",
        score_impact: 50,
        is_active: true,
        priority: 7,
    },
    {
        name: "IP Flood Detection",
        description: "Auto-decline when IP has more than 10 applications in 24 hours",
        rule_type: "velocity",
        conditions: [{ id: "c1", field: "ip_velocity", operator: "gt", value: 10 }],
        logic: "AND",
        action: "auto_decline",
        score_impact: 300,
        is_active: true,
        priority: 8,
    },
];

let cachedRules: FraudRule[] | null = null;

export function generateFraudRules(systemId: string): FraudRule[] {
    return RULE_TEMPLATES.map((template) => ({
        ...template,
        id: `rule_${generateId()}`,
        decision_system_id: systemId,
        created_at: new Date(Date.now() - randomInt(7, 90) * 86400000).toISOString(),
        updated_at: new Date(Date.now() - randomInt(0, 7) * 86400000).toISOString(),
        trigger_count_30d: randomInt(5, 150),
        last_triggered_at: Math.random() > 0.3
            ? new Date(Date.now() - randomInt(0, 72) * 3600000).toISOString()
            : null,
    }));
}

export function getFraudRules(systemId: string, forceRefresh = false): FraudRule[] {
    if (!cachedRules || forceRefresh) {
        cachedRules = generateFraudRules(systemId);
    }
    return cachedRules;
}

export function getFraudRule(ruleId: string, systemId: string): FraudRule | undefined {
    const rules = getFraudRules(systemId);
    return rules.find(r => r.id === ruleId);
}

export function createFraudRule(systemId: string, rule: Omit<FraudRule, "id" | "decision_system_id" | "created_at" | "updated_at" | "trigger_count_30d" | "last_triggered_at">): FraudRule {
    const newRule: FraudRule = {
        ...rule,
        id: `rule_${generateId()}`,
        decision_system_id: systemId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        trigger_count_30d: 0,
        last_triggered_at: null,
    };

    if (!cachedRules) cachedRules = [];
    cachedRules.push(newRule);
    return newRule;
}

export function updateFraudRule(ruleId: string, updates: Partial<FraudRule>): FraudRule | undefined {
    if (!cachedRules) return undefined;
    const index = cachedRules.findIndex(r => r.id === ruleId);
    if (index === -1) return undefined;

    cachedRules[index] = {
        ...cachedRules[index],
        ...updates,
        updated_at: new Date().toISOString(),
    };
    return cachedRules[index];
}

export function deleteFraudRule(ruleId: string): boolean {
    if (!cachedRules) return false;
    const index = cachedRules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;

    cachedRules.splice(index, 1);
    return true;
}

export function simulateFraudRule(rule: FraudRule, systemId: string): FraudRuleSimulation {
    const cases = getFraudCases(systemId);
    const totalApplications = cases.length;

    // Simulate which cases would be affected
    // This is a simplified simulation - in production, you'd evaluate actual conditions
    const triggerRate = rule.conditions.length > 1
        ? randomInt(5, 15)
        : randomInt(10, 25);

    const wouldTrigger = Math.round(totalApplications * (triggerRate / 100));
    const falsePositiveEstimate = Math.round(wouldTrigger * (randomInt(10, 30) / 100));

    // Generate sample matches
    const sampleMatches = cases
        .slice(0, 5)
        .map(c => ({
            application_id: c.application_id,
            applicant_name: c.applicant_name,
            current_score: c.fraud_score.score,
            would_be_score: Math.min(1000, c.fraud_score.score + rule.score_impact),
        }));

    return {
        rule_id: rule.id,
        total_applications: totalApplications,
        would_trigger: wouldTrigger,
        trigger_rate: triggerRate,
        false_positive_estimate: falsePositiveEstimate,
        sample_matches: sampleMatches,
    };
}

// ============================================
// VERIFICATION TRACKING
// ============================================

let cachedVerifications: Map<string, VerificationRequest[]> = new Map();

export function getVerificationsForCase(caseId: string): VerificationRequest[] {
    return cachedVerifications.get(caseId) || [];
}

export function createVerificationRequest(
    caseId: string,
    type: VerificationRequest["verification_type"]
): VerificationRequest {
    const verification: VerificationRequest = {
        id: `ver_${generateId()}`,
        case_id: caseId,
        verification_type: type,
        status: "sent",
        result: null,
        attempts: 1,
        sent_at: new Date().toISOString(),
        completed_at: null,
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(), // 24 hours
    };

    const existing = cachedVerifications.get(caseId) || [];
    existing.push(verification);
    cachedVerifications.set(caseId, existing);

    // Simulate async completion after a delay
    setTimeout(() => {
        const verifications = cachedVerifications.get(caseId);
        if (verifications) {
            const idx = verifications.findIndex(v => v.id === verification.id);
            if (idx !== -1) {
                const passed = Math.random() > 0.3; // 70% pass rate
                verifications[idx] = {
                    ...verifications[idx],
                    status: "completed",
                    result: passed ? "pass" : "fail",
                    completed_at: new Date().toISOString(),
                };
            }
        }
    }, randomInt(3000, 8000)); // Complete after 3-8 seconds

    return verification;
}
