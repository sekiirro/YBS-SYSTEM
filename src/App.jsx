import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import Layout from '@/components/Layout';
import PortalLayout from '@/components/PortalLayout';

import HomeRedirect from '@/pages/HomeRedirect';
import Login from '@/pages/Login';
import ClientSignup from '@/pages/ClientSignup';
import Activate from '@/pages/Activate';
import PendingApproval from '@/pages/PendingApproval';
import Forbidden from '@/pages/Forbidden';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

import Dashboard from '@/pages/Dashboard';
import Clients from '@/pages/Clients';
import ClientDetail from '@/pages/ClientDetail';
import Packages from '@/pages/Packages';
import Subscriptions from '@/pages/Subscriptions';
import Exercises from '@/pages/Exercises';
import Foods from '@/pages/Foods';
import Assessments from '@/pages/Assessments';
import Metrics from '@/pages/Metrics';
import NutritionPlans from '@/pages/NutritionPlans';
import WorkoutPlans from '@/pages/WorkoutPlans';
import Team from '@/pages/Team';
import Notifications from '@/pages/Notifications';
import AuditLogs from '@/pages/AuditLogs';
import Settings from '@/pages/Settings';
import Workspaces from '@/pages/Workspaces';
import PendingApplications from '@/pages/PendingApplications';
import PortalDashboard from '@/pages/PortalDashboard';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<ClientSignup />} />
      <Route path="/activate" element={<Activate />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Authenticated */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route path="/pending" element={<PendingApproval />} />
        <Route path="/forbidden" element={<Forbidden />} />
        <Route path="/" element={<HomeRedirect />} />

        <Route element={<Layout />}>
          {/* Platform admin only */}
          <Route element={<RoleGuard allow={['admin']} />}>
            <Route path="/admin/workspaces" element={<Workspaces />} />
            <Route path="/admin/applications" element={<PendingApplications />} />
            <Route path="/audit" element={<AuditLogs />} />
            <Route path="/team" element={<Team />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/packages" element={<Packages />} />
          </Route>

          {/* Admin + workspace + coach */}
          <Route element={<RoleGuard allow={['admin', 'workspace', 'coach']} />}>
            <Route path="/admin/dashboard" element={<Dashboard />} />
            <Route path="/workspace/:workspaceId/dashboard" element={<Dashboard />} />
            <Route path="/coach/dashboard" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/metrics" element={<Metrics />} />
            <Route path="/nutrition" element={<NutritionPlans />} />
            <Route path="/foods" element={<Foods />} />
            <Route path="/workouts" element={<WorkoutPlans />} />
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/notifications" element={<Notifications />} />
          </Route>
        </Route>

        {/* Client portal */}
        <Route element={<PortalLayout />}>
          <Route element={<RoleGuard allow={['client', 'admin']} />}>
            <Route path="/portal/dashboard" element={<PortalDashboard />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App