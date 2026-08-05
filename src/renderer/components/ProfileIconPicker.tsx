import { useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@components/ui/Button';
import { ProfileAvatar, invalidateAvatarCache } from '@components/ProfileAvatar';
import { PROFILE_PRESETS, PROFILE_PRESET_IDS } from '@components/profile-presets';
import { useProfileStore } from '@stores/profile-store';
import { useT } from '@renderer/i18n';
import type { Profile } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * Icon control for an existing profile. The file is copied into the profile's
 * directory by the main process, so the original can be moved or deleted
 * afterwards without breaking anything.
 */
export function ProfileIconPicker({ profile }: { profile: Profile }) {
  const reload = useProfileStore((s) => s.load);
  const update = useProfileStore((s) => s.update);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (sourcePath: string | null) => {
    setBusy(true);
    setError(null);
    const result = await api.profiles.setIcon(profile.id, sourcePath);
    if (result.success) {
      invalidateAvatarCache(profile.id);
      // A custom image outranks a preset; clear it so removing the upload
      // later falls back to initials rather than a preset the user forgot about.
      if (sourcePath) await update(profile.id, { iconPreset: undefined });
      await reload();
    } else {
      setError(result.error ?? t('profileIcon.failed'));
    }
    setBusy(false);
  };

  const handlePick = async () => {
    const picked = await api.system.selectFile([
      {
        name: t('profileIcon.fileFilter'),
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      },
    ]);
    if (!picked.success || !picked.data) return;
    await apply(picked.data);
  };

  const choosePreset = async (id: string) => {
    setBusy(true);
    setError(null);
    // Drop any uploaded file first, otherwise it would keep winning.
    if (profile.iconPath) {
      await api.profiles.setIcon(profile.id, null);
      invalidateAvatarCache(profile.id);
    }
    await update(profile.id, { iconPreset: profile.iconPreset === id ? undefined : id });
    setBusy(false);
  };

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-rf-text-secondary">
        {t('profileIcon.label')}
      </span>
      <div className="flex items-center gap-3">
        <ProfileAvatar profile={profile} size={56} />

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<ImagePlus size={13} />}
              onClick={() => void handlePick()}
              disabled={busy}
            >
              {profile.iconPath ? t('profileIcon.change') : t('profileIcon.pick')}
            </Button>
            {profile.iconPath && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => void apply(null)}
                disabled={busy}
              >
                {t('common.remove')}
              </Button>
            )}
          </div>
          <span className="text-[11px] text-rf-text-muted">{t('profileIcon.formats')}</span>
        </div>
      </div>

      <div className="mt-3">
        <span className="mb-1.5 block text-[11px] text-rf-text-muted">
          {t('profileIcon.presets')}
        </span>
        <div className="flex flex-wrap gap-2">
          {PROFILE_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => void choosePreset(id)}
              disabled={busy}
              aria-pressed={profile.iconPreset === id}
              className={`rounded-lg border p-0.5 transition-colors ${
                profile.iconPreset === id && !profile.iconPath
                  ? 'border-rf-accent'
                  : 'border-transparent hover:border-rf-border'
              }`}
            >
              <img src={PROFILE_PRESETS[id]} alt={id} width={36} height={36} className="rounded" />
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-rf-danger">{error}</p>}
    </div>
  );
}
