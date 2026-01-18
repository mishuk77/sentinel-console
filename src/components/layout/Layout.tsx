import { Outlet } from "react-router-dom";
import { TopNav } from "./TopNav";

export function Layout() {
    return (
        <div className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col">
            <TopNav />
            <main className="flex-1 w-full">
                <Outlet />
            </main>
        </div>
    );
}
