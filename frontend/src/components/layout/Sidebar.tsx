import { NavLink } from "react-router-dom";
import {
    LayoutDashboard,
    Database,
    BrainCircuit,
    Scale,
    Gavel,
    PlaySquare,
    ShieldCheck,
    Server
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/datasets", icon: Database, label: "Datasets" },
    { to: "/training-jobs", icon: PlaySquare, label: "Training Jobs" },
    { to: "/models", icon: BrainCircuit, label: "Models" },
    { to: "/deployments", icon: Server, label: "Deployments" },
    { to: "/policy", icon: Scale, label: "Policy" },
    { to: "/decisions", icon: Gavel, label: "Decisions" },
];

export function Sidebar() {
    return (
        <aside className="w-64 border-r bg-card h-screen flex flex-col sticky top-0">
            <div className="h-16 flex items-center px-6 border-b">
                <ShieldCheck className="h-6 w-6 text-primary mr-2" />
                <span className="font-bold text-lg tracking-tight">Sentinel Console</span>
            </div>

            <nav className="flex-1 p-4 space-y-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )
                        }
                    >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            <div className="p-4 border-t">
                <div className="text-xs text-muted-foreground text-center">
                    Environment: Local
                </div>
            </div>
        </aside>
    );
}
