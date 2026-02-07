import { useOutletContext, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DecisionSystem } from "@/lib/api";
import {
    MODULE_REGISTRY,
    MODULE_ORDER,
    resolveModuleDependencies,
    getModuleDependents,
    type SystemModule,
} from "@/lib/modules";
import { Check, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SystemModules() {
    const { system } = useOutletContext<{ system: DecisionSystem }>();
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();

    const enabledModules: SystemModule[] = system.enabled_modules?.length
        ? (system.enabled_modules as SystemModule[])
        : MODULE_ORDER;

    const updateModules = useMutation({
        mutationFn: async (modules: SystemModule[]) => {
            const res = await api.patch(`/systems/${systemId}`, {
                enabled_modules: modules,
            });
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
        },
    });

    const handleEnable = (moduleId: SystemModule) => {
        const updated = resolveModuleDependencies([
            ...enabledModules,
            moduleId,
        ]);
        updateModules.mutate(updated);
    };

    const handleDisable = (moduleId: SystemModule) => {
        const dependents = getModuleDependents(moduleId, enabledModules);
        if (dependents.length > 0) {
            // Also remove dependents
            const toRemove = new Set([moduleId, ...dependents]);
            const updated = enabledModules.filter((m) => !toRemove.has(m));
            if (
                window.confirm(
                    `Disabling ${MODULE_REGISTRY[moduleId].name} will also disable ${dependents.map((d) => MODULE_REGISTRY[d].name).join(", ")}. Continue?`
                )
            ) {
                updateModules.mutate(updated);
            }
        } else {
            const updated = enabledModules.filter((m) => m !== moduleId);
            updateModules.mutate(updated);
        }
    };

    const activeModules = MODULE_ORDER.filter((m) =>
        enabledModules.includes(m)
    );
    const availableModules = MODULE_ORDER.filter(
        (m) => !enabledModules.includes(m)
    );

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">
                    System Modules
                </h1>
                <p className="text-muted-foreground mt-1">
                    Enable or disable modules for this decision system.
                    Dependencies are managed automatically.
                </p>
            </div>

            {updateModules.isError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    Failed to update modules. Please try again.
                </div>
            )}

            {/* Active Modules */}
            <div>
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Active Modules ({activeModules.length})
                </h2>
                <div className="space-y-3">
                    {activeModules.map((moduleId) => {
                        const mod = MODULE_REGISTRY[moduleId];
                        const Icon = mod.icon;
                        const isRequired =
                            enabledModules.length === 1 ||
                            enabledModules.some(
                                (m) =>
                                    m !== moduleId &&
                                    MODULE_REGISTRY[m].dependencies.includes(
                                        moduleId
                                    )
                            );

                        return (
                            <div
                                key={moduleId}
                                className="flex items-center gap-4 p-4 bg-card border rounded-xl"
                            >
                                <div
                                    className={cn(
                                        "p-2.5 rounded-lg",
                                        mod.badgeClasses
                                    )}
                                >
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium flex items-center gap-2">
                                        {mod.name}
                                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
                                            <Check className="h-3 w-3" />
                                            Active
                                        </span>
                                    </div>
                                    <div className="text-sm text-muted-foreground mt-0.5">
                                        {mod.description}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDisable(moduleId)}
                                    disabled={
                                        isRequired || updateModules.isPending
                                    }
                                    className={cn(
                                        "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                                        isRequired
                                            ? "text-muted-foreground/40 border-transparent cursor-not-allowed"
                                            : "text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                                    )}
                                    title={
                                        isRequired
                                            ? "Required by other active modules"
                                            : `Disable ${mod.name}`
                                    }
                                >
                                    {updateModules.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        "Disable"
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Available Modules */}
            {availableModules.length > 0 && (
                <div>
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                        Available Modules ({availableModules.length})
                    </h2>
                    <div className="space-y-3">
                        {availableModules.map((moduleId) => {
                            const mod = MODULE_REGISTRY[moduleId];
                            const Icon = mod.icon;
                            const missingDeps = mod.dependencies.filter(
                                (d) =>
                                    !enabledModules.includes(d as SystemModule)
                            );

                            return (
                                <div
                                    key={moduleId}
                                    className="flex items-center gap-4 p-4 bg-muted/30 border border-dashed rounded-xl"
                                >
                                    <div className="p-2.5 rounded-lg bg-muted">
                                        <Icon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium">
                                            {mod.name}
                                        </div>
                                        <div className="text-sm text-muted-foreground mt-0.5">
                                            {mod.description}
                                        </div>
                                        {missingDeps.length > 0 && (
                                            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                                Will also enable:{" "}
                                                {missingDeps
                                                    .map(
                                                        (d) =>
                                                            MODULE_REGISTRY[
                                                                d as SystemModule
                                                            ].name
                                                    )
                                                    .join(", ")}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleEnable(moduleId)}
                                        disabled={updateModules.isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                    >
                                        {updateModules.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Plus className="h-4 w-4" />
                                                Enable
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
