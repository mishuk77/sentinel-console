import { useOutletContext, Link, useParams } from "react-router-dom";
import type { DecisionSystem } from "@/lib/api";
import { MODULE_REGISTRY, isModuleEnabled, type SystemModule } from "@/lib/modules";
import { ShieldOff } from "lucide-react";

interface ModuleGuardProps {
    module: SystemModule;
    children: React.ReactNode;
}

/**
 * Wraps a route component and checks whether the required module
 * is enabled on the current system.  If not, renders an activation
 * prompt instead of a 404.
 */
export default function ModuleGuard({ module, children }: ModuleGuardProps) {
    const { system } = useOutletContext<{ system: DecisionSystem }>();
    const { systemId } = useParams<{ systemId: string }>();

    if (isModuleEnabled(system.enabled_modules, module)) {
        return <>{children}</>;
    }

    const mod = MODULE_REGISTRY[module];
    const Icon = mod.icon;

    return (
        <div className="flex items-center justify-center min-h-[60vh] p-8">
            <div className="max-w-md text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    <ShieldOff className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold">
                    {mod.name} is not enabled
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    This system doesn't have the {mod.name} module.
                    Enable it to access {mod.description.toLowerCase()}.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                    <Link
                        to={`/systems/${systemId}/modules`}
                        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
                    >
                        <Icon className="h-4 w-4" />
                        Enable {mod.shortName}
                    </Link>
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
