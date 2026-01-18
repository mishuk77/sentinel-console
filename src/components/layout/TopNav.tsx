import { NavLink, Link } from "react-router-dom";
import {
    LayoutDashboard,
    Gavel,
    ShieldCheck,
    Server,
    Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/systems", icon: Server, label: "Decision Systems" },
    { to: "/decisions", icon: Gavel, label: "Decisions" },
    { to: "/monitoring", icon: Activity, label: "Monitoring" }, // Placeholder
];

export function TopNav() {
    return (
        <header className="h-16 border-b bg-card flex items-center px-6 sticky top-0 z-50">
            <Link to="/" className="flex items-center mr-8">
                <ShieldCheck className="h-6 w-6 text-primary mr-2" />
                <span className="font-bold text-lg tracking-tight">Sentinel Console</span>
            </Link>

            <nav className="flex items-center space-x-4">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                isActive
                                    ? "text-primary bg-primary/10"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )
                        }
                    >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            <div className="ml-auto text-xs text-muted-foreground">
                v2.0 • Fintech OS
            </div>
        </header>
    );
}
