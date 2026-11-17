import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './api';
import { Toaster } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Rescue from './pages/Rescue';
import Requirements from './pages/Requirements';
import RequirementDetail from './pages/RequirementDetail';
import Candidates from './pages/Candidates';
import CandidateDetail from './pages/CandidateDetail';
import Onboarding from './pages/Onboarding';
import OnboardingDetail from './pages/OnboardingDetail';
import AIAgents from './pages/AIAgents';
import Reports from './pages/Reports';
import Payments from './pages/Payments';
import Settings from './pages/Settings';
import ProcessGuide from './pages/ProcessGuide';
import MIS from './pages/MIS';
import PlanActual from './pages/PlanActual';
import Outbox from './pages/Outbox';
import Apply from './public/Apply';
import Careers from './public/Careers';
import Feedback from './public/Feedback';

function Private({ children }) {
  return auth.token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/apply/:token" element={<Apply />} />
        <Route path="/careers" element={<Careers />} />
        <Route path="/feedback/:token" element={<Feedback />} />
        <Route element={<Private><Layout /></Private>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/rescue" element={<Rescue />} />
          <Route path="/requirements" element={<Requirements />} />
          <Route path="/requirements/:id" element={<RequirementDetail />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/candidates/:id" element={<CandidateDetail />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/onboarding/:id" element={<OnboardingDetail />} />
          <Route path="/ai" element={<AIAgents />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<ProcessGuide />} />
          <Route path="/mis" element={<MIS />} />
          <Route path="/plan-actual" element={<PlanActual />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
