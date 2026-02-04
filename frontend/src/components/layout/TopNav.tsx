import { NavLink, Link } from "react-router-dom";
import {
    LayoutDashboard,
    Gavel,
    ShieldCheck,
    Server,
    Activity,
    Sun,
    Moon,
    Monitor
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/ThemeContext";
import { useState, useRef, useEffect } from "react";

const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/systems", icon: Server, label: "Decision Systems" },
    { to: "/decisions", icon: Gavel, label: "Decisions" },
    { to: "/monitoring", icon: Activity, label: "Monitoring" }, // Placeholder
];

function ThemeToggle() {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const themeOptions = [
        { value: "light" as const, label: "Light", icon: Sun },
        { value: "dark" as const, label: "Dark", icon: Moon },
        { value: "system" as const, label: "System", icon: Monitor },
    ];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "p-2 rounded-lg transition-colors",
                    "hover:bg-accent text-muted-foreground hover:text-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
                title={`Theme: ${theme}`}
            >
                {resolvedTheme === "dark" ? (
                    <Moon className="h-4 w-4" />
                ) : (
                    <Sun className="h-4 w-4" />
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-36 bg-card border rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    {themeOptions.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => {
                                setTheme(option.value);
                                setIsOpen(false);
                            }}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                                theme === option.value
                                    ? "bg-primary/10 text-primary font-medium"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}
                        >
                            <option.icon className="h-4 w-4" />
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

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

            <div className="ml-auto flex items-center gap-4">
                <ThemeToggle />
                <span className="text-xs text-muted-foreground">
                    v2.0 • Fintech OS
                </span>
            </div>
        </header>
    );
}
