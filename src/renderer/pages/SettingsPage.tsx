import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { useSettingsStore } from '@stores/settings-store';
import { useNewsStore } from '@stores/news-store';
import { Select } from '@components/ui/Select';
import { Input } from '@components/ui/Input';
import { Button } from '@components/ui/Button';
import { LogViewer } from '@components/LogViewer';
import { DataFolderCard } from '@components/DataFolderCard';
import { Spinner } from '@components/ui/Spinner';
import { LOCALE_NAMES, asLocale, useLocale, useT } from '@renderer/i18n';
import { isBuiltInKey, trustedKeyRing } from '@shared/branding';
import type {
  ThemeMode,
  LauncherBehaviorOnLaunch,
  TrustedKey,
  UpdateCheck,
} from '@shared/ipc-types';

const api = window.ravenforge;

// Languages are listed by endonym, so they stay legible whichever locale the
// UI is currently in — someone who set the wrong one has to find their way back.
const LANGUAGE_OPTIONS = Object.entries(LOCALE_NAMES).map(([value, label]) => ({ value, label }));

export function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const settings = useSettingsStore((s) => s.settings);

  const THEME_OPTIONS = [
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'oled-black', label: t('settings.theme.oled') },
    { value: 'light', label: t('settings.theme.light') },
  ];

  const BEHAVIOR_OPTIONS = [
    { value: 'minimize', label: t('settings.onLaunch.minimize') },
    { value: 'close', label: t('settings.onLaunch.close') },
    { value: 'keep-open', label: t('settings.onLaunch.keepOpen') },
  ];
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const refreshFeeds = useNewsStore((s) => s.refresh);

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('settings.loading')} />
      </div>
    );
  }

  const addTrustedKey = async () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) return;
    const key: TrustedKey = {
      name: newKeyName.trim(),
      publicKey: newKeyValue.trim(),
      addedAt: new Date().toISOString(),
    };
    const result = await api.settings.addTrustedKey(key);
    if (result.success) {
      await update({ trustedPublicKeys: [...settings.trustedPublicKeys, key] });
      setNewKeyName('');
      setNewKeyValue('');
    } else {
      alert(result.error ?? t('settings.trustedKeyFailed'));
    }
  };

  const removeTrustedKey = async (publicKey: string) => {
    await api.settings.removeTrustedKey(publicKey);
    await update({
      trustedPublicKeys: settings.trustedPublicKeys.filter((k) => k.publicKey !== publicKey),
    });
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6 overflow-y-auto">
      <h1 className="text-lg font-display font-semibold text-rf-text">{t('settings.title')}</h1>

      <Section title={t('settings.section.appearance')}>
        <Select
          label={t('settings.theme')}
          options={THEME_OPTIONS}
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as ThemeMode })}
        />
        <Select
          label={t('settings.language')}
          options={LANGUAGE_OPTIONS}
          value={settings.language}
          onChange={(e) => update({ language: asLocale(e.target.value) })}
        />
      </Section>

      <Section title={t('settings.section.behavior')}>
        <Select
          label={t('settings.onLaunch')}
          options={BEHAVIOR_OPTIONS}
          value={settings.launcherBehaviorOnLaunch}
          onChange={(e) =>
            update({ launcherBehaviorOnLaunch: e.target.value as LauncherBehaviorOnLaunch })
          }
        />
        <CheckboxRow
          checked={settings.showLiveConsole}
          onChange={(v) => update({ showLiveConsole: v })}
          label={t('settings.showConsole')}
        />
        <CheckboxRow
          checked={settings.autoRemoveOrphanedMods}
          onChange={(v) => update({ autoRemoveOrphanedMods: v })}
          label={t('settings.autoRemoveOrphans')}
        />
        <CheckboxRow
          checked={settings.discordRichPresence}
          onChange={(v) => update({ discordRichPresence: v })}
          label={t('settings.discordPresence')}
        />
        <p className="text-xs text-rf-text-muted">{t('settings.discordPresenceHint')}</p>
        <CheckboxRow
          checked={settings.offlineMode}
          onChange={(v) => update({ offlineMode: v })}
          label={t('settings.offlineMode')}
        />
        <p className="text-xs text-rf-text-muted">{t('settings.offlineModeHint')}</p>
      </Section>

      <Section title={t('settings.section.network')}>
        <TextSetting
          label={t('settings.concurrency')}
          type="number"
          min={1}
          max={8}
          value={String(settings.downloadConcurrency)}
          invalidMessage={t('settings.concurrencyInvalid')}
          onCommit={(v) => update({ downloadConcurrency: Number(v) })}
        />
        <TextSetting
          label={t('settings.proxy')}
          value={settings.proxyUrl ?? ''}
          placeholder={t('settings.proxyPlaceholder')}
          invalidMessage={t('settings.proxyInvalid')}
          onCommit={(v) => update({ proxyUrl: v || undefined })}
        />
        <p className="text-xs text-rf-text-muted">{t('settings.proxyHint')}</p>
      </Section>

      <Section title={t('settings.section.sources')}>
        <TextSetting
          label={t('settings.newsFeed')}
          value={settings.newsFeedUrl ?? ''}
          placeholder={t('settings.feedPlaceholder', { feed: 'news' })}
          invalidMessage={t('settings.feedInvalid')}
          onCommit={async (v) => {
            const saved = await update({ newsFeedUrl: v });
            if (saved) await refreshFeeds();
            return saved;
          }}
        />
        <TextSetting
          label={t('settings.announcementFeed')}
          value={settings.announcementFeedUrl ?? ''}
          placeholder={t('settings.feedPlaceholder', { feed: 'announcements' })}
          invalidMessage={t('settings.feedInvalid')}
          onCommit={async (v) => {
            const saved = await update({ announcementFeedUrl: v });
            if (saved) await refreshFeeds();
            return saved;
          }}
        />
      </Section>

      <Section title={t('settings.section.trustedKeys')}>
        <p className="text-xs text-rf-text-muted">{t('settings.trustedKeysHint')}</p>

        {/* The built-in key leads the list because it is why a White Ravens pack
            reads "Verified" on a fresh install. Listing only the player's own
            keys made the badge look like it came from nowhere. */}
        <div className="space-y-2">
          {trustedKeyRing(settings.trustedPublicKeys).map((key) => {
            const builtIn = isBuiltInKey(key.publicKey);
            return (
              <div
                key={key.publicKey}
                className="flex items-start gap-2 rounded-lg border border-rf-border bg-rf-surface p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-rf-text">{key.name}</p>
                  <p className="text-[10px] font-mono text-rf-text-muted truncate">
                    {key.publicKey}
                  </p>
                  <p className="text-[10px] text-rf-text-muted">
                    {builtIn
                      ? t('settings.trustedKeyBuiltIn')
                      : t('settings.trustedKeyAdded', {
                          date: new Date(key.addedAt).toLocaleDateString(locale),
                        })}
                  </p>
                </div>
                {!builtIn && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={12} />}
                    onClick={() => removeTrustedKey(key.publicKey)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <CheckboxRow
          checked={settings.allowUnverifiedLoaderInstaller}
          onChange={(v) => update({ allowUnverifiedLoaderInstaller: v })}
          label={t('settings.allowUnverifiedInstaller')}
        />
        <p className="text-xs text-rf-text-muted">{t('settings.allowUnverifiedInstallerHint')}</p>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-rf-border bg-rf-surface p-3">
          <Input
            label={t('settings.trustedKeyName')}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t('settings.trustedKeyNamePlaceholder')}
          />
          <Input
            label={t('settings.trustedKeyValue')}
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder="MCowBQYDK2VwAyEA..."
          />
          <div className="col-span-2">
            <Button
              icon={<Plus size={14} />}
              onClick={addTrustedKey}
              disabled={!newKeyName.trim() || !newKeyValue.trim()}
            >
              {t('settings.trustedKeyAdd')}
            </Button>
          </div>
        </div>
      </Section>

      <Section title={t('settings.section.updates')}>
        <UpdateRow />
      </Section>

      <Section title={t('settings.section.data')}>
        <DataFolderCard />
        <PathRow
          label={t('settings.crashReportsFolder')}
          onOpen={async () => {
            const result = await api.system.getInfo();
            if (result.success && result.data) {
              await api.system.openPath(result.data.crashReportsDirectory);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-rf-text-secondary">{t('settings.logs')}:</span>
          <button
            onClick={() => setShowLogs(true)}
            className="text-sm text-rf-accent-text hover:underline"
          >
            {t('settings.showLogs')}
          </button>
          <span className="text-rf-text-muted">•</span>
          <button
            onClick={async () => {
              const result = await api.system.getLogsPath();
              if (result.success && result.data) {
                await api.system.openPath(result.data);
              }
            }}
            className="text-sm text-rf-accent-text hover:underline"
          >
            {t('common.openFolder')}
          </button>
        </div>
      </Section>

      {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}

      <div className="pt-4 border-t border-rf-border">
        <Button
          variant="danger"
          onClick={() => {
            if (confirm(t('settings.confirmReset'))) {
              void reset();
            }
          }}
        >
          {t('settings.reset')}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-display font-semibold text-rf-text-secondary uppercase tracking-wider">
        {title}
      </h2>
      <div className="space-y-3 pl-1">{children}</div>
    </div>
  );
}

/**
 * A validated settings field, written back when the field is left rather than
 * on every keystroke.
 *
 * The obvious `value={settings.x} onChange={(e) => update(...)}` shape cannot
 * work here. Each keystroke is a whole save, so `h` is submitted on its own,
 * the schema rejects it as not a URL, the store keeps the old settings, and
 * React restores the input to them. Measured in a real window: the proxy field
 * swallowed everything up to `socks5:` — the first prefix that happens to parse
 * as a URL — and the feed fields snapped back to the old address on every key.
 * Only pasting an already-valid value in one go ever survived.
 *
 * A local draft committed on blur puts the finished string in front of the
 * validator, and gives a rejection somewhere to be said out loud instead of
 * being mistaken for a field that eats what you type.
 */
function TextSetting({
  label,
  value,
  invalidMessage,
  onCommit,
  ...inputProps
}: {
  label: string;
  value: string;
  /** Shown when the main process refuses the value. */
  invalidMessage: string;
  /** `false` if the value was rejected. */
  onCommit: (value: string) => Promise<boolean>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Follow the stored value whenever something else changes it — Reset, mostly.
  // A rejected draft is deliberately *not* wiped here: `value` did not change,
  // so the text stays on screen to be corrected.
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = async () => {
    if (draft === value) return;
    setError((await onCommit(draft)) ? null : invalidMessage);
  };

  return (
    <Input
      label={label}
      value={draft}
      error={error ?? undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      // Enter is how people finish typing into a single field; without this it
      // does nothing at all and the value looks unsaved.
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      {...inputProps}
    />
  );
}

function CheckboxRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-rf-text-secondary cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-rf-accent"
      />
      {label}
    </label>
  );
}

function PathRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  const t = useT();

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-rf-text-secondary">{label}:</span>
      <button onClick={onOpen} className="text-sm text-rf-accent-text hover:underline">
        {t('common.openFolder')}
      </button>
    </div>
  );
}

/**
 * Installed version, latest version, and a way to ask.
 *
 * Deliberately shows the installed version *before* any check runs: that is the
 * number someone needs when filing a bug, and making them press a button to see
 * it — one that will not even work on a source build — is the wrong order.
 */
function UpdateRow() {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.system.getInfo().then((r) => {
      if (r.success && r.data) setVersion(r.data.launcherVersion);
    });
  }, []);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await api.updater.check();
      if (r.success && r.data) {
        setResult(r.data);
        setVersion(r.data.currentVersion);
      } else {
        setError(r.error ?? t('settings.updateCheckFailed'));
      }
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const r = await api.updater.download();
      if (r.success) setDownloaded(true);
      else setError(r.error ?? t('settings.updateDownloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-rf-text-secondary">
        {t('settings.installedVersion', { version: version ?? '…' })}
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" loading={checking} onClick={() => void check()}>
          {t('settings.checkUpdates')}
        </Button>

        {result?.status === 'available' && !downloaded && (
          <Button size="sm" loading={downloading} onClick={() => void download()}>
            {t('settings.downloadUpdate')}
          </Button>
        )}
        {downloaded && (
          <Button size="sm" onClick={() => void api.updater.install()}>
            {t('settings.restartToUpdate')}
          </Button>
        )}
      </div>

      {/* Four outcomes, four different sentences. Collapsing "could not check"
          into "you are up to date" is how someone stays on a build with a
          security fix missing and believes they are current. */}
      {result?.status === 'up-to-date' && (
        <p className="text-xs text-rf-text-muted">{t('settings.updateUpToDate')}</p>
      )}
      {result?.status === 'available' && (
        <p className="text-xs text-rf-accent-text">
          {t('settings.updateAvailable', { version: result.update.version })}
        </p>
      )}
      {result?.status === 'unsupported' && (
        <p className="text-xs text-rf-text-muted">
          {result.reason === 'development'
            ? t('settings.updateDevBuild')
            : result.reason === 'system-package'
              ? t('settings.updateSystemPackage')
              : t('settings.updateUnsignedPlatform')}
        </p>
      )}
      {result?.status === 'failed' && (
        <p className="text-xs text-rf-danger">
          {t('settings.updateCheckFailedWith', { error: result.error })}
        </p>
      )}
      {error && <p className="text-xs text-rf-danger">{error}</p>}
    </div>
  );
}
