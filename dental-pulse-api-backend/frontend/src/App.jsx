import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { lazy, Suspense } from 'react';

// Lazy load pages — each page becomes its own JS chunk, loaded only when visited
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const GroupDashboard = lazy(() => import('./pages/GroupDashboard'));
const Users = lazy(() => import('./pages/Users'));
const Organizations = lazy(() => import('./pages/Organizations'));
const OrganizationDetail = lazy(() => import('./pages/OrganizationDetail'));
const Appointments = lazy(() => import('./pages/Appointments'));
const Settings = lazy(() => import('./pages/Settings'));
const AIPrompts = lazy(() => import('./pages/AIPrompts'));
const AIPromptEdit = lazy(() => import('./pages/AIPromptEdit'));
const ChatbotSettings = lazy(() => import('./pages/ChatbotSettings'));
const AIUsage = lazy(() => import('./pages/AIUsage'));
const AIUsageDetail = lazy(() => import('./pages/AIUsageDetail'));
const ModuleAccess = lazy(() => import('./pages/ModuleAccess'));

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" richColors />
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="group-dashboard" element={<GroupDashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="organizations" element={<Organizations />} />
              <Route path="organizations/:id" element={<OrganizationDetail />} />
              <Route path="appointments" element={<Appointments />} />
              <Route path="settings" element={<Settings />} />
              <Route path="ai-prompts" element={<AIPrompts />} />
              <Route path="ai-prompts/:id" element={<AIPromptEdit />} />
              <Route path="chatbot-settings" element={<ChatbotSettings />} />
              <Route path="ai-usage" element={<AIUsage />} />
              <Route path="ai-usage/:userId" element={<AIUsageDetail />} />
              <Route path="module-access" element={<ModuleAccess />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
