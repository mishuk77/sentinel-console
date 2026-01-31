import type {
    FraudCase,
    FraudScore,
    FraudSignal,
    FraudAnalytics,
    FraudRiskLevel,
    FraudCaseStatus,
    FraudSignalType
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
