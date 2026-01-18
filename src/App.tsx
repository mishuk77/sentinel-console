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
import Decisions from "@/pages/Decisions";
import DecisionSystems from "@/pages/DecisionSystems";
import SystemLayout from "@/pages/SystemLayout";
import SystemOverview from "@/pages/SystemOverview";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
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
    </QueryClientProvider>
  );
}

export default App;
