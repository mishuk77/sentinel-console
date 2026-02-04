import { useOutletContext } from "react-router-dom";
import type { DecisionSystem } from "@/lib/api";

type SystemContextType = {
    system: DecisionSystem;
};

export function useSystem() {
    return useOutletContext<SystemContextType>();
}
