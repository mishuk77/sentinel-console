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
import Login from "@/pages/Login";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { Navigate } from "react-router-dom";

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
                <Route path="overview" element={<SystemOverview />} />
                <Route path="data" element={<Datasets />} />
                <Route path="training" element={<TrainingJobs />} />
                <Route path="models" element={<Models />} />
                <Route path="models/:id" element={<ModelDetail />} />
                <Route path="policy" element={<Policy />} />
                <Route path="exposure" element={<ExposureControl />} />
                <Route path="fraud" element={<FraudDashboard />} />
                <Route path="fraud/queue" element={<FraudQueue />} />
                <Route path="fraud/cases/:caseId" element={<FraudCaseDetail />} />
                <Route path="fraud/rules" element={<FraudRules />} />
                <Route path="fraud/models" element={<FraudModels />} />
                <Route path="fraud/signals" element={<FraudSignals />} />
                <Route path="fraud/settings" element={<FraudSettings />} />
                <Route path="deployments" element={<Deployments />} />
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
