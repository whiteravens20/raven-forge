import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { LogOut, UserPlus, Shield, ShieldAlert, ExternalLink } from 'lucide-react';
import { useAuthStore } from '@stores/auth-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { useT } from '@renderer/i18n';

const api = window.ravenforge;

/**
 * Where a Microsoft account is actually managed — skin, cape and username.
 *
 * Deliberately without the locale segment minecraft.net uses in its paths: left
 * off, the site redirects to the visitor's own locale, which is more use to
 * somebody not reading English than a hardcoded `/en-us/` would be.
 */
const MC_ACCOUNT_URL = 'https://www.minecraft.net/msaprofile/mygames/editprofile';

/**
 * A player's head, cropped out of their skin.
 *
 * What Mojang gives us is the whole 64×64 skin sheet — the unwrapped texture for
 * the entire body. Drawing that into a 40px box, as this page used to, squashes
 * the whole atlas into a square: arms, legs and torso included, no face to speak
 * of. The head's front is the 8×8 region at (8,8), and the hat layer that sits
 * over it is the 8×8 at (40,8), so both are scaled up and stacked here.
 *
 * The arithmetic falls out of the head being exactly an eighth of the sheet: the
 * sheet scales to `size * 8`, which makes every source pixel `size / 8` wide and
 * every 8px step in the source exactly one `size`. Nearest-neighbour keeps it a
 * Minecraft head rather than a smear.
 *
 * Cropping here, rather than asking Crafatar or mc-heads for a ready-made
 * avatar, keeps the player's UUID from being handed to a third party for a
 * picture we already have the pixels for.
 */
function SkinHead({ url, size = 40 }: { url: string; size?: number }) {
  const layer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${size * 8}px ${size * 8}px`,
    imageRendering: 'pixelated',
  };

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded bg-rf-bg-tertiary"
      style={{ width: size, height: size }}
    >
      <div style={{ ...layer, backgroundPosition: `-${size}px -${size}px` }} />
      <div style={{ ...layer, backgroundPosition: `-${size * 5}px -${size}px` }} />
    </div>
  );
}

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
        className="-mt-3 self-start text-xs text-rf-text-muted underline decoration-current/30 underline-offset-2 transition-colors hover:text-rf-accent-text"
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
                <SkinHead url={account.skinUrl} />
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
                    <span className="ml-1 text-rf-accent-text">{t('accounts.active')}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {account.id !== activeAccountId && (
                  <Button variant="ghost" size="sm" onClick={() => setActive(account.id)}>
                    {t('accounts.setActive')}
                  </Button>
                )}
                {/* Skin, cape and username all live on minecraft.net, and the
                    launcher is the wrong place to reimplement any of them. An
                    offline account has nothing on the other end of this link. */}
                {account.type === 'microsoft' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ExternalLink size={12} />}
                    onClick={() => void api.system.openUrl(MC_ACCOUNT_URL)}
                  >
                    {t('accounts.manage')}
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
