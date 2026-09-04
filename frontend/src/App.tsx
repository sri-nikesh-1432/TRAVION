import React, { useState, useEffect } from 'react';
import { AuthSession } from './types';
import { authStorage } from './services/api';
import { LandingPage } from './views/LandingPage';
import { UserDomain } from './views/UserDomain';
import { GuideDomain } from './views/GuideDomain';
import { ManagerDomain } from './views/ManagerDomain';
import { AdminDomain } from './views/AdminDomain';

export const App: React.FC = () => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSandboxDemo, setIsSandboxDemo] = useState(false);

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
    }
  }, []);

  // The LandingPage / Elevate modal already persisted the session with the
  // user's "Remember me" choice — here we simply adopt it in memory.
  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    setIsSandboxDemo(false);
  };

  const handleLogout = () => {
    authStorage.clear();
    setSession(null);
    setIsSandboxDemo(false);
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
      />
    );
  }

  // 2. Role-Based Navigation Routing
  switch (session.role) {
    case 'USER':
      return (
        <UserDomain
          session={session}
          onLogout={handleLogout}
          isSandboxDemo={isSandboxDemo}
        />
      );

    case 'GUIDE':
      return (
        <GuideDomain
          session={session}
          onLogout={handleLogout}
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
        />
      );
  }
};

export default App;
