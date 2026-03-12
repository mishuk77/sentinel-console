import {
    BrainCircuit,
    Database,
    Shield,
    Sliders,
    ShieldAlert,
    DollarSign,
    type LucideIcon,
} from "lucide-react";

// ─── Module Types ────────────────────────────────────────────

export type SystemModule =
    | "credit_scoring"
    | "policy_engine"
    | "fraud_detection"
    | "exposure_control";

export interface ModuleNavItem {
    path: string;
    label: string;
    icon: LucideIcon;
}

export interface ModuleDefinition {
    id: SystemModule;
    name: string;
    shortName: string;
    description: string;
    icon: LucideIcon;
    color: string;           // tailwind color name (blue, purple, orange, green)
    badgeClasses: string;    // tailwind classes for badge
    dependencies: SystemModule[];
    navItems: ModuleNavItem[];
}

// ─── Module Registry ─────────────────────────────────────────

export const MODULE_REGISTRY: Record<SystemModule, ModuleDefinition> = {
    credit_scoring: {
        id: "credit_scoring",
        name: "Credit Scoring",
        shortName: "Credit",
        description: "Data upload, ML model training, and scoring API",
        icon: BrainCircuit,
        color: "blue",
        badgeClasses: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
        dependencies: [],
        navItems: [
            { path: "data", label: "Data", icon: Database },
            { path: "training", label: "Training Runs", icon: BrainCircuit },
            { path: "models", label: "Models", icon: Shield },
        ],
    },
    policy_engine: {
        id: "policy_engine",
        name: "Policy Engine",
        shortName: "Policy",
        description: "Approval thresholds, decile analysis, and policy simulation",
        icon: Sliders,
        color: "purple",
        badgeClasses: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
        dependencies: ["credit_scoring"],
        navItems: [
            { path: "policy", label: "Policy", icon: Sliders },
        ],
    },
    fraud_detection: {
        id: "fraud_detection",
        name: "Fraud Detection",
        shortName: "Fraud",
        description: "Fraud model training, risk tier configuration, and disposition management",
        icon: ShieldAlert,
        color: "orange",
        badgeClasses: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
        dependencies: [],
        navItems: [
            { path: "fraud/overview", label: "Fraud Overview", icon: ShieldAlert },
            { path: "fraud/data", label: "Fraud Data", icon: Database },
            { path: "fraud/training", label: "Fraud Training", icon: BrainCircuit },
            { path: "fraud/models", label: "Fraud Models", icon: Shield },
            { path: "fraud/tiers", label: "Risk Tiers", icon: Sliders },
        ],
    },
    exposure_control: {
        id: "exposure_control",
        name: "Exposure Control",
        shortName: "Exposure",
        description: "Portfolio limits, utilization tracking, and concentration alerts",
        icon: DollarSign,
        color: "green",
        badgeClasses: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
        dependencies: ["policy_engine"],
        navItems: [
            { path: "exposure", label: "Exposure Control", icon: DollarSign },
        ],
    },
};

// ─── Module ordering (display order) ─────────────────────────

export const MODULE_ORDER: SystemModule[] = [
    "credit_scoring",
    "policy_engine",
    "exposure_control",
    "fraud_detection",
];

// ─── Templates ───────────────────────────────────────────────

export interface SystemTemplate {
    id: string;
    name: string;
    description: string;
    modules: SystemModule[];
    emoji: string;
}

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
    {
        id: "credit_decisioning",
        name: "Credit Decisioning",
        description: "Score applications and auto-approve with policy thresholds",
        modules: ["credit_scoring", "policy_engine"],
        emoji: "📊",
    },
    {
        id: "fraud_prevention",
        name: "Fraud Prevention",
        description: "Detect and investigate fraud with scoring, queues, and rules",
        modules: ["fraud_detection"],
        emoji: "🛡",
    },
    {
        id: "full_underwriting",
        name: "Full Underwriting",
        description: "Complete decisioning with credit, fraud, policy, and exposure",
        modules: ["credit_scoring", "policy_engine", "fraud_detection", "exposure_control"],
        emoji: "⚡",
    },
];

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Given a set of selected modules, return the full set including
 * all transitive dependencies.
 */
export function resolveModuleDependencies(selected: SystemModule[]): SystemModule[] {
    const resolved = new Set<SystemModule>(selected);
    let changed = true;

    while (changed) {
        changed = false;
        for (const modId of resolved) {
            for (const dep of MODULE_REGISTRY[modId].dependencies) {
                if (!resolved.has(dep)) {
                    resolved.add(dep);
                    changed = true;
                }
            }
        }
    }

    // Return in display order
    return MODULE_ORDER.filter((m) => resolved.has(m));
}

/**
 * Check if a module can be disabled without breaking dependencies.
 * Returns the list of modules that depend on it.
 */
export function getModuleDependents(
    moduleId: SystemModule,
    enabledModules: SystemModule[]
): SystemModule[] {
    return enabledModules.filter(
        (m) => m !== moduleId && MODULE_REGISTRY[m].dependencies.includes(moduleId)
    );
}

/**
 * Check if a specific module is enabled for a system.
 */
export function isModuleEnabled(
    enabledModules: SystemModule[] | undefined,
    moduleId: SystemModule
): boolean {
    // Fallback: if no modules field, assume all enabled (backward compat)
    if (!enabledModules || enabledModules.length === 0) return true;
    return enabledModules.includes(moduleId);
}

/**
 * Map a system_type to the modules it includes.
 */
export function getModulesForSystemType(systemType: string): SystemModule[] {
    switch (systemType) {
        case "credit":
            return ["credit_scoring", "policy_engine", "exposure_control"];
        case "fraud":
            return ["fraud_detection"];
        case "full":
        default:
            return [...MODULE_ORDER];
    }
}

/**
 * Build the navigation items for a system based on its system_type.
 * Falls back to enabled_modules for backward compatibility.
 */
export function buildNavItems(
    systemId: string,
    enabledModules: SystemModule[] | undefined,
    systemType?: string
): { to: string; icon: LucideIcon; label: string }[] {
    // Prefer system_type if available
    const modules = systemType
        ? getModulesForSystemType(systemType)
        : enabledModules && enabledModules.length > 0
            ? enabledModules
            : MODULE_ORDER;

    const items: { to: string; icon: LucideIcon; label: string }[] = [];

    for (const moduleId of MODULE_ORDER) {
        if (!modules.includes(moduleId)) continue;
        const mod = MODULE_REGISTRY[moduleId];
        for (const nav of mod.navItems) {
            items.push({
                to: `/systems/${systemId}/${nav.path}`,
                icon: nav.icon,
                label: nav.label,
            });
        }
    }

    return items;
}

/**
 * Get the route-segment-to-label mapping for breadcrumbs,
 * based on enabled modules.
 */
export function getRouteLabels(): Record<string, string> {
    const labels: Record<string, string> = {
        overview: "Overview",
        deployments: "Integration",
        decisions: "Decisions",
        systems: "Decision Systems",
        modules: "Modules",
    };

    for (const mod of MODULE_ORDER) {
        for (const nav of MODULE_REGISTRY[mod].navItems) {
            labels[nav.path] = nav.label;
        }
    }

    // Fraud sub-pages
    labels["overview"] = "Fraud Overview";
    labels["detection"] = "Fraud Overview";
    labels["data"] = "Fraud Data";
    labels["training"] = "Fraud Training";
    labels["workflow"] = "Review Workflow";
    labels["operations"] = "Fraud Operations";
    labels["queue"] = "Case Queue";
    labels["cases"] = "Case Detail";
    labels["rules"] = "Detection Rules";

    labels["tiers"] = "Risk Tiers";
    labels["signals"] = "Signal Providers";
    labels["settings"] = "Automation Settings";
    labels["monitoring"] = "Monitoring";

    return labels;
}

/**
 * Map a route path segment to the module that owns it.
 */
export function getModuleForPath(pathSegment: string): SystemModule | null {
    for (const mod of MODULE_ORDER) {
        for (const nav of MODULE_REGISTRY[mod].navItems) {
            if (nav.path === pathSegment) return mod;
        }
    }
    // Fraud sub-routes
    if (["overview", "detection", "data", "training", "workflow", "operations", "queue", "cases", "rules", "models", "tiers", "signals", "settings"].includes(pathSegment)) {
        return "fraud_detection";
    }
    return null;
}
