// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Save,
  X,
  Edit3,
  Download,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Package,
} from 'lucide-react';
import { useProfileStore } from '@stores/profile-store';
import { useAuthStore } from '@stores/auth-store';
import { useGameStore } from '@stores/game-store';
import { Button } from '@components/ui/Button';
import { ConfirmButton } from '@components/ui/ConfirmButton';
import { Input } from '@components/ui/Input';
import { Select } from '@components/ui/Select';
import { Switch } from '@components/ui/Switch';
import { EmptyState } from '@components/ui/EmptyState';
import { ProfileAvatar } from '@components/ProfileAvatar';
import { ProfileIconPicker } from '@components/ProfileIconPicker';
import { ProfileDeleteDialog } from '@components/ProfileDeleteDialog';
import { ProfileSourcePicker } from '@components/ProfileSourcePicker';
import { GameFailureNotice } from '@components/GameFailureNotice';
import { WorldBackupCard } from '@components/WorldBackupCard';
import { VersionChangeDialog } from '@components/VersionChangeDialog';
import { RamField } from '@components/RamField';
import { isAllocatableRam, isManifestUrl, isServerPort } from '@shared/profile-draft';
import { Banner } from '@components/ui/Banner';
import { formatBytes } from '@renderer/format';
import { useMachineMemoryMb } from '@hooks/use-machine-memory';
import { useLocale, useT, type TranslationKey } from '@renderer/i18n';
import { MAX_GAME_DIMENSION, MIN_GAME_HEIGHT, MIN_GAME_WIDTH } from '@shared/constants';
import { GAME_LANGUAGES } from '@shared/game-languages';
import { loaderLabel } from '@shared/labels';
import { defaultLoaderVersion } from '@shared/loader-version';
import { recommendedRamMb } from '@shared/memory';
import type {
  ModLoaderType,
  MrpackExport,
  OrphanedProfile,
  Profile,
  ProfileFileSummary,
  ProfileSyncStatus,
  ManifestVerification,
  LoaderVersion,
  JavaInstallation,
  JavaProbe,
} from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * The "choose a file…" row of the Java picker.
 *
 * Not a path, and cannot be mistaken for one: the file dialog only ever hands
 * back an absolute path, and no absolute path starts with a question mark on
 * either platform.
 */
const BROWSE_FOR_JAVA = '?browse';

const LOADER_OPTIONS = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
];

type DraftProfile = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The form labels of the fields a profile import leaves out, keyed by field.
 *
 * `Partial`, because the list of fields is the main process's to extend: one
 * added there and not here is shown under its own name instead of a label.
 */
const DROPPED_FIELD_LABELS: Partial<Record<string, TranslationKey>> = {
  customJavaPath: 'profileForm.java',
  javaArgs: 'profileForm.javaArgsShort',
  manifestUrl: 'profiles.manifestUrl',
};

/** `totalMb` is the machine's memory, or undefined when it could not be read. */
function emptyDraft(totalMb: number | undefined): DraftProfile {
  return {
    name: '',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    modLoaderVersion: undefined,
    manifestUrl: undefined,
    serverIp: undefined,
    serverPort: undefined,
    javaArgs: undefined,
    allocatedRamMb: recommendedRamMb(totalMb),
    customJavaPath: undefined,
    windowWidth: undefined,
    windowHeight: undefined,
    fullscreen: undefined,
    gameLanguage: undefined,
    notes: undefined,
  };
}

/**
 * What is wrong with the window size, if anything.
 *
 * The pair is the unit. `customResolution` in the launcher applies a size only
 * when both halves are there and both are usable, because Mojang's own
 * argument rule gates them together — so an editor that accepted a lone width
 * would be storing a number the game is never given, with nothing on screen
 * saying so.
 */
function windowSizeProblem(draft: DraftProfile): 'incomplete' | 'range' | null {
  const { windowWidth: width, windowHeight: height } = draft;
  if (width === undefined && height === undefined) return null;
  if (width === undefined || height === undefined) return 'incomplete';
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 'range';
  if (width < MIN_GAME_WIDTH || height < MIN_GAME_HEIGHT) return 'range';
  if (width > MAX_GAME_DIMENSION || height > MAX_GAME_DIMENSION) return 'range';
  return null;
}

/**
 * The part of a profile the form edits.
 *
 * Not the pictures and not the play statistics. Save sends the whole draft, and
 * the main process merges it over the profile — so a draft that carried them
 * wrote back whatever they had been when Edit was pressed: the avatar picked a
 * moment ago in this same form went back to the old one, and a game that ended
 * while the form was open lost that session's hours.
 */
function profileToDraft(p: Profile): DraftProfile {
  const {
    id: _id,
    createdAt: _ca,
    updatedAt: _ua,
    iconPath: _iconPath,
    iconUrl: _iconUrl,
    iconPreset: _iconPreset,
    lastPlayed: _lastPlayed,
    totalPlayTimeMinutes: _playTime,
    ...draft
  } = p;
  return draft;
}

export function ProfilesPage() {
  const profiles = useProfileStore((s) => s.profiles);
  const selectedId = useProfileStore((s) => s.selectedProfileId);
  const select = useProfileStore((s) => s.select);
  const createProfile = useProfileStore((s) => s.create);
  const updateProfile = useProfileStore((s) => s.update);
  const removeProfile = useProfileStore((s) => s.remove);
  const duplicateProfile = useProfileStore((s) => s.duplicate);
  const duplicating = useProfileStore((s) =>
    s.selectedProfileId ? s.duplicating.has(s.selectedProfileId) : false,
  );
  const reload = useProfileStore((s) => s.load);

  const t = useT();
  const machineMemoryMb = useMachineMemoryMb();
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [draft, setDraft] = useState<DraftProfile>(() => emptyDraft(undefined));
  const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
  const [verification, setVerification] = useState<ManifestVerification | null>(null);
  /** The profile whose delete confirmation is open. */
  const [deleting, setDeleting] = useState<Profile | null>(null);
  /** True while the "where does this profile come from?" dialog is open. */
  const [choosingSource, setChoosingSource] = useState(false);
  /** Profile files left on disk by a "delete, keep files". */
  const [orphans, setOrphans] = useState<OrphanedProfile[]>([]);
  /** The last pack export, so its result can be reported instead of vanishing. */
  const [exported, setExported] = useState<MrpackExport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Something worth saying that is not a failure — what an import left out. */
  const [notice, setNotice] = useState<string | null>(null);
  const [exportingPack, setExportingPack] = useState(false);
  /** Open while the player is asked what a pack export should hold. */
  const [askingExport, setAskingExport] = useState(false);
  const [exportSettings, setExportSettings] = useState(true);
  /** Set while a Minecraft version change is waiting to be confirmed. */
  const [versionChange, setVersionChange] = useState<ProfileFileSummary | null>(null);

  const refreshOrphans = useCallback(async () => {
    const result = await api.profiles.listOrphaned();
    setOrphans(result.success && result.data ? result.data : []);
  }, []);

  useEffect(() => {
    void refreshOrphans();
  }, [refreshOrphans, profiles.length]);

  const adopt = async (profileId: string) => {
    const result = await api.profiles.adoptOrphaned(profileId);
    if (result.success) {
      await reload();
      select(profileId);
    }
    await refreshOrphans();
  };

  const discard = async (profileId: string) => {
    setActionError(null);
    const r = await api.profiles.discardOrphaned(profileId);
    if (!r.success) setActionError(r.error ?? t('orphans.discardFailed'));
    await refreshOrphans();
  };
  /**
   * The profiles a sync was started for from this page and has not come back.
   *
   * By id. This was one flag for the page, so a sync started on one profile
   * showed as running on whichever profile was looked at next — with a Cancel
   * that stopped that other profile's launch instead — and its result, when it
   * arrived, was written onto the badge of the profile then on screen.
   */
  const [syncingIds, setSyncingIds] = useState<ReadonlySet<string>>(new Set());
  const syncing = selectedId ? syncingIds.has(selectedId) : false;
  /** Whichever profile is on screen now, for a reply that arrives later. */
  const shownId = useRef(selectedId);
  useEffect(() => {
    shownId.current = selectedId;
  }, [selectedId]);
  // A sync rewrites the mods folder, and a launch being prepared or a game
  // that is up is reading it. Starting one under the other also aborted the
  // launch without a word: both register a job for the profile, and the second
  // cancels the first.
  const gameBusy = useGameStore((s) =>
    selectedId ? s.preparing.has(selectedId) || s.running.has(selectedId) : false,
  );
  /** Why the main process would not save what is in the form. */
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedProfile = profiles.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!selectedId) {
      setSyncStatus(null);
      setVerification(null);
      return;
    }
    // The guard every other effect on this page has, and this one did not.
    // `manifest.verify` goes to the network, so switching profiles while it is
    // in flight used to land profile A's sync state and signature badge on the
    // screen showing profile B — and a signature badge is the one thing here
    // that must never be about a different pack than the one being read.
    let cancelled = false;
    void api.profiles.getSyncStatus(selectedId).then((r) => {
      if (!cancelled && r.success && r.data) setSyncStatus(r.data);
    });
    if (selectedProfile?.manifestUrl) {
      void api.manifest.verify(selectedId).then((r) => {
        if (!cancelled && r.success && r.data) setVerification(r.data);
      });
    } else {
      setVerification(null);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedProfile?.manifestUrl]);

  // The startup pack check lands after this page is already on screen, so the
  // badge has to be told rather than asked. Without this it would keep the
  // answer it read on selection until the profile was selected again — which is
  // how it managed to say "Synced" about a pack that had moved twice.
  useEffect(() => {
    return api.on('profiles:sync-status-changed', (status) => {
      if (status.profileId === selectedId) setSyncStatus(status);
    });
  }, [selectedId]);

  const startCreate = () => setChoosingSource(true);

  /** The by-hand route, reached from the source picker. */
  const startFromScratch = () => {
    setChoosingSource(false);
    setDraft(emptyDraft(machineMemoryMb));
    setSaveError(null);
    setMode('create');
  };

  const startEdit = () => {
    if (!selectedProfile) return;
    setDraft(profileToDraft(selectedProfile));
    setSaveError(null);
    setMode('edit');
  };

  const cancel = () => setMode('view');

  const save = async () => {
    if (!draft.name.trim()) return;
    // Changing the Minecraft version is not an edit like the others: the mods
    // stay behind at the version they were built for, and a world opened by a
    // newer Minecraft is upgraded in place and will not open on the old one
    // again. Ask, but only where this profile actually has something to lose.
    if (
      mode === 'edit' &&
      selectedProfile &&
      draft.minecraftVersion !== selectedProfile.minecraftVersion
    ) {
      const r = await api.profiles.getFileSummary(selectedProfile.id);
      const summary = r.success ? r.data : undefined;
      if (summary && (summary.mods > 0 || summary.worlds > 0)) {
        setVersionChange(summary);
        return;
      }
    }
    await commit();
  };

  /** Write the draft out. Split from `save` so the dialog can call it too. */
  const commit = async (backupFirst = false) => {
    setSaveError(null);
    if (mode === 'edit' && selectedProfile && backupFirst) {
      // Before the profile moves, not after: a failed copy must leave the
      // profile exactly as it was rather than half-changed.
      const backup = await api.profiles.backupWorlds(selectedProfile.id, 'version-change');
      if (!backup.success) {
        setActionError(backup.error ?? t('versionChange.backupFailed'));
        return;
      }
    }

    const saved =
      mode === 'create'
        ? await createProfile(draft)
        : mode === 'edit' && selectedProfile
          ? await updateProfile(selectedProfile.id, draft)
          : undefined;
    // The form stays open over what was typed. It used to close either way,
    // and a profile the main process had refused was simply not there.
    if (saved && !saved.success) {
      setSaveError(saved.error ?? t('profileForm.saveFailed'));
      return;
    }
    setMode('view');
  };

  const handleSync = async () => {
    const id = selectedId;
    if (!id || syncingIds.has(id) || gameBusy) return;
    const hasAddress = Boolean(selectedProfile?.manifestUrl);
    setSyncingIds((ids) => new Set(ids).add(id));
    try {
      await api.mods.syncManifest(id);
      // Both badges are asked again, and only shown if this profile is still
      // the one on screen. The signature badge was not asked at all, so a
      // profile that read "Not checked yet" went on reading it after the sync
      // that had just checked.
      const [status, verified] = await Promise.all([
        api.profiles.getSyncStatus(id),
        hasAddress ? api.manifest.verify(id) : undefined,
      ]);
      if (shownId.current !== id) return;
      if (status.success && status.data) setSyncStatus(status.data);
      if (verified?.success && verified.data) setVerification(verified.data);
    } finally {
      setSyncingIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCancelSync = async () => {
    if (!selectedId) return;
    await api.game.cancel(selectedId);
  };

  const handleDuplicate = async () => {
    if (!selectedProfile) return;
    setActionError(null);
    setNotice(null);
    const r = await duplicateProfile(
      selectedProfile.id,
      t('profiles.copyName', { name: selectedProfile.name }),
    );
    // Said either way: the copy is everything but the world backups, and
    // whoever goes looking for those in it should not conclude they were lost.
    if (r.success) setNotice(t('profiles.duplicated'));
    else setActionError(r.error ?? t('profiles.duplicateFailed'));
  };

  const handleExport = async () => {
    if (!selectedId) return;
    const r = await api.profiles.export(selectedId);
    if (!r.success || !r.data) return;
    const blob = new Blob([r.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedProfile?.name ?? 'profile'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Export the profile as a `.mrpack` — the mods, not just the settings.
   *
   * Asked about first: a pack carries the author's own game settings and mod
   * configuration unless they say otherwise, and it used to carry them without
   * saying so. Where it goes is asked in the main process, so nothing here names
   * a path. A `null` result is the player closing that dialog, which is not a
   * failure and should say nothing at all.
   */
  // The question is about one profile; it does not follow the selection to another.
  useEffect(() => {
    setAskingExport(false);
  }, [selectedId]);

  const askExportPack = () => {
    setExported(null);
    setActionError(null);
    setAskingExport(true);
  };

  const handleExportPack = async () => {
    if (!selectedId) return;
    setExportingPack(true);
    try {
      const r = await api.profiles.exportPack(selectedId, { settings: exportSettings });
      if (!r.success) setActionError(r.error ?? t('profiles.exportPackFailed'));
      else if (r.data) setExported(r.data);
      setAskingExport(false);
    } finally {
      setExportingPack(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Profile list */}
      <div className="flex w-64 flex-col border-r border-rf-border bg-rf-bg-secondary">
        <div className="flex items-center justify-between border-b border-rf-border p-3">
          <h2 className="text-xs font-display font-semibold text-rf-text-secondary uppercase tracking-wider">
            {t('profiles.title')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={14} />}
            onClick={startCreate}
            title={t('profiles.new')}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => {
                select(profile.id);
                setMode('view');
              }}
              className={`flex w-full items-center gap-2.5 border-b border-rf-border px-3 py-2.5 text-left transition-colors ${
                profile.id === selectedId
                  ? 'bg-rf-accent/10 border-l-2 border-l-rf-accent'
                  : 'hover:bg-rf-surface'
              }`}
            >
              <ProfileAvatar profile={profile} size={32} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-rf-text">{profile.name}</span>
                <span className="truncate text-xs text-rf-text-muted">
                  MC {profile.minecraftVersion} • {loaderLabel(profile.modLoader)}
                </span>
              </span>
            </button>
          ))}
          {profiles.length === 0 && orphans.length === 0 && (
            <EmptyState
              kind="profiles"
              title={t('profiles.empty')}
              hint={t('profiles.emptyHint')}
              className="p-4"
            />
          )}

          {/* Files kept behind by a delete. Directories are keyed by id, so
              nothing else in the launcher would ever lead back to them — without
              this list, "keep the files" is an offer with no way to collect. */}
          {orphans.length > 0 && (
            <div className="border-t border-rf-border p-3">
              <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-rf-text-secondary">
                {t('orphans.title')}
              </h3>
              <p className="mt-1 text-xs text-rf-text-muted">{t('orphans.hint')}</p>
              {orphans.map(({ profile, files }) => (
                <div key={profile.id} className="mt-2 rounded-lg border border-rf-border p-2">
                  <p className="truncate text-sm font-medium text-rf-text">{profile.name}</p>
                  <p className="text-xs text-rf-text-muted">
                    MC {profile.minecraftVersion} • {loaderLabel(profile.modLoader)} •{' '}
                    {formatBytes(files.bytes)}
                  </p>
                  {files.worlds > 0 && (
                    <p className="text-xs text-rf-warning">
                      {t.plural('delete.worlds', files.worlds)}
                    </p>
                  )}
                  <div className="mt-1.5 flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => void adopt(profile.id)}>
                      {t('orphans.restore')}
                    </Button>
                    <ConfirmButton
                      question={t('orphans.confirmDiscard')}
                      confirmLabel={t('common.delete')}
                      onConfirm={() => void discard(profile.id)}
                    >
                      {t('orphans.discard')}
                    </ConfirmButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail / form */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Above the pane switch on purpose: a save that fails leaves the form
            open, and a notice rendered inside the detail view would never be
            seen by the person who caused it. */}
        {actionError && (
          <div className="mx-auto mb-4 max-w-2xl">
            <Banner type="urgent" dismissible onDismiss={() => setActionError(null)}>
              {actionError}
            </Banner>
          </div>
        )}
        {notice && (
          <div className="mx-auto mb-4 max-w-2xl">
            <Banner type="info" dismissible onDismiss={() => setNotice(null)}>
              {notice}
            </Banner>
          </div>
        )}
        {askingExport && (
          <div
            className="mx-auto mb-4 max-w-2xl rounded-lg border border-rf-border bg-rf-surface p-4"
            role="group"
            aria-label={t('profiles.exportPack')}
          >
            <p className="text-sm text-rf-text">{t('profiles.exportPackAsk')}</p>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={exportSettings}
                onChange={(e) => setExportSettings(e.target.checked)}
                className="mt-0.5 accent-rf-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-rf-text">
                  {t('profiles.exportPackSettings')}
                </span>
                <span className="mt-0.5 block text-xs text-rf-text-muted">
                  {t('profiles.exportPackSettingsHint')}
                </span>
              </span>
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={exportingPack}
                onClick={() => setAskingExport(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" loading={exportingPack} onClick={() => void handleExportPack()}>
                {t('profiles.exportPackGo')}
              </Button>
            </div>
          </div>
        )}
        {exported && (
          <div className="mx-auto mb-4 max-w-2xl">
            <Banner
              type="info"
              dismissible
              onDismiss={() => {
                setExported(null);
                setActionError(null);
              }}
            >
              {t.plural('profiles.exportPackDone', exported.files, { path: exported.path })}
              {/* Bundled files are why a 20 KB pack is sometimes 300 MB, and why
                  a recipient with no network still gets those. Worth a sentence. */}
              {exported.bundled > 0 &&
                ` ${t.plural('profiles.exportPackBundled', exported.bundled, {
                  size: formatBytes(exported.bundledBytes),
                })}`}
              {exported.skippedDisabled > 0 &&
                ` ${t.plural('profiles.exportPackSkipped', exported.skippedDisabled)}`}
            </Banner>
          </div>
        )}
        {mode !== 'view' ? (
          <ProfileForm
            draft={draft}
            onChange={setDraft}
            onCancel={cancel}
            onSave={save}
            saveError={saveError}
            isCreate={mode === 'create'}
            profile={mode === 'edit' ? selectedProfile : undefined}
            machineMemoryMb={machineMemoryMb}
          />
        ) : selectedProfile ? (
          <ProfileDetail
            profile={selectedProfile}
            syncStatus={syncStatus}
            verification={verification}
            syncing={syncing}
            syncBlocked={gameBusy}
            onCancelSync={handleCancelSync}
            onEdit={startEdit}
            onDuplicate={() => void handleDuplicate()}
            duplicating={duplicating}
            onDelete={() => setDeleting(selectedProfile)}
            onExport={handleExport}
            onExportPack={askExportPack}
            exportingPack={exportingPack}
            onOpenFolder={() => void api.profiles.openFolder(selectedProfile.id)}
            onSync={handleSync}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-rf-text-muted">
            {t('profiles.pickOrCreate')}
          </div>
        )}
      </div>

      {choosingSource && (
        <ProfileSourcePicker
          onCancel={() => setChoosingSource(false)}
          onScratch={startFromScratch}
          onCreated={(profile, said) => {
            setChoosingSource(false);
            // A profile file can carry a Java path, JVM arguments and a pack
            // address, and an import takes none of them. Said here, where the
            // new profile is on screen, so nobody finds out at the first launch.
            const dropped = said?.dropped ?? [];
            setNotice(
              dropped.length > 0
                ? t('profiles.importDropped', {
                    fields: dropped
                      .map((field) => {
                        const label = DROPPED_FIELD_LABELS[field];
                        return label ? t(label) : field;
                      })
                      .join(', '),
                  })
                : null,
            );
            // A pack whose files did not all arrive still left a profile, and
            // this is the screen with the button that finishes the job — so
            // this is where it is said, naming that button.
            setActionError(
              said?.unfinished
                ? t('packs.installUnfinished', {
                    name: profile.name,
                    action: t(profile.manifestUrl ? 'profiles.sync' : 'profiles.repair'),
                    error: said.unfinished,
                  })
                : null,
            );
            void reload().then(() => select(profile.id));
          }}
        />
      )}

      {versionChange && selectedProfile && (
        <VersionChangeDialog
          from={selectedProfile.minecraftVersion}
          to={draft.minecraftVersion}
          summary={versionChange}
          onCancel={() => setVersionChange(null)}
          onConfirm={(backupFirst) => {
            setVersionChange(null);
            void commit(backupFirst);
          }}
        />
      )}

      {deleting && (
        <ProfileDeleteDialog
          profileId={deleting.id}
          profileName={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={(deleteFiles) => {
            const id = deleting.id;
            setDeleting(null);
            setActionError(null);
            void removeProfile(id, deleteFiles).then((r) => {
              if (!r.success) setActionError(r.error ?? t('profiles.deleteFailed'));
              // Files that would not go are listed as kept; show them now.
              void refreshOrphans();
            });
          }}
        />
      )}
    </div>
  );
}

// ── Detail view ─────────────────────────────────────────────

interface DetailProps {
  profile: Profile;
  syncStatus: ProfileSyncStatus | null;
  verification: ManifestVerification | null;
  syncing: boolean;
  /** The game is running or being got ready, so the mods cannot be changed. */
  syncBlocked: boolean;
  onCancelSync: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onDelete: () => void;
  onExport: () => void;
  onExportPack: () => void;
  exportingPack: boolean;
  onOpenFolder: () => void;
  onSync: () => void;
}

function ProfileDetail({
  profile,
  syncStatus,
  verification,
  syncing,
  syncBlocked,
  onCancelSync,
  onEdit,
  onDuplicate,
  duplicating,
  onDelete,
  onExport,
  onExportPack,
  exportingPack,
  onOpenFolder,
  onSync,
}: DetailProps) {
  const t = useT();
  // Dates follow the UI language, not a hardcoded pl-PL.
  const locale = useLocale();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-semibold text-rf-text">{profile.name}</h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<Edit3 size={14} />}
            onClick={onEdit}
            title={t('common.edit')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy size={14} />}
            loading={duplicating}
            onClick={onDuplicate}
            title={t('profiles.duplicate')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Download size={14} />}
            onClick={onExport}
            title={t('common.export')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Package size={14} />}
            loading={exportingPack}
            onClick={onExportPack}
            title={t('profiles.exportPack')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderOpen size={14} />}
            onClick={onOpenFolder}
            title={t('profiles.openFolder')}
          />
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={onDelete}
            title={t('common.delete')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('profiles.fieldMinecraft')} value={profile.minecraftVersion} />
        <Field
          label={t('profiles.fieldLoader')}
          value={`${loaderLabel(profile.modLoader)}${profile.modLoaderVersion ? ` ${profile.modLoaderVersion}` : ''}`}
        />
        <Field label={t('profiles.fieldRam')} value={`${profile.allocatedRamMb} MB`} />
        <Field
          label={t('profiles.fieldServer')}
          value={profile.serverIp ? `${profile.serverIp}:${profile.serverPort ?? 25565}` : '—'}
        />
      </div>

      {/* A profile made from a pack file gets the same box. It follows no
          address, but the pack it was installed from is kept, and syncing
          against that is how an install that stopped half-way is finished. */}
      {(profile.manifestUrl || syncStatus?.importedPack) && (
        <div className="space-y-2 rounded-lg border border-rf-border bg-rf-surface p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-rf-text-muted">
              {t(profile.manifestUrl ? 'profiles.manifestUrl' : 'profiles.importedPack')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={12} />}
              loading={syncing}
              disabled={syncing || syncBlocked}
              title={syncBlocked ? t('profiles.syncBlocked') : undefined}
              onClick={onSync}
            >
              {t(profile.manifestUrl ? 'profiles.sync' : 'profiles.repair')}
            </Button>
            {/* A modpack sync is a long download — let the user stop it. */}
            {syncing && (
              <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={onCancelSync}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
          {profile.manifestUrl ? (
            <p className="text-xs font-mono text-rf-text break-all">{profile.manifestUrl}</p>
          ) : (
            <p className="text-xs text-rf-text-muted">{t('profiles.importedPackHint')}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {syncStatus && <SyncBadge status={syncStatus} />}
            {verification && <VerificationBadge verification={verification} />}
          </div>
          {/* The reason, in the main process's words. The badge alone said
              "Sync error" for a dead address, a file that failed its hash and
              a manifest refused over its signature alike. */}
          {syncStatus?.status === 'error' && syncStatus.errorMessage && (
            <p role="alert" className="break-words text-xs text-rf-danger">
              {syncStatus.errorMessage}
            </p>
          )}
        </div>
      )}

      {profile.serverIp && <QuickConnect profile={profile} />}

      {profile.notes && (
        <div className="rounded-lg border border-rf-border bg-rf-surface p-3">
          <p className="text-xs text-rf-text-muted mb-1">{t('profiles.notes')}</p>
          <p className="text-sm text-rf-text-secondary whitespace-pre-wrap">{profile.notes}</p>
        </div>
      )}

      <WorldBackupCard profileId={profile.id} />

      {profile.lastPlayed && (
        <p className="text-xs text-rf-text-muted">
          {t('profiles.lastPlayed', {
            date: new Date(profile.lastPlayed).toLocaleDateString(locale),
          })}
          {profile.totalPlayTimeMinutes
            ? ` • ${t('profiles.totalPlayTime', { hours: Math.round(profile.totalPlayTimeMinutes / 60) })}`
            : ''}
        </p>
      )}
    </div>
  );
}

/**
 * Start the game and join the profile's server in one press.
 *
 * The same launch as Play, through the same routine in the game store, so it
 * gets the same answers. It used to make the call itself and look at nothing
 * that came back: with no account signed in, the button spun through the
 * pack, Java and the assets and then went quiet.
 */
function QuickConnect({ profile }: { profile: Profile }) {
  const t = useT();
  const signedIn = useAuthStore((s) => s.accounts.some((a) => a.id === s.activeAccountId));
  const preparing = useGameStore((s) => s.preparing.has(profile.id));
  const running = useGameStore((s) => s.running.has(profile.id));
  const cancelling = useGameStore((s) => s.cancelling.has(profile.id));
  const launch = useGameStore((s) => s.launch);
  const cancelLaunch = useGameStore((s) => s.cancelLaunch);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Spinner only while preparing — a running game has nothing pending. */}
        <Button
          size="lg"
          loading={preparing}
          disabled={!signedIn || running}
          onClick={() => void launch(profile.id, { quickConnect: true })}
        >
          {t('profiles.quickConnect', {
            address: `${profile.serverIp}:${profile.serverPort ?? 25565}`,
          })}
        </Button>
        {preparing && (
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={14} />}
            loading={cancelling}
            onClick={() => void cancelLaunch(profile.id)}
          >
            {cancelling ? t('home.cancelling') : t('home.cancelLaunch')}
          </Button>
        )}
      </div>
      {/* The launch needs an account and only finds that out after the
          downloads, so the button says it first. */}
      {!signedIn && <p className="text-xs text-rf-warning">{t('home.notSignedIn')}</p>}
      <GameFailureNotice profileId={profile.id} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rf-border bg-rf-surface p-3">
      <p className="text-xs text-rf-text-muted">{label}</p>
      <p className="text-sm font-medium text-rf-text">{value}</p>
    </div>
  );
}

function SyncBadge({ status }: { status: ProfileSyncStatus }) {
  const t = useT();
  const map: Record<ProfileSyncStatus['status'], { label: string; className: string }> = {
    synced: {
      label: t('profiles.syncStatus.synced'),
      className: 'bg-rf-success/15 text-rf-success border-rf-success/30',
    },
    'updates-available': {
      label: t('profiles.syncStatus.updates', { count: status.pendingUpdates }),
      className: 'bg-rf-warning/15 text-rf-warning border-rf-warning/30',
    },
    error: {
      label: t('profiles.syncStatus.error'),
      className: 'bg-rf-danger/15 text-rf-danger border-rf-danger/30',
    },
    'never-synced': {
      label: t('profiles.syncStatus.never'),
      className: 'bg-rf-bg-tertiary text-rf-text-muted border-rf-border',
    },
  };
  const cfg = map[status.status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function VerificationBadge({ verification }: { verification: ManifestVerification }) {
  const t = useT();

  if (verification.neverSynced || !verification.signed) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rf-border bg-rf-bg-tertiary px-2 py-0.5 text-xs text-rf-text-muted">
        <ShieldAlert size={12} />{' '}
        {t(verification.neverSynced ? 'profiles.verify.notSynced' : 'profiles.verify.unsigned')}
      </span>
    );
  }
  if (verification.valid) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rf-success/30 bg-rf-success/15 px-2 py-0.5 text-xs text-rf-success">
        <ShieldCheck size={12} />{' '}
        {t('profiles.verify.valid', { signer: verification.signerName ?? '' })}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-rf-danger/30 bg-rf-danger/15 px-2 py-0.5 text-xs text-rf-danger"
      title={verification.error}
    >
      <ShieldAlert size={12} /> {t('profiles.verify.invalid')}
    </span>
  );
}

// ── Edit / create form ─────────────────────────────────────

interface FormProps {
  draft: DraftProfile;
  onChange: (next: DraftProfile) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Why the last Save was refused, in the main process's words. */
  saveError: string | null;
  isCreate: boolean;
  /** The saved profile being edited; absent while creating a new one. */
  profile?: Profile;
  /** The machine's physical memory, or undefined while unknown or unreadable. */
  machineMemoryMb?: number;
}

function ProfileForm({
  draft,
  onChange,
  onCancel,
  onSave,
  saveError,
  isCreate,
  profile,
  machineMemoryMb,
}: FormProps) {
  // Closed lists rather than free text: a typo in either field only surfaces
  // minutes later as a failed download. Both fall back to a text input if the
  // list cannot be fetched, so a first run without network is still usable.
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const [mcVersionsFailed, setMcVersionsFailed] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [systemJavas, setSystemJavas] = useState<JavaInstallation[]>([]);
  const [javaProbe, setJavaProbe] = useState<JavaProbe | 'checking' | null>(null);
  /** Whether the "is this profile already on a snapshot?" question has been asked. */
  const snapshotsConsidered = useRef(false);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersionsFailed, setLoaderVersionsFailed] = useState(false);
  const [noLoaderBuilds, setNoLoaderBuilds] = useState(false);

  // The version lookup resolves after the render that started it, so the effect
  // below needs the draft as it is *then*, not as it was when the fetch began.
  const latest = useRef({ draft, onChange });
  latest.current = { draft, onChange };

  useEffect(() => {
    let cancelled = false;
    void api.game.getVersions(showSnapshots).then((r) => {
      if (cancelled) return;
      if (!r.success || !r.data?.length) {
        setMcVersionsFailed(true);
        return;
      }
      setMcVersions(r.data);
      // A profile already pinned to a snapshot opens with the toggle off, and
      // its own version is then not among the options — which a <select>
      // renders as whatever happens to be first. Turning the toggle on is the
      // honest reading of a profile that is already on one.
      //
      // Once only, and that is the important part: the same test on every
      // fetch would turn the toggle straight back on the moment its owner
      // switched it off, since the profile is still on the snapshot they
      // picked. After this first look the control belongs to the person
      // using it.
      if (snapshotsConsidered.current) return;
      snapshotsConsidered.current = true;
      if (!showSnapshots && !r.data.includes(latest.current.draft.minecraftVersion)) {
        setShowSnapshots(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showSnapshots]);

  useEffect(() => {
    let cancelled = false;
    void api.java.detectSystem().then((r) => {
      if (!cancelled && r.success && r.data) setSystemJavas(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-run on the Minecraft version too: the same JVM is fine for one version
  // of the game and too old for the next, so the answer belongs to the pair.
  useEffect(() => {
    const chosen = draft.customJavaPath;
    if (!chosen) {
      setJavaProbe(null);
      return;
    }
    let cancelled = false;
    setJavaProbe('checking');
    void api.java.probe(chosen, draft.minecraftVersion).then((r) => {
      if (!cancelled) setJavaProbe(r.success && r.data ? r.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.customJavaPath, draft.minecraftVersion]);

  useEffect(() => {
    setLoaderVersions([]);
    setLoaderVersionsFailed(false);
    setNoLoaderBuilds(false);
    if (draft.modLoader === 'vanilla') return;
    let cancelled = false;
    void api.loaders.getVersions(draft.modLoader, draft.minecraftVersion).then((r) => {
      if (cancelled) return;
      if (!r.success) {
        setLoaderVersionsFailed(true);
        return;
      }
      const versions = r.data ?? [];
      setLoaderVersions(versions);
      // An empty list is an answer, not an error: NeoForge genuinely has no
      // builds for 1.16.5. Saying "lookup failed" and offering a free-text box
      // invites the player to type a version that cannot exist.
      setNoLoaderBuilds(versions.length === 0);

      // The draft always holds a build that is on the list. Every loader
      // version belongs to exactly one Minecraft version, so one carried over
      // from the previous selection is now wrong — and one that was never
      // chosen is not a choice the launcher can act on: a profile saved with
      // "latest" in this field had no version, so its loader was never
      // installed and it started as plain Minecraft. The default is therefore
      // written into the draft, where it is visible and is what gets saved.
      const { draft: current, onChange: apply } = latest.current;
      if (!versions.some((v) => v.version === current.modLoaderVersion)) {
        apply({ ...current, modLoaderVersion: defaultLoaderVersion(versions) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draft.modLoader, draft.minecraftVersion]);

  const t = useT();
  const recommendedLoaderVersion = defaultLoaderVersion(loaderVersions);
  const set = <K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) => {
    onChange({ ...draft, [key]: value });
  };

  // The version the profile is on is always among the options, even when the
  // list being shown does not contain it — during the refetch the toggle above
  // triggers, and for good in the case of a version Mojang has stopped
  // publishing. A <select> whose value is not an option displays the first one
  // instead, which is a screen that quietly disagrees with the profile.
  const versionOptions =
    draft.minecraftVersion && !mcVersions.includes(draft.minecraftVersion)
      ? [draft.minecraftVersion, ...mcVersions]
      : mcVersions;

  // One message, on the field that is actually wrong: a pair of identical red
  // lines under two adjacent boxes reads as two faults rather than one.
  const sizeProblem = windowSizeProblem(draft);
  const sizeMessage =
    sizeProblem === 'incomplete'
      ? t('profileForm.windowSizeBoth')
      : sizeProblem === 'range'
        ? t('profileForm.windowSizeRange', {
            minWidth: MIN_GAME_WIDTH,
            minHeight: MIN_GAME_HEIGHT,
            max: MAX_GAME_DIMENSION,
          })
        : undefined;
  const heightAtFault = sizeProblem === 'incomplete' && draft.windowHeight === undefined;

  // The other three things the main process refuses a profile over. Said beside
  // the field, and Save waits for them, rather than found out from a refusal.
  const urlProblem = draft.manifestUrl !== undefined && !isManifestUrl(draft.manifestUrl);
  const portProblem = draft.serverPort !== undefined && !isServerPort(draft.serverPort);
  const ramProblem = !isAllocatableRam(draft.allocatedRamMb);

  // Same rule as the version list: whatever the profile is already set to is
  // always one of the options, so the control cannot show a runtime other than
  // the one that will actually be used.
  const javaOptions = [
    { value: '', label: t('profileForm.javaManaged') },
    ...(draft.customJavaPath && !systemJavas.some((j) => j.path === draft.customJavaPath)
      ? [{ value: draft.customJavaPath, label: draft.customJavaPath }]
      : []),
    ...systemJavas.map((j) => ({ value: j.path, label: `Java ${j.version} — ${j.path}` })),
    { value: BROWSE_FOR_JAVA, label: t('profileForm.javaBrowse') },
  ];

  const chooseJava = async (value: string) => {
    if (value !== BROWSE_FOR_JAVA) {
      set('customJavaPath', value || undefined);
      return;
    }
    const picked = await api.system.selectFile();
    // Cancelling leaves the profile as it was; the select is driven by the
    // draft, so it snaps back to what is really set without being told to.
    if (picked.success && picked.data) set('customJavaPath', picked.data);
  };

  // A file that cannot be checked is reported, not refused: the drive it lives
  // on may simply not be plugged in today, and a profile that cannot be saved
  // is a worse answer than one that says what is wrong with it. The launch
  // checks again and refuses there, where it matters.
  const javaMessage =
    javaProbe === null
      ? undefined
      : javaProbe === 'checking'
        ? t('profileForm.javaChecking')
        : javaProbe.version === null
          ? t('profileForm.javaNotJava')
          : javaProbe.version < javaProbe.requiredVersion
            ? t('profileForm.javaTooOld', {
                version: javaProbe.version,
                required: javaProbe.requiredVersion,
              })
            : t('profileForm.javaFound', { version: javaProbe.version });
  const javaAtFault =
    javaProbe !== null &&
    javaProbe !== 'checking' &&
    (javaProbe.version === null || javaProbe.version < javaProbe.requiredVersion);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-display font-semibold text-rf-text">
        {isCreate ? t('profileForm.createTitle') : t('profileForm.editTitle', { name: draft.name })}
      </h2>

      {/* The icon is copied into the profile's own directory, so it needs a
          saved profile to belong to. */}
      {profile ? (
        <ProfileIconPicker profile={profile} />
      ) : (
        <p className="text-xs text-rf-text-muted">{t('profileForm.iconAfterSave')}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('profileForm.name')}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('profileForm.namePlaceholder')}
          autoFocus
        />
        {mcVersions.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Select
              label={t('profileForm.mcVersion')}
              options={versionOptions.map((v) => ({ value: v, label: v }))}
              value={draft.minecraftVersion}
              onChange={(e) => set('minecraftVersion', e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Switch
                checked={showSnapshots}
                onChange={setShowSnapshots}
                label={t('profileForm.showSnapshots')}
              />
              <span className="text-xs text-rf-text-muted">{t('profileForm.showSnapshots')}</span>
            </div>
            {showSnapshots && (
              <p className="text-xs text-rf-text-muted">{t('profileForm.snapshotHint')}</p>
            )}
          </div>
        ) : (
          // Only reachable when Mojang's manifest could not be fetched and no
          // cached copy exists — a free field beats blocking profile creation.
          <Input
            label={t('profileForm.mcVersion')}
            value={draft.minecraftVersion}
            onChange={(e) => set('minecraftVersion', e.target.value)}
            placeholder="1.21.4"
            error={mcVersionsFailed ? t('profileForm.versionsFailed') : undefined}
          />
        )}
        <Select
          label={t('profileForm.loader')}
          options={LOADER_OPTIONS}
          value={draft.modLoader}
          onChange={(e) => set('modLoader', e.target.value as ModLoaderType)}
        />
        {draft.modLoader === 'vanilla' ? null : noLoaderBuilds ? (
          // No free-text fallback here: there is nothing valid to type.
          <Select
            label={t('profileForm.loaderVersion')}
            options={[{ value: '', label: '—' }]}
            value=""
            onChange={() => {}}
            disabled
            error={t('profileForm.noLoaderBuilds', {
              loader: loaderLabel(draft.modLoader),
              mcVersion: draft.minecraftVersion,
            })}
          />
        ) : loaderVersions.length > 0 ? (
          <Select
            label={t('profileForm.loaderVersion')}
            options={loaderVersions.map((v) => ({
              value: v.version,
              label:
                v.version === recommendedLoaderVersion
                  ? `${v.version} — ${t('profileForm.loaderRecommended')}`
                  : v.stable
                    ? v.version
                    : `${v.version} (${t('profileForm.loaderUnstable')})`,
            }))}
            value={draft.modLoaderVersion ?? ''}
            onChange={(e) => set('modLoaderVersion', e.target.value || undefined)}
          />
        ) : (
          // The list is still loading, or could not be fetched. Left empty, the
          // build is chosen at the first launch, which needs the network anyway.
          <Input
            label={t('profileForm.loaderVersion')}
            value={draft.modLoaderVersion ?? ''}
            onChange={(e) => set('modLoaderVersion', e.target.value || undefined)}
            placeholder={t('profileForm.loaderVersionAuto')}
            error={loaderVersionsFailed ? t('profileForm.versionsFailed') : undefined}
          />
        )}
        <RamField
          valueMb={draft.allocatedRamMb}
          onChange={(mb) => set('allocatedRamMb', mb)}
          totalMb={machineMemoryMb}
        />
        <Input
          label={t('profileForm.manifestUrl')}
          value={draft.manifestUrl ?? ''}
          onChange={(e) => set('manifestUrl', e.target.value.trim() || undefined)}
          placeholder="https://server.com/manifest.json"
          error={urlProblem ? t('profileForm.manifestUrlInvalid') : undefined}
        />
        <Input
          label={t('profileForm.serverIp')}
          value={draft.serverIp ?? ''}
          onChange={(e) => set('serverIp', e.target.value || undefined)}
          placeholder="play.example.com"
        />
        <Input
          label={t('profileForm.serverPort')}
          type="number"
          value={draft.serverPort ?? ''}
          onChange={(e) => set('serverPort', e.target.value ? Number(e.target.value) : undefined)}
          placeholder="25565"
          min={1}
          max={65535}
          error={portProblem ? t('profileForm.serverPortRange') : undefined}
        />
        <Input
          label={t('profileForm.javaArgs')}
          value={draft.javaArgs ?? ''}
          onChange={(e) => set('javaArgs', e.target.value || undefined)}
          placeholder="-XX:+UseG1GC"
          className="col-span-2"
        />
      </div>

      {/* Folded away rather than absent: none of it is needed to make a profile
          that works, and all of it is needed by somebody. */}
      <details className="rounded-lg border border-rf-border bg-rf-surface/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-rf-text-secondary">
          {t('profileForm.advanced')}
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-3">
          <Input
            label={t('profileForm.windowWidth')}
            type="number"
            value={draft.windowWidth ?? ''}
            onChange={(e) =>
              set('windowWidth', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="854"
            min={MIN_GAME_WIDTH}
            max={MAX_GAME_DIMENSION}
            error={heightAtFault ? undefined : sizeMessage}
          />
          <Input
            label={t('profileForm.windowHeight')}
            type="number"
            value={draft.windowHeight ?? ''}
            onChange={(e) =>
              set('windowHeight', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="480"
            min={MIN_GAME_HEIGHT}
            max={MAX_GAME_DIMENSION}
            error={heightAtFault ? sizeMessage : undefined}
          />
          <p className="col-span-2 -mt-1 text-xs text-rf-text-muted">
            {t('profileForm.windowSizeHint')}
          </p>
          <Select
            label={t('profileForm.windowMode')}
            options={[
              { value: '', label: t('profileForm.windowModeGame') },
              { value: 'false', label: t('profileForm.windowModeWindowed') },
              { value: 'true', label: t('profileForm.windowModeFullscreen') },
            ]}
            value={draft.fullscreen === undefined ? '' : String(draft.fullscreen)}
            onChange={(e) =>
              set('fullscreen', e.target.value === '' ? undefined : e.target.value === 'true')
            }
          />
          <p className="col-span-2 text-xs text-rf-text-muted">{t('profileForm.windowModeHint')}</p>
          <Select
            label={t('profileForm.gameLanguage')}
            options={[
              { value: '', label: t('profileForm.gameLanguageGame') },
              // Whatever the profile already names is always on offer, the same
              // rule the version and Java pickers follow: a code from outside
              // the short list must not be shown as something else.
              ...(draft.gameLanguage && !GAME_LANGUAGES.some((l) => l.code === draft.gameLanguage)
                ? [{ value: draft.gameLanguage, label: draft.gameLanguage }]
                : []),
              ...GAME_LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
            ]}
            value={draft.gameLanguage ?? ''}
            onChange={(e) => set('gameLanguage', e.target.value || undefined)}
          />
          <p className="col-span-2 text-xs text-rf-text-muted">
            {t('profileForm.gameLanguageHint')}
          </p>
          <div className="col-span-2 flex flex-col gap-1">
            <Select
              label={t('profileForm.java')}
              options={javaOptions}
              value={draft.customJavaPath ?? ''}
              onChange={(e) => void chooseJava(e.target.value)}
              error={javaAtFault ? javaMessage : undefined}
            />
            {!javaAtFault && javaMessage && (
              <span className="text-xs text-rf-text-muted">{javaMessage}</span>
            )}
            <p className="text-xs text-rf-text-muted">{t('profileForm.javaHint')}</p>
          </div>
        </div>
      </details>

      <div className="space-y-2">
        <label className="text-xs font-medium text-rf-text-secondary">
          {t('profileForm.notes')}
        </label>
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || undefined)}
          rows={3}
          className="w-full rounded-lg border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-text placeholder:text-rf-text-muted outline-none focus:border-rf-accent-text transition-colors resize-none"
          placeholder={t('profileForm.notesPlaceholder')}
        />
      </div>

      {saveError && (
        <Banner type="urgent">
          {t('profileForm.saveRefused')} {saveError}
        </Banner>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          onClick={onSave}
          icon={<Save size={14} />}
          disabled={
            !draft.name.trim() || sizeProblem !== null || urlProblem || portProblem || ramProblem
          }
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel} icon={<X size={14} />}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
