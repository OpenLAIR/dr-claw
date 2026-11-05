import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { getDesktopSessionSecret } from '../hooks/useDesktop';

const AuthContext = createContext({
  user: null,
  token: null,
  login: () => {},
  register: () => {},
  logout: () => {},
  isLoading: true,
  needsSetup: false,
  hasCompletedOnboarding: true,
  refreshOnboardingStatus: () => {},
  isDesktopSession: false,
  error: null
});

// Desktop app only: trade the per-launch secret from the Electron preload for a
// regular JWT. Resolves to { token, user } or null (web/npx mode, an older
// desktop shell, or a server that does not accept it), in which case the
// normal login flow runs.
const signInWithDesktopSession = async () => {
  const secret = await getDesktopSessionSecret();
  if (!secret) {
    return null;
  }
  try {
    const response = await api.auth.desktopSession(secret);
    if (!response.ok) {
      console.warn('[AuthContext] Desktop sign-in was rejected:', response.status);
      return null;
    }
    const data = await response.json();
    return data?.token && data?.user ? { token: data.token, user: data.user } : null;
  } catch (error) {
    console.warn('[AuthContext] Desktop sign-in failed:', error);
    return null;
  }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('auth-token'));
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState(null);
  const [isDesktopSession, setIsDesktopSession] = useState(false);
  // One exchange per page load, shared by every checkAuthStatus run (StrictMode
  // runs the effect twice), so concurrent runs cannot race each other.
  const desktopSignInRef = useRef(null);

  useEffect(() => {
    checkAuthStatus();
  }, [token]);

  useEffect(() => {
    if (!user) {
      setHasCompletedOnboarding(true);
    }
  }, [user]);

  const checkOnboardingStatus = async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (response.ok) {
        const data = await response.json();
        setHasCompletedOnboarding(data.hasCompletedOnboarding);
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      setHasCompletedOnboarding(true);
    }
  };

  const refreshOnboardingStatus = async () => {
    await checkOnboardingStatus();
  };

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!desktopSignInRef.current) {
        desktopSignInRef.current = signInWithDesktopSession();
      }
      const desktopSession = await desktopSignInRef.current;
      if (desktopSession) {
        localStorage.setItem('auth-token', desktopSession.token);
        setToken(desktopSession.token);
        setUser(desktopSession.user);
        setNeedsSetup(false);
        setIsDesktopSession(true);
        await checkOnboardingStatus();
        return;
      }

      // Check if system needs setup
      const statusResponse = await api.auth.status();
      const statusData = await statusResponse.json();

      if (statusData.needsSetup) {
        setNeedsSetup(true);
        setUser(null);
        setIsLoading(false);
        return;
      }

      setNeedsSetup(false);

      // If we have a token, verify it
      if (token) {
        try {
          const userResponse = await api.auth.user();

          if (userResponse.ok) {
            const userData = await userResponse.json();
            setUser(userData.user);
            setNeedsSetup(false);
            await checkOnboardingStatus();
          } else {
            // Token is invalid
            localStorage.removeItem('auth-token');
            setToken(null);
            setUser(null);
          }
        } catch (error) {
          console.error('Token verification failed:', error);
          localStorage.removeItem('auth-token');
          setToken(null);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[AuthContext] Auth status check failed:', error);
      setError('Failed to check authentication status');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      setError(null);
      const response = await api.auth.login(username, password);

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        setNeedsSetup(false);
        localStorage.setItem('auth-token', data.token);
        await checkOnboardingStatus();
        return { success: true };
      } else {
        setError(data.error || 'Login failed');
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const register = async (username, password, notificationEmail) => {
    try {
      setError(null);
      const response = await api.auth.register(username, password, notificationEmail);

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        setNeedsSetup(false);
        localStorage.setItem('auth-token', data.token);
        await checkOnboardingStatus();
        return { success: true };
      } else {
        setError(data.error || 'Registration failed');
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = () => {
    // The desktop app has no account to leave; it would sign straight back in.
    if (isDesktopSession) {
      return;
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth-token');

    // Optional: Call logout endpoint for logging
    if (token) {
      api.auth.logout().catch(error => {
        console.error('Logout endpoint error:', error);
      });
    }
  };

  const value = {
    user,
    token,
    login,
    register,
    logout,
    isLoading,
    needsSetup,
    hasCompletedOnboarding,
    refreshOnboardingStatus,
    isDesktopSession,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
