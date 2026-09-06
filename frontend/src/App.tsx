import React, { useState, useEffect } from 'react';
import { AuthSession } from './types';
import { authStorage } from './services/api';
import { LandingPage } from './views/LandingPage';
import { UserDomain } from './views/UserDomain';
import { GuideDomain } from './views/GuideDomain';
import { GuideVerification } from './views/GuideVerification';
import { GuideRegistration } from './views/GuideRegistration';
import { GuideSignIn } from './views/GuideSignIn';
import { ManagerDomain } from './views/ManagerDomain';
import { AdminDomain } from './views/AdminDomain';

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
      setSession({
        access_token: token,
        token_type: 'bearer',
        role,
        email,
        identity_id: identityId,
        is_profile_complete: true
      });
      // If it's a guide, check verification status
      if (role === 'GUIDE') {
        // Will be handled in render - show verification first
      }
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
    );
  }

  // 3. If guide is logged in, check verification status
  if (session.role === 'GUIDE') {
    if (guideView === 'verification' || guideView === 'update_profile') {
      return (
        <GuideVerification
          onDashboardAccess={() => setGuideView('dashboard')}
          onResubmitProfile={() => setGuideView('update_profile')}
        />
      );
    }
    // After verification approved, show guide dashboard
    return (
      <GuideDomain
        session={session}
        onLogout={handleLogout}
      />
    );
  }

  // 4. Role-Based Navigation Routing for other roles
  switch (session.role) {
    case 'USER':
      return (
        <UserDomain
          session={session}
          onLogout={handleLogout}
          isSandboxDemo={isSandboxDemo}
        />
      );

    case 'MANAGER':
      return (
        <ManagerDomain
          session={session}
          onLogout={handleLogout}
        />
      );

    case 'ADMIN':
      return (
        <AdminDomain
          session={session}
          onLogout={handleLogout}
        />
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
