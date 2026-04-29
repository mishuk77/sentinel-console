import { NavLink, Link, useNavigate } from "react-router-dom";
import {
    LayoutDashboard,
    Gavel,
    Server,
    Activity,
    Sun,
    Moon,
    Monitor,
    LogOut,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/AuthContext";
import { useState, useRef, useEffect } from "react";

const navItems = [
    { to: "/",          icon: LayoutDashboard, label: "Dashboard"        },
    { to: "/systems",   icon: Server,          label: "Decision Systems" },
    { to: "/decisions", icon: Gavel,           label: "Decisions"        },
    { to: "/monitoring",icon: Activity,        label: "Monitoring"       },
];

function ThemeToggle() {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const options = [
        { value: "light"  as const, label: "Light",  icon: Sun     },
        { value: "dark"   as const, label: "Dark",   icon: Moon    },
        { value: "system" as const, label: "System", icon: Monitor },
    ];

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={`Theme: ${theme}`}
            >
                {resolvedTheme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-1.5 w-32 bg-popover border border-border rounded shadow-xl py-1 z-50">
                    {options.map((o) => (
                        <button
                            key={o.value}
                            onClick={() => { setTheme(o.value); setIsOpen(false); }}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                                theme === o.value
                                    ? "text-primary font-medium bg-primary/8"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )}
                        >
                            <o.icon className="h-3 w-3" />
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function UserMenu() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onMouse = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
        document.addEventListener("mousedown", onMouse);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("mousedown", onMouse); document.removeEventListener("keydown", onKey); };
    }, []);

    const handleLogout = () => { logout(); navigate("/login"); };

    const email = user?.email || "";
    const initials = email ? email.slice(0, 2).toUpperCase() : (user?.role?.[0] || "U").toUpperCase();
    const displayName = email || user?.role || "User";
    const role = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded transition-colors",
                    "hover:bg-accent focus:outline-none",
                    isOpen && "bg-accent"
                )}
            >
                <div className="h-6 w-6 rounded-sm bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
                    <span className="text-2xs font-bold text-primary leading-none">{initials}</span>
                </div>
                <span className="text-xs font-medium text-foreground hidden sm:block max-w-28 truncate">{displayName}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1.5 w-52 bg-popover border border-border rounded shadow-xl py-1 z-50">
                    <div className="px-3 py-2.5 border-b border-border">
                        <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
                        {role && <p className="text-2xs text-muted-foreground capitalize mt-0.5">{role}</p>}
                    </div>
                    <div className="py-1">
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-down hover:bg-down/8 transition-colors"
                        >
                            <LogOut className="h-3.5 w-3.5" />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function BuildIndicator() {
    // __BUILD_TIME__ is injected by Vite at build time (see vite.config.ts).
    // Format DD:HH:MM in UTC so the user can verify the live deploy matches
    // the latest push.
    const iso = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "";
    if (!iso) return null;
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${pad(d.getUTCDate())}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const full = d.toUTCString();
    return (
        <span
            title={`Build: ${full} (UTC). Format DD:HH:MM`}
            className="hidden md:inline-flex items-center gap-1 text-2xs font-mono text-muted-foreground/70 px-2 py-0.5 rounded border border-border/60"
        >
            <span className="text-muted-foreground/50">Platform last updated</span>
            <span className="text-foreground/80">{stamp}</span>
            <span className="text-muted-foreground/40">UTC</span>
        </span>
    );
}

export function TopNav() {
    return (
        <header className="h-12 border-b border-border bg-card flex items-center px-5 sticky top-0 z-50 shrink-0">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 mr-8 shrink-0">
                <img src="/sentinel.svg" alt="Sentinel" className="h-5 w-5" />
                <span className="font-semibold text-sm tracking-tight text-foreground">Sentinel</span>
                <span className="hidden md:block text-2xs font-medium text-muted-foreground/60 border border-border rounded px-1.5 py-0.5 ml-1">
                    CONSOLE
                </span>
            </Link>

            {/* Primary nav */}
            <nav className="flex items-center gap-0.5">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                                isActive
                                    ? "text-primary bg-primary/10"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                            )
                        }
                    >
                        <item.icon className="h-3.5 w-3.5 shrink-0" />
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            {/* Right controls */}
            <div className="ml-auto flex items-center gap-1">
                <BuildIndicator />
                <div className="w-px h-4 bg-border mx-1" />
                <ThemeToggle />
                <div className="w-px h-4 bg-border mx-1" />
                <UserMenu />
            </div>
        </header>
    );
}
