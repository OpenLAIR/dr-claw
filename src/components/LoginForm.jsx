import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, RefreshCcw, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const LoginForm = () => {
  const { t } = useTranslation('auth');
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { login, register } = useAuth();

  const isRegisterMode = mode === 'register';

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setUsername('');
    setNotificationEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError(t('login.errors.requiredFields'));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setError(t('register.errors.passwordMismatch'));
        return;
      }

      if (username.trim().length < 3) {
        setError(t('register.errors.usernameLength'));
        return;
      }

      if (password.length < 6) {
        setError(t('register.errors.passwordLength'));
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(notificationEmail.trim())) {
        setError(t('register.errors.invalidEmail'));
        return;
      }
    }

    setIsLoading(true);

    const result = isRegisterMode
      ? await register(username.trim(), password, notificationEmail.trim())
      : await login(username.trim(), password);

    if (!result.success) {
      setError(result.error);
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <MessageSquare className="w-8 h-8 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {isRegisterMode ? t('register.title') : t('login.title')}
            </h1>
            <p className="text-muted-foreground mt-2">
              {isRegisterMode ? t('register.description') : t('login.description')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1">
                {isRegisterMode ? t('register.username') : t('login.username')}
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={isRegisterMode ? t('register.placeholders.username') : t('login.placeholders.username')}
                required
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="notificationEmail" className="block text-sm font-medium text-foreground mb-1">
                  {t('register.email')}
                </label>
                <input
                  type="email"
                  id="notificationEmail"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('register.placeholders.email')}
                  required
                  disabled={isLoading}
                />
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                {isRegisterMode ? t('register.password') : t('login.password')}
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={isRegisterMode ? t('register.placeholders.password') : t('login.placeholders.password')}
                required
                disabled={isLoading}
              />
            </div>

            {isRegisterMode && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                  {t('register.confirmPassword')}
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('register.placeholders.confirmPassword')}
                  required
                  disabled={isLoading}
                />
              </div>
            )}

            {isRegisterMode && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-md">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {t('register.description')}
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200"
            >
              {isLoading
                ? (isRegisterMode ? t('register.loading') : t('login.loading'))
                : (isRegisterMode ? t('register.submit') : t('login.submit'))}
            </button>
          </form>

          <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md bg-background p-2 border border-border/60">
                {isRegisterMode ? (
                  <RefreshCcw className="w-4 h-4 text-foreground" />
                ) : (
                  <UserPlus className="w-4 h-4 text-foreground" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {isRegisterMode ? t('login.backToLoginTitle') : t('login.registerCard.title')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isRegisterMode ? t('login.backToLoginDescription') : t('login.registerCard.description')}
                </p>
                <button
                  type="button"
                  onClick={() => switchMode(isRegisterMode ? 'login' : 'register')}
                  disabled={isLoading}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                >
                  {isRegisterMode ? (
                    <>
                      <RefreshCcw className="w-4 h-4" />
                      {t('login.backToLoginButton')}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      {t('login.registerCard.button')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
