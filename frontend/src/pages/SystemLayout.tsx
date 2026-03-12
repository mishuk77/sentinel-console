import { Outlet, NavLink, useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DecisionSystem, type SystemType } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { LayoutDashboard, ArrowLeft, Globe, LogOut, Activity, ArrowUpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { buildNavItems } from "@/lib/modules";

export default function SystemLayout() {
    const { systemId } = useParams<{ systemId: string }>();
    const { logout } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: system, isLoading } = useQuery<DecisionSystem>({
        queryKey: ["system", systemId],
        queryFn: async () => {
            const res = await api.get(`/systems/${systemId}`);
            return res.data;
        },
        enabled: !!systemId
    });

    const upgradeMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/systems/${systemId}/upgrade`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["system", systemId] });
            queryClient.invalidateQueries({ queryKey: ["systems"] });
        },
    });

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading system context...</div>;
    if (!system) return <div className="p-12 text-center text-down">System not found</div>;

    const sysType: SystemType = system.system_type || "full";

    // Build navigation dynamically from system_type
    const moduleNavItems = buildNavItems(systemId!, undefined, sysType);

    const navItems = [
        { to: `/systems/${systemId}/overview`, icon: LayoutDashboard, label: "Overview" },
        ...moduleNavItems,
        { to: `/systems/${systemId}/monitoring`, icon: Activity, label: "Monitoring" },
        { to: `/systems/${systemId}/deployments`, icon: Globe, label: "Integration" },
    ];

    return (
        <div className="flex flex-col min-h-screen">
            {/* Context Header */}
            <div className="bg-muted/30 border-b px-8 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/systems" className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                            {system.name}
                        </h2>
                        <p className="text-xs text-muted-foreground font-mono">ID: {system.id}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "badge",
                            sysType === "credit" ? "badge-blue" :
                            sysType === "fraud" ? "badge-amber" :
                            "badge-green"
                        )}>
                            {sysType === "credit" ? "Credit Risk" :
                             sysType === "fraud" ? "Fraud Detection" :
                             "Full Pipeline"}
                        </span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-down"
                        title="Sign out"
                    >
                        <LogOut className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1">
                {/* Side Nav */}
                <aside className="w-64 border-r bg-muted/10 p-4 space-y-2 hidden md:block">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) => cn(
                                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            )}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.label}
                        </NavLink>
                    ))}

                    {/* Upgrade to Full Pipeline */}
                    {sysType !== "full" && (
                        <div className="pt-4 mt-4 border-t">
                            <button
                                onClick={() => {
                                    if (window.confirm("Upgrade this system to Full Pipeline? This adds all modules and cannot be undone.")) {
                                        upgradeMutation.mutate();
                                    }
                                }}
                                disabled={upgradeMutation.isPending}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
                            >
                                <ArrowUpCircle className="h-4 w-4" />
                                Upgrade to Full Pipeline
                            </button>
                        </div>
                    )}
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 bg-background/50">
                    {/* Breadcrumb Navigation */}
                    <div className="px-8 py-3 border-b bg-muted/20">
                        <Breadcrumbs systemName={system.name} />
                    </div>
                    <Outlet context={{ system }} />
                </main>
            </div>
        </div>
    );
}
