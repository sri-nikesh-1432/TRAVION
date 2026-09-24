import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Compass } from 'lucide-react';
import { AuthSession } from './types';
import { api, authStorage } from './services/api';
import { LandingPage } from './views/LandingPage';
import { TravionToastProvider } from './components/ui';

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
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-travion-500 to-travion-700 flex items-center justify-center animate-pulse">
            <Compass className="w-5 h-5 text-white" />
          </span>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-charcoal-400">Loading Travion…</p>
        </div>
      </div>
    }
  >
    {children}
  </Suspense>
);

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(null);
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
            prev && prev.access_token === token
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
    // If it's a guide, show verification page
    if (newSession.role === 'GUIDE') {
      setGuideView('verification');
    }
  };

  const handleLogout = () => {
    authStorage.clear();
    setSession(null);
    setGuideView(null);
  };

  const handleGuideRegistrationComplete = (newSession: AuthSession) => {
    setSession(newSession);
    setGuideView('verification');
    setShowGuideRegister(false);
  };

  const handleGuideSignInComplete = (newSession: AuthSession) => {
    setSession(newSession);
    setGuideView('verification');
    setShowGuideSignIn(false);
  };

  const handleGuideVerificationApproved = () => {
    setGuideView('dashboard');
  };

  const handleGuideVerificationRejected = () => {
    setGuideView('update_profile');
  };

  // Compute the root view, then wrap it in the toast provider.
  let view: React.ReactNode;

  if (showGuideRegister || showGuideSignIn) {
    view = (
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
  } else if (!session) {
    view = (
      <LandingPage
        onLoginSuccess={handleLoginSuccess}
        onOpenGuideRegistration={() => setShowGuideRegister(true)}
        onOpenGuideSignIn={() => setShowGuideSignIn(true)}
      />
    );
  } else if (session.role === 'GUIDE') {
    if (guideView === 'verification' || guideView === 'update_profile') {
      view = (
        <SuspenseShell>
          <GuideVerification
            onDashboardAccess={() => setGuideView('dashboard')}
            onResubmitProfile={() => setGuideView('update_profile')}
          />
        </SuspenseShell>
      );
    } else {
      view = (
        <SuspenseShell>
          <GuideDomain session={session} onLogout={handleLogout} />
        </SuspenseShell>
      );
    }
  } else {
    switch (session.role) {
      case 'USER':
        view = (
          <SuspenseShell>
            <UserDomain session={session} onLogout={handleLogout} />
          </SuspenseShell>
        );
        break;
      case 'MANAGER':
        view = (
          <SuspenseShell>
            <ManagerDomain session={session} onLogout={handleLogout} />
          </SuspenseShell>
        );
        break;
      case 'ADMIN':
        view = (
          <SuspenseShell>
            <AdminDomain session={session} onLogout={handleLogout} />
          </SuspenseShell>
        );
        break;
      default:
        view = (
          <LandingPage
            onLoginSuccess={handleLoginSuccess}
            onOpenGuideRegistration={() => setShowGuideRegister(true)}
            onOpenGuideSignIn={() => setShowGuideSignIn(true)}
          />
        );
    }
  }

  return <TravionToastProvider>{view}</TravionToastProvider>;
};

export default App;
