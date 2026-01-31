import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbsProps {
    systemName?: string;
}

// Map route segments to display names
const routeLabels: Record<string, string> = {
    overview: "Overview",
    data: "Datasets",
    training: "Training Jobs",
    models: "Model Registry",
    policy: "Policy Configuration",
    exposure: "Exposure Control",
    fraud: "Fraud Management",
    queue: "Case Queue",
    cases: "Case Detail",
    rules: "Rules",
    deployments: "Integration",
    decisions: "Decisions",
    systems: "Decision Systems",
};

export function Breadcrumbs({ systemName }: BreadcrumbsProps) {
    const location = useLocation();
    const { systemId, id: modelId } = useParams();

    // Parse the path into segments
    const pathSegments = location.pathname.split("/").filter(Boolean);

    // Build breadcrumb items
    const items: { label: string; href?: string }[] = [];

    // Always start with home -> systems
    items.push({ label: "Home", href: "/" });
    items.push({ label: "Systems", href: "/systems" });

    // If we have a systemId, add the system name
    if (systemId) {
        items.push({
            label: systemName || "System",
            href: `/systems/${systemId}/overview`
        });

        // Find the current page segment
        const systemIndex = pathSegments.indexOf(systemId);
        if (systemIndex >= 0 && pathSegments[systemIndex + 1]) {
            const pageSegment = pathSegments[systemIndex + 1];
            const pageLabel = routeLabels[pageSegment] || pageSegment;

            // If we're on a model detail page
            if (pageSegment === "models" && modelId) {
                items.push({
                    label: pageLabel,
                    href: `/systems/${systemId}/models`
                });
                items.push({
                    label: `Model ${modelId.slice(0, 8)}...`,
                    href: undefined // Current page
                });
            } else if (pageSegment === "fraud") {
                // Handle nested fraud routes
                const subSegment = pathSegments[systemIndex + 2];

                if (subSegment === "queue") {
                    items.push({
                        label: pageLabel,
                        href: `/systems/${systemId}/fraud`
                    });
                    items.push({
                        label: routeLabels.queue,
                        href: undefined
                    });
                } else if (subSegment === "cases") {
                    const caseId = pathSegments[systemIndex + 3];
                    items.push({
                        label: pageLabel,
                        href: `/systems/${systemId}/fraud`
                    });
                    items.push({
                        label: routeLabels.queue,
                        href: `/systems/${systemId}/fraud/queue`
                    });
                    items.push({
                        label: caseId ? `Case ${caseId.slice(0, 8)}...` : "Case Detail",
                        href: undefined
                    });
                } else if (subSegment === "rules") {
                    items.push({
                        label: pageLabel,
                        href: `/systems/${systemId}/fraud`
                    });
                    items.push({
                        label: routeLabels.rules,
                        href: undefined
                    });
                } else {
                    items.push({
                        label: pageLabel,
                        href: undefined
                    });
                }
            } else {
                items.push({
                    label: pageLabel,
                    href: undefined // Current page
                });
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
