import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceRegionProvider } from "@/contexts/WorkspaceRegionContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { DevPerformanceDashboard } from "@/components/DevPerformanceDashboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UserPreferencesSync } from "@/components/UserPreferencesSync";
import { queryClient } from "@/lib/performance/query-client";

const About = lazy(() => import("./pages/About"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const Auth = lazy(() => import("./pages/Auth"));
const Contact = lazy(() => import("./pages/Contact"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Index = lazy(() => import("./pages/Index"));
const Landing = lazy(() => import("./pages/Landing"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PaymentVerification = lazy(
  () => import("./pages/PaymentVerification"),
);
const PublicEvent = lazy(() => import("./pages/PublicEvent"));
const PublicForm = lazy(() => import("./pages/PublicForm"));
const PublicTicketValidator = lazy(
  () => import("./pages/PublicTicketValidator"),
);
const PublicTicket = lazy(() => import("./pages/PublicTicket"));
const PublicDocumentSigning = lazy(
  () => import("./pages/PublicDocumentSigning"),
);
const Settings = lazy(() => import("./pages/Settings"));

function RouteFallback() {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const isPublicPage =
    /^\/(?:forms|f|event)\//.test(path) ||
    /^\/[A-Za-z0-9_-]+\/(?:checkin|ticketvalidator)\/?$/.test(path) ||
    /^\/ticket\/mft1\./.test(path) ||
    /^\/payments\/verify\//.test(path);
  if (isPublicPage) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-white px-6 text-slate-900"
        role="status"
        aria-label="Loading page"
      >
        <div className="flex items-center gap-3 text-sm">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-orange-500" />
          <span>Loading MaxForm…</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-6"
      role="status"
      aria-label="Loading page"
    >
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <DevPerformanceDashboard />
        <ErrorBoundary title="MaxForm">
          <BrowserRouter>
            <AuthProvider>
              <WorkspaceRegionProvider>
                <UserPreferencesSync />
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/" element={<Index />} />
                    <Route path="/pricing" element={<Landing />} />
                    <Route path="/about" element={<About />} />
                    <Route path="/contact" element={<Contact />} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/forms/:workspaceId/:formSlug" element={<PublicForm />} />
                    <Route path="/f/:formId" element={<PublicForm />} />
                    <Route path="/event/:workspaceId/:eventSlug" element={<PublicEvent />} />
                    <Route path="/:maskedId/ticketvalidator" element={<PublicTicketValidator />} />
                    <Route path="/:maskedId/checkin" element={<PublicTicketValidator />} />
                    <Route path="/ticket/:downloadToken" element={<PublicTicket />} />
                    <Route path="/sign/:signingToken" element={<PublicDocumentSigning />} />
                    <Route path="/payments/verify/:attemptKey" element={<PaymentVerification />} />
                    <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
                    <Route path="/analytics" element={<Navigate to="/dashboard?tab=analytics" replace />} />
                    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </WorkspaceRegionProvider>
            </AuthProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
