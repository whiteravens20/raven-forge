import { useState } from 'react';
import { Link } from 'react-router';
import { LogOut, UserPlus, Shield, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@stores/auth-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { useT } from '@renderer/i18n';

export function AccountsPage() {
  const accounts = useAuthStore((s) => s.accounts);
  const activeAccountId = useAuthStore((s) => s.activeAccountId);
  const isAuthenticating = useAuthStore((s) => s.isAuthenticating);
  const loginMicrosoft = useAuthStore((s) => s.loginMicrosoft);
  const loginOffline = useAuthStore((s) => s.loginOffline);
  const logout = useAuthStore((s) => s.logout);
  const setActive = useAuthStore((s) => s.setActive);
  const credentialsInPlaintext = useAuthStore((s) => s.credentialsInPlaintext);
  const credentialsFile = useAuthStore((s) => s.credentialsFile);

  const t = useT();
  const [offlineUsername, setOfflineUsername] = useState('');
  const [showOffline, setShowOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** `null` is success; an empty message means main failed without saying why. */
  const show = (failure: string | null) =>
    setError(failure === null ? null : failure || t('accounts.loginFailed'));

  const handleMicrosoftLogin = async () => {
    show(await loginMicrosoft());
  };

  const handleOfflineLogin = async () => {
    if (!offlineUsername.trim()) return;
    const failure = await loginOffline(offlineUsername.trim());
    show(failure);
    if (failure !== null) return;
    setShowOffline(false);
    setOfflineUsername('');
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6 overflow-y-auto">
      <h1 className="text-lg font-display font-semibold text-rf-text">{t('accounts.title')}</h1>

      {/* Login buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          icon={<Shield size={16} />}
          loading={isAuthenticating}
          onClick={handleMicrosoftLogin}
        >
          {t('accounts.loginMicrosoft')}
        </Button>
        <Button
          variant="secondary"
          icon={<UserPlus size={16} />}
          onClick={() => setShowOffline(!showOffline)}
        >
          {t('accounts.offlineMode')}
        </Button>
      </div>

      {/* Next to the button that hands over a Microsoft account, not buried in
          About — this is the moment the question actually occurs to someone. */}
      <Link
        to="/privacy"
        className="-mt-3 self-start text-xs text-rf-text-muted underline decoration-current/30 underline-offset-2 transition-colors hover:text-rf-accent"
      >
        {t('accounts.privacyLink')}
      </Link>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rf-danger/30 bg-rf-danger/10 px-3 py-2 text-sm text-rf-danger"
        >
          {error}
        </p>
      )}

      {credentialsInPlaintext && (
        <div className="rounded-lg border border-rf-warning/30 bg-rf-warning/10 px-3 py-2 text-sm text-rf-warning">
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlert size={16} /> {t('accounts.plaintextTitle')}
          </p>
          <p className="mt-1 text-rf-text-secondary">
            {t('accounts.plaintextBody', { file: credentialsFile ?? 'auth.json' })}
          </p>
        </div>
      )}

      {/* Offline login form */}
      {showOffline && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleOfflineLogin();
          }}
          className="flex items-end gap-2 max-w-sm"
        >
          <div className="flex-1">
            <Input
              label={t('accounts.playerName')}
              value={offlineUsername}
              onChange={(e) => setOfflineUsername(e.target.value)}
              placeholder="Steve"
              maxLength={16}
              pattern="[a-zA-Z0-9_]+"
              autoFocus
            />
          </div>
          <Button type="submit">{t('common.add')}</Button>
        </form>
      )}

      {/* Account list */}
      <div className="space-y-2">
        {accounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-rf-text-muted">{t('accounts.empty')}</p>
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                account.id === activeAccountId
                  ? 'border-rf-accent bg-rf-accent/5'
                  : 'border-rf-border bg-rf-surface'
              }`}
            >
              {account.skinUrl ? (
                <img src={account.skinUrl} alt="" className="h-10 w-10 rounded" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-rf-bg-tertiary text-rf-text-muted text-sm font-bold">
                  {account.username[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <p className="text-sm font-medium text-rf-text">{account.username}</p>
                <p className="text-xs text-rf-text-muted">
                  {account.type === 'microsoft' ? 'Microsoft' : 'Offline'}
                  {account.id === activeAccountId && (
                    <span className="ml-1 text-rf-accent">{t('accounts.active')}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {account.id !== activeAccountId && (
                  <Button variant="ghost" size="sm" onClick={() => setActive(account.id)}>
                    {t('accounts.setActive')}
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  icon={<LogOut size={12} />}
                  onClick={() => logout(account.id)}
                >
                  {t('accounts.logout')}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
