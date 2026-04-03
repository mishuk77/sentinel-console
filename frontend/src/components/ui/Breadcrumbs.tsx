import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbsProps {
    systemName?: string;
}

// Section 1: Credit pipeline routes (top-level under system)
const creditLabels: Record<string, string> = {
    overview: "System Overview",
    data: "Datasets",
    training: "Training Runs",
    models: "Models",
    policy: "Policy",
    exposure: "Exposure Control",
};

// Section 2: Fraud pipeline routes (under system/fraud/*)
const fraudLabels: Record<string, string> = {
    overview: "Fraud Overview",
    detection: "Fraud Overview",
    data: "Fraud Data",
    training: "Fraud Training",
    models: "Fraud Models",
    tiers: "Risk Tiers",
    queue: "Case Queue",
    cases: "Case Detail",
    rules: "Detection Rules",
    signals: "Signal Providers",
    settings: "Fraud Settings",
    operations: "Operations",
    workflow: "Review Workflow",
};

// Section 3: Other routes
const otherLabels: Record<string, string> = {
    monitoring: "Monitoring",
    deployments: "Integration",
    decisions: "Decisions",
};

export function Breadcrumbs({ systemName }: BreadcrumbsProps) {
    const location = useLocation();
    const { systemId, id: modelId } = useParams();

    const pathSegments = location.pathname.split("/").filter(Boolean);
    const items: { label: string; href?: string }[] = [];

    items.push({ label: "Home", href: "/" });
    items.push({ label: "Systems", href: "/systems" });

    if (systemId) {
        items.push({
            label: systemName || "System",
            href: `/systems/${systemId}/overview`
        });

        const systemIndex = pathSegments.indexOf(systemId);
        if (systemIndex >= 0 && pathSegments[systemIndex + 1]) {
            const pageSegment = pathSegments[systemIndex + 1];

            if (pageSegment === "fraud") {
                // Section 2: Fraud routes — show "Fraud Overview" as parent
                const subSegment = pathSegments[systemIndex + 2];

                if (subSegment && subSegment !== "overview" && subSegment !== "detection") {
                    // Nested fraud page: Fraud Overview > Sub-page
                    items.push({
                        label: "Fraud Overview",
                        href: `/systems/${systemId}/fraud/overview`
                    });

                    if (subSegment === "cases") {
                        const caseId = pathSegments[systemIndex + 3];
                        items.push({
                            label: "Case Queue",
                            href: `/systems/${systemId}/fraud/queue`
                        });
                        items.push({
                            label: caseId ? `Case ${caseId.slice(0, 8)}...` : "Case Detail",
                        });
                    } else {
                        items.push({
                            label: fraudLabels[subSegment] || subSegment,
                        });
                    }
                } else {
                    // Fraud overview itself
                    items.push({ label: "Fraud Overview" });
                }
            } else if (pageSegment === "models" && modelId) {
                // Model detail page
                items.push({
                    label: "Models",
                    href: `/systems/${systemId}/models`
                });
                items.push({
                    label: `Model ${modelId.slice(0, 8)}...`,
                });
            } else {
                // Section 1 (credit) or Section 3 (other)
                const label = creditLabels[pageSegment]
                    || otherLabels[pageSegment]
                    || pageSegment;
                items.push({ label });
            }
        }
    }

    return (
        <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;

                return (
                    <div key={index} className="flex items-center gap-1">
                        {index === 0 && (
                            <Home className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
                        )}

                        {item.href && !isLast ? (
                            <Link
                                to={item.href}
                                className={cn(
                                    "text-muted-foreground hover:text-foreground transition-colors",
                                    "hover:underline underline-offset-2"
                                )}
                            >
                                {item.label}
                            </Link>
                        ) : (
                            <span className={cn(
                                isLast
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground"
                            )}>
                                {item.label}
                            </span>
                        )}

                        {!isLast && (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
