import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { authAPI } from "@/lib/api";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await authAPI.login({ username: email, password });
            const { access_token, client_id, role } = res.data;
            login(access_token, { client_id, role, email });
            navigate("/systems");
        } catch (err: any) {
            setError(err.response?.data?.detail || "Invalid credentials. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex">
            {/* Left panel — branding */}
            <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] bg-card border-r flex-col p-10 shrink-0">
                {/* Logo */}
                <div className="flex items-center gap-2.5">
                    <img src="/sentinel.svg" alt="Sentinel" className="h-7 w-7" />
                    <span className="font-bold text-base tracking-tight">Sentinel</span>
                    <span className="text-2xs font-medium text-muted-foreground/60 border border-border rounded px-1.5 py-0.5 ml-0.5">
                        CONSOLE
                    </span>
                </div>

                {/* Main copy */}
                <div className="mt-auto">
                    <h1 className="text-3xl font-bold tracking-tight leading-snug mb-4">
                        Decision intelligence<br />for financial services
                    </h1>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-10 max-w-xs">
                        Manage credit models, policy engines, fraud detection, and real-time decisioning from a single command center.
                    </p>

                    {/* Feature list */}
                    <div className="space-y-3">
                        {[
                            ["Credit Scoring", "Train and deploy ML models with full audit trails"],
                            ["Policy Engine", "Segment-level thresholds with confidence scoring"],
                            ["Fraud Detection", "Real-time case management and rule orchestration"],
                        ].map(([title, desc]) => (
                            <div key={title} className="flex items-start gap-3">
                                <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-semibold">{title}</p>
                                    <p className="text-2xs text-muted-foreground">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-6 border-t">
                    <p className="text-2xs text-muted-foreground">
                        Sentinel Decisions Platform · Enterprise Edition
                    </p>
                </div>
            </div>

            {/* Right panel — form */}
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="w-full max-w-sm">
                    {/* Mobile logo */}
                    <div className="flex items-center gap-2 mb-10 lg:hidden">
                        <img src="/sentinel.svg" alt="Sentinel" className="h-6 w-6" />
                        <span className="font-bold text-sm">Sentinel</span>
                    </div>

                    <div className="mb-8">
                        <h2 className="text-xl font-bold tracking-tight">Sign in</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Access your decision systems
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 text-xs text-down bg-down/8 border border-down/20 rounded flex items-start gap-2">
                                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="field-label" htmlFor="email">Email</label>
                            <input
                                id="email"
                                type="email"
                                placeholder="you@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="field-input"
                                required
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="field-label" htmlFor="password">Password</label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="field-input"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full mt-2"
                        >
                            {loading
                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing in…</>
                                : <><ArrowRight className="h-3.5 w-3.5" /> Sign In</>
                            }
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t">
                        <p className="text-2xs text-muted-foreground">Demo credentials</p>
                        <p className="text-xs font-mono text-muted-foreground mt-1">
                            admin@sentineldecisions.com / admin123
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
