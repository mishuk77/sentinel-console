import { Outlet, NavLink, useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DecisionSystem } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { LayoutDashboard, Database, BrainCircuit, Shield, ArrowLeft, Globe, Settings as Sliders, LogOut, DollarSign, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";

export default function SystemLayout() {
    const { systemId } = useParams<{ systemId: string }>();
    const { logout } = useAuth();
    const navigate = useNavigate();

    const { data: system, isLoading } = useQuery<DecisionSystem>({
        queryKey: ["system", systemId],
        queryFn: async () => {
            const res = await api.get(`/systems/${systemId}`);
            return res.data;
        },
        enabled: !!systemId
    });

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading system context...</div>;
    if (!system) return <div className="p-12 text-center text-red-500">System not found</div>;

    const navItems = [
        { to: `/systems/${systemId}/overview`, icon: LayoutDashboard, label: "Overview" },
        { to: `/systems/${systemId}/data`, icon: Database, label: "Data" },
        { to: `/systems/${systemId}/training`, icon: BrainCircuit, label: "Training Runs" },
        { to: `/systems/${systemId}/models`, icon: Shield, label: "Models" },
        { to: `/systems/${systemId}/policy`, icon: Sliders, label: "Policy" },
        { to: `/systems/${systemId}/exposure`, icon: DollarSign, label: "Exposure Control" },
        { to: `/systems/${systemId}/fraud`, icon: ShieldAlert, label: "Fraud Management" },
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
                    <div className="text-xs text-muted-foreground">
                        Decision System Workspace
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-red-500"
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
