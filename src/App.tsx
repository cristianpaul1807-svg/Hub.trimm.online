import React, { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { HubAuthProvider, useHubAuth } from './contexts/HubAuthContext';
import { HubLanguageProvider } from './contexts/HubLanguageContext';
import HubLayout from './components/HubLayout';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Workers = lazy(() => import('./pages/Workers'));
const Comparator = lazy(() => import('./pages/Comparator'));
const Settings = lazy(() => import('./pages/Settings'));
const Marketing = lazy(() => import('./pages/marketing/Marketing'));
const Campaigns = lazy(() => import('./pages/marketing/Campaigns'));
const Billing = lazy(() => import('./pages/marketing/Billing'));

function HubLoader() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-hubBg">
      <div className="flex flex-col items-center gap-4">
        <img src="/hub-logo.png" alt="TRIMM Business Hub Logo" className="h-12 w-auto" />
        <div className="w-5 h-5 border-2 border-hubBlue border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useHubAuth();
  if (loading) return <HubLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Wrapper to pass selectedBusinessId down into protected pages
function ProtectedDashboard() {
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);

  return (
    <ProtectedRoute>
      <HubLayout selectedBusinessId={selectedBusinessId} onBusinessSelect={setSelectedBusinessId}>
          <Suspense fallback={<div className="flex items-center justify-center py-20"><img src="/hub-logo.png" alt="TRIMM Business Hub Logo" className="h-12 w-auto" /><div className="w-5 h-5 border-2 border-hubBlue border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Dashboard selectedBusinessId={selectedBusinessId} />} />
            <Route path="/kpis" element={<Dashboard selectedBusinessId={selectedBusinessId} />} />
            <Route path="/workers" element={<Workers selectedBusinessId={selectedBusinessId} />} />
            <Route path="/comparator" element={<Comparator />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/marketing" element={<Marketing />} />
            <Route path="/marketing/campaigns" element={<Campaigns />} />
            <Route path="/marketing/billing" element={<Billing />} />
          </Routes>
        </Suspense>
      </HubLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <HubLanguageProvider>
      <HubAuthProvider>
        <BrowserRouter>
          <Suspense fallback={<HubLoader />}>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />

              {/* Protected Dashboard */}
              <Route path="/dashboard/*" element={<ProtectedDashboard />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </HubAuthProvider>
    </HubLanguageProvider>
  );
}
