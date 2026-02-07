import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import FraudDashboard from "@/pages/FraudDashboard";
import FraudQueue from "@/pages/FraudQueue";
import FraudCaseDetail from "@/pages/FraudCaseDetail";
import FraudRules from "@/pages/FraudRules";
import FraudModels from "@/pages/FraudModels";
import FraudSignals from "@/pages/FraudSignals";
import FraudSettings from "@/pages/FraudSettings";
import Decisions from "@/pages/Decisions";
import DecisionSystems from "@/pages/DecisionSystems";
import SystemLayout from "@/pages/SystemLayout";
import SystemOverview from "@/pages/SystemOverview";
import SystemModules from "@/pages/SystemModules";
import Login from "@/pages/Login";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { Navigate } from "react-router-dom";
import ModuleGuard from "@/components/ModuleGuard";

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
                <Route path="modules" element={<SystemModules />} />
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

                {/* Fraud Detection Routes */}
                <Route path="fraud" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudDashboard />
                  </ModuleGuard>
                } />
                <Route path="fraud/queue" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudQueue />
                  </ModuleGuard>
                } />
                <Route path="fraud/cases/:caseId" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudCaseDetail />
                  </ModuleGuard>
                } />
                <Route path="fraud/rules" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudRules />
                  </ModuleGuard>
                } />
                <Route path="fraud/models" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudModels />
                  </ModuleGuard>
                } />
                <Route path="fraud/signals" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudSignals />
                  </ModuleGuard>
                } />
                <Route path="fraud/settings" element={
                  <ModuleGuard module="fraud_detection">
                    <FraudSettings />
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
