import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { HubAuthProvider, useHubAuth } from './contexts/HubAuthContext';
import { HubLanguageProvider } from './contexts/HubLanguageContext';
import HubLayout from './components/HubLayout';
import { trackPageView } from './lib/analytics';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Kpis = lazy(() => import('./pages/Kpis'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Workers = lazy(() => import('./pages/Workers'));
const Comparator = lazy(() => import('./pages/Comparator'));
const Settings = lazy(() => import('./pages/Settings'));
const Marketing = lazy(() => import('./pages/marketing/Marketing'));
const Campaigns = lazy(() => import('./pages/marketing/Campaigns'));
const CampaignDetail = lazy(() => import('./pages/marketing/CampaignDetail'));
const Credits = lazy(() => import('./pages/marketing/Credits'));
const Billing = lazy(() => import('./pages/marketing/Billing'));
const Unsubscribe = lazy(() => import('./pages/Unsubscribe'));

/**
 * Registra una vista de página en cada cambio de ruta.
 *
 * Sin esto, Google Analytics solo vería la primera carga: en una aplicación
 * de una sola página, navegar de Campañas a Saldo no recarga nada y gtag no
 * se entera. Va dentro del router para poder leer la ubicación actual.
 */
function RouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);

  return null;
}

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
            <Route path="/kpis" element={<Kpis selectedBusinessId={selectedBusinessId} />} />
            <Route path="/analytics" element={<Analytics selectedBusinessId={selectedBusinessId} />} />
            <Route path="/workers" element={<Workers selectedBusinessId={selectedBusinessId} />} />
            <Route path="/comparator" element={<Comparator />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/marketing" element={<Marketing />} />
            <Route path="/marketing/campaigns" element={<Campaigns />} />
            <Route path="/marketing/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/marketing/credits" element={<Credits />} />
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
          <RouteAnalytics />
          <Suspense fallback={<HubLoader />}>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              {/* Baja de campañas: se abre desde el pie de los correos, sin sesión */}
              <Route path="/baja" element={<Unsubscribe />} />

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
