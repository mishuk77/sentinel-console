import { useOutletContext, Link, useParams } from "react-router-dom";
import type { DecisionSystem } from "@/lib/api";
import { MODULE_REGISTRY, getModulesForSystemType, type SystemModule } from "@/lib/modules";
import { ShieldOff } from "lucide-react";

interface ModuleGuardProps {
    module: SystemModule;
    children: React.ReactNode;
}

/**
 * Wraps a route component and checks whether the required module
 * is available for the current system's type. If not, shows upgrade prompt.
 */
export default function ModuleGuard({ module, children }: ModuleGuardProps) {
    const { system } = useOutletContext<{ system: DecisionSystem }>();
    const { systemId } = useParams<{ systemId: string }>();

    const sysType = system.system_type || "full";
    const availableModules = getModulesForSystemType(sysType);

    if (availableModules.includes(module)) {
        return <>{children}</>;
    }

    const mod = MODULE_REGISTRY[module];
    const typeLabel = sysType === "credit" ? "Credit Risk" : sysType === "fraud" ? "Fraud Detection" : "Full Pipeline";

    return (
        <div className="flex items-center justify-center min-h-[60vh] p-8">
            <div className="max-w-md text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    <ShieldOff className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold">
                    {mod.name} not available
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    This is a <strong>{typeLabel}</strong> system. The {mod.name} module
                    requires upgrading to <strong>Full Pipeline</strong>.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                    <Link
                        to={`/systems/${systemId}/overview`}
                        className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Back to Overview
                    </Link>
                </div>
            </div>
        </div>
    );
}
