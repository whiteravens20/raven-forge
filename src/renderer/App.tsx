import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { HomePage } from './pages/HomePage';
import { ProfilesPage } from './pages/ProfilesPage';
import { ModsPage } from './pages/ModsPage';
import { ContentPage } from '@renderer/pages/ContentPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { useAuthStore } from './stores/auth-store';
import { useProfileStore } from './stores/profile-store';
import { useSettingsStore } from './stores/settings-store';
import { useNewsStore } from './stores/news-store';
import { InstallProgressOverlay } from './components/InstallProgressOverlay';
import { UpdateToast } from './components/UpdateToast';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  useEffect(() => {
    void useAuthStore.getState().load();
    void useProfileStore.getState().load();
    void useSettingsStore.getState().load();
    void useNewsStore.getState().load();
  }, []);

  return (
    <ErrorBoundary>
      <HashRouter>
        <div className="flex h-screen flex-col overflow-hidden bg-rf-bg text-rf-text font-sans">
          <TitleBar />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/profiles" element={<ProfilesPage />} />
                <Route path="/mods" element={<ModsPage />} />
                <Route path="/content" element={<ContentPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/about" element={<AboutPage />} />
                {/* No sidebar tile — reached from About and from Accounts, which
                    is where someone is deciding to hand over a Microsoft login. */}
                <Route path="/privacy" element={<PrivacyPage />} />
              </Routes>
            </main>
          </div>
          <InstallProgressOverlay />
          <UpdateToast />
        </div>
      </HashRouter>
    </ErrorBoundary>
  );
}
