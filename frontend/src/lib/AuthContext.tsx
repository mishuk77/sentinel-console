import { createContext, useContext, useState, type ReactNode } from "react";

interface User {
    client_id: string;
    role: string;
    // We could add email here if we returned it, but role/client_id is enough for now
}

interface AuthContextType {
    token: string | null;
    user: User | null;
    login: (token: string, user: User) => void;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
    const [user, setUser] = useState<User | null>(() => {
        const stored = localStorage.getItem("user");
        return stored ? JSON.parse(stored) : null;
    });

    const login = (newToken: string, newUser: User) => {
        setToken(newToken);
        setUser(newUser);
        localStorage.setItem("token", newToken);
        localStorage.setItem("user", JSON.stringify(newUser));
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        // Optional: Redirect to login is handled by ProtectedRoute
    };

    return (
        <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated: !!token }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
