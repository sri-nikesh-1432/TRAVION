import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Compass } from 'lucide-react';
import { AuthSession } from './types';
import { api, authStorage } from './services/api';
import { LandingPage } from './views/LandingPage';

// Heavy role views load on demand — keeps the first paint and the landing page
// authoritative bundle lean instead of shipping every portal at once.
const UserDomain = lazy(() => import('./views/UserDomain').then((m) => ({ default: m.UserDomain })));
const GuideDomain = lazy(() => import('./views/GuideDomain').then((m) => ({ default: m.GuideDomain })));
const GuideVerification = lazy(() => import('./views/GuideVerification').then((m) => ({ default: m.GuideVerification })));
const GuideRegistration = lazy(() => import('./views/GuideRegistration').then((m) => ({ default: m.GuideRegistration })));
const GuideSignIn = lazy(() => import('./views/GuideSignIn').then((m) => ({ default: m.GuideSignIn })));
const ManagerDomain = lazy(() => import('./views/ManagerDomain').then((m) => ({ default: m.ManagerDomain })));
const AdminDomain = lazy(() => import('./views/AdminDomain').then((m) => ({ default: m.AdminDomain })));

const SuspenseShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense
    fallback={
      <div className="min-h-screen bg-[#faf7f0] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center animate-pulse">
            <Compass className="w-5 h-5 text-white" />
          </span>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Loading Travion…</p>
        </div>
      </div>
    }
  >
    {children}
  </Suspense>
);

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSandboxDemo, setIsSandboxDemo] = useState(false);
  const [guideView, setGuideView] = useState<'verification' | 'dashboard' | 'register' | 'signin' | 'update_profile' | null>(null);
  const [showGuideRegister, setShowGuideRegister] = useState(false);
  const [showGuideSignIn, setShowGuideSignIn] = useState(false);

  useEffect(() => {
    const stored = authStorage.load();
    const token = stored.token;
    const role = stored.role as AuthSession['role'] | null;
    const email = stored.email || 'user@travion.in';
    const identityId = stored.identityId || 'id-default';

    if (token && role) {
      // Session persistence across refresh: restore optimistically, then
      // VALIDATE the token against the backend (/auth/me). An expired or
      // forged token must never grant access — the identity + role always
      // come back from the server, not from localStorage.
      setSession({
        access_token: token,
        token_type: 'bearer',
        role,
        email,
        identity_id: identityId,
        is_profile_complete: true
      });
      api.getMe()
        .then((me) => {
          setSession((prev) =>
            prev && prev.access_token === token && prev.access_token !== 'sandbox-preview-token'
              ? {
                  ...prev,
                  role: (me.role as AuthSession['role']) || prev.role,
                  email: me.email || prev.email,
                  identity_id: me.identity_id || prev.identity_id
                }
              : prev
          );
        })
        .catch(() => {
          // Invalid / expired token (or the account no longer exists): drop it.
          authStorage.clear();
          setSession(null);
          setGuideView(null);
        });
    }
  }, []);

  // The LandingPage / Elevate modal already persisted the session with the
  // user's "Remember me" choice — here we simply adopt it in memory.
  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    setIsSandboxDemo(false);
    // If it's a guide, show verification page
    if (newSession.role === 'GUIDE') {
      setGuideView('verification');
    }
  };

  const handleLogout = () => {
    authStorage.clear();
    setSession(null);
    setIsSandboxDemo(false);
    setGuideView(null);
  };

  const handleGuideRegistrationComplete = (newSession: AuthSession) => {
    setSession(newSession);
    setIsSandboxDemo(false);
    setGuideView('verification');
    setShowGuideRegister(false);
  };

  const handleGuideSignInComplete = (newSession: AuthSession) => {
    setSession(newSession);
    setIsSandboxDemo(false);
    setGuideView('verification');
    setShowGuideSignIn(false);
  };

  const handleGuideVerificationApproved = () => {
    setGuideView('dashboard');
  };

  const handleGuideVerificationRejected = () => {
    setGuideView('update_profile');
  };

  const handleLaunchSandboxDemo = () => {
    setIsSandboxDemo(true);
    setSession({
      access_token: 'sandbox-preview-token',
      token_type: 'bearer',
      role: 'USER',
      email: 'demo.traveller@travion.preview',
      identity_id: 'sandbox-demo-id',
      is_profile_complete: true
    });
  };

  // 1. If not authenticated and not in sandbox, show Landing Page
  if (!session) {
    return (
      <LandingPage
        onLoginSuccess={handleLoginSuccess}
        onExploreDemo={handleLaunchSandboxDemo}
        onOpenGuideRegistration={() => setShowGuideRegister(true)}
        onOpenGuideSignIn={() => setShowGuideSignIn(true)}
      />
    );
  }

  // 2. Guide-specific standalone views (register/signin without session)
  if (showGuideRegister || showGuideSignIn) {
    return (
      <SuspenseShell>
        <div className="min-h-screen bg-white">
          {showGuideRegister ? (
            <GuideRegistration
              onRegisterSuccess={handleGuideRegistrationComplete}
              onSwitchToSignIn={() => { setShowGuideRegister(false); setShowGuideSignIn(true); }}
            />
          ) : (
            <GuideSignIn
              onSignInSuccess={handleGuideSignInComplete}
              onSwitchToRegistration={() => { setShowGuideSignIn(false); setShowGuideRegister(true); }}
            />
          )}
        </div>
      </SuspenseShell>
    );
  }

  // 3. If guide is logged in, check verification status
  if (session.role === 'GUIDE') {
    if (guideView === 'verification' || guideView === 'update_profile') {
      return (
        <SuspenseShell>
          <GuideVerification
            onDashboardAccess={() => setGuideView('dashboard')}
            onResubmitProfile={() => setGuideView('update_profile')}
          />
        </SuspenseShell>
      );
    }
    // After verification approved, show guide dashboard
    return (
      <SuspenseShell>
        <GuideDomain
          session={session}
          onLogout={handleLogout}
        />
      </SuspenseShell>
    );
  }

  // 4. Role-Based Navigation Routing for other roles
  switch (session.role) {
    case 'USER':
      return (
        <SuspenseShell>
          <UserDomain
            session={session}
            onLogout={handleLogout}
            isSandboxDemo={isSandboxDemo}
          />
        </SuspenseShell>
      );

    case 'MANAGER':
      return (
        <SuspenseShell>
          <ManagerDomain
            session={session}
            onLogout={handleLogout}
          />
        </SuspenseShell>
      );

    case 'ADMIN':
      return (
        <SuspenseShell>
          <AdminDomain
            session={session}
            onLogout={handleLogout}
          />
        </SuspenseShell>
      );

    default:
      return (
        <LandingPage
          onLoginSuccess={handleLoginSuccess}
          onExploreDemo={handleLaunchSandboxDemo}
          onOpenGuideRegistration={() => setShowGuideRegister(true)}
          onOpenGuideSignIn={() => setShowGuideSignIn(true)}
        />
      );
  }
};

export default App;
