import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import Dashboard from "@/pages/Dashboard";
import Datasets from "@/pages/Datasets";
import TrainingJobs from "@/pages/TrainingJobs";
import Models from "@/pages/Models";
import ModelDetail from "@/pages/ModelDetail";
import Deployments from "@/pages/Deployments";
import Policy from "@/pages/Policy";
import ExposureControl from "@/pages/ExposureControl";
import SimulationSummary from "@/pages/SimulationSummary";
import EngineBacktest from "@/pages/EngineBacktest";
import FraudOverview from "@/pages/FraudOverview";
import FraudData from "@/pages/FraudData";
import FraudTraining from "@/pages/FraudTraining";
import FraudModels from "@/pages/FraudModels";
import FraudTiers from "@/pages/FraudTiers";
import Monitoring from "@/pages/Monitoring";
import Decisions from "@/pages/Decisions";
import DecisionSystems from "@/pages/DecisionSystems";
import SystemLayout from "@/pages/SystemLayout";
import SystemOverview from "@/pages/SystemOverview";
import Login from "@/pages/Login";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { Navigate } from "react-router-dom";
import ModuleGuard from "@/components/ModuleGuard";

const ROUTE_TITLES: [RegExp, string][] = [
  [/^\/login$/,                          "Sign In"],
  [/^\/$/,                               "Dashboard"],
  [/^\/systems$/,                        "Decision Systems"],
  [/\/overview$/,                        "System Overview"],
  [/\/deployments/,                      "Deployments"],
  [/\/data$/,                            "Datasets"],
  [/\/training$/,                        "Training"],
  [/\/models\/[^/]+$/,                   "Model Detail"],
  [/\/models$/,                          "Models"],
  [/\/policy$/,                          "Policy Engine"],
  [/\/exposure$/,                        "Exposure Control"],
  [/\/monitoring$/,                      "Monitoring"],
  [/\/fraud\/cases\/[^/]+$/,             "Case Detail"],
  [/\/fraud\/queue$/,                    "Case Queue"],
  [/\/fraud\/detection$/,                "Fraud Detection"],
  [/\/fraud\/rules$/,                    "Fraud Rules"],
  [/\/fraud\/models$/,                   "Fraud Models"],
  [/\/fraud\/signals$/,                  "Fraud Signals"],
  [/\/fraud\/tiers$/,                    "Risk Tiers"],
  [/\/fraud\/operations$/,               "Operations"],
  [/\/fraud\/workflow$/,                 "Review Workflow"],
  [/\/fraud\/settings$/,                 "Fraud Settings"],
  [/\/fraud\/data$/,                     "Fraud Data"],
  [/^\/decisions$/,                      "Decisions"],
];

function TitleManager() {
  const location = useLocation();
  useEffect(() => {
    const match = ROUTE_TITLES.find(([re]) => re.test(location.pathname));
    document.title = match ? `${match[1]} · Sentinel` : "Sentinel";
  }, [location.pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
          <TitleManager />
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />

              {/* Systems Global List */}
              <Route path="/systems" element={<DecisionSystems />} />

              {/* Scoped System Routes */}
              <Route path="/systems/:systemId" element={<SystemLayout />}>
                {/* Always accessible */}
                <Route path="overview" element={<SystemOverview />} />
                <Route path="deployments" element={<Deployments />} />

                {/* Credit Scoring Module Routes */}
                <Route path="data" element={
                  <ModuleGuard module="credit_scoring">
                    <Datasets />
                  </ModuleGuard>
                } />
                <Route path="training" element={
                  <ModuleGuard module="credit_scoring">
                    <TrainingJobs />
                  </ModuleGuard>
                } />
                <Route path="models" element={
                  <ModuleGuard module="credit_scoring">
                    <Models />
                  </ModuleGuard>
                } />
                <Route path="models/:id" element={
                  <ModuleGuard module="credit_scoring">
                    <ModelDetail />
                  </ModuleGuard>
                } />

                {/* Policy Engine Routes */}
                <Route path="policy" element={
                  <ModuleGuard module="policy_engine">
                    <Policy />
                  </ModuleGuard>
                } />

                {/* Exposure Control Routes */}
                <Route path="exposure" element={
                  <ModuleGuard module="exposure_control">
                    <ExposureControl />
                  </ModuleGuard>
                } />

                {/* TASK-7: Projected Simulation Summary */}
                <Route path="simulation-summary" element={<SimulationSummary />} />

                {/* TASK-8: Engine Backtest */}
                <Route path="backtest" element={<EngineBacktest />} />

                {/* Monitoring */}
                <Route path="monitoring" element={<Monitoring />} />

                {/* Fraud Detection Module Routes */}
                <Route path="fraud/overview" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudOverview />
                  </ModuleGuard>
                } />
                {/* Legacy redirect: fraud/detection → fraud/overview */}
                <Route path="fraud/detection" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudOverview />
                  </ModuleGuard>
                } />
                <Route path="fraud/data" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudData />
                  </ModuleGuard>
                } />
                <Route path="fraud/training" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudTraining />
                  </ModuleGuard>
                } />
                <Route path="fraud/models" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudModels />
                  </ModuleGuard>
                } />
                <Route path="fraud/tiers" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudTiers />
                  </ModuleGuard>
                } />
              </Route>

              {/* Global Decisions */}
              <Route path="/decisions" element={<Decisions />} />

              {/* Monitoring Alias */}
              <Route path="/monitoring" element={<Dashboard />} />

              {/* Legacy/Redirects or miscellaneous */}
              <Route path="/deployments" element={<Deployments />} />
            </Route>
          </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
