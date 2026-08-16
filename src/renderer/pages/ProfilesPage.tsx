import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Save,
  X,
  Edit3,
  Download,
  Upload,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useProfileStore } from '@stores/profile-store';
import { useGameStore } from '@stores/game-store';
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { Select } from '@components/ui/Select';
import { EmptyState } from '@components/ui/EmptyState';
import { ProfileAvatar } from '@components/ProfileAvatar';
import { ProfileIconPicker } from '@components/ProfileIconPicker';
import { ProfileDeleteDialog } from '@components/ProfileDeleteDialog';
import { ProfileSourcePicker } from '@components/ProfileSourcePicker';
import { formatBytes } from '@renderer/format';
import { useLocale, useT } from '@renderer/i18n';
import { loaderLabel } from '@shared/labels';
import type {
  ModLoaderType,
  OrphanedProfile,
  Profile,
  ProfileSyncStatus,
  ManifestVerification,
  LoaderVersion,
} from '@shared/ipc-types';

const api = window.ravenforge;

const LOADER_OPTIONS = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
];

type DraftProfile = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

function emptyDraft(): DraftProfile {
  return {
    name: '',
    minecraftVersion: '1.21.4',
    modLoader: 'fabric',
    modLoaderVersion: undefined,
    manifestUrl: undefined,
    serverIp: undefined,
    serverPort: undefined,
    javaArgs: undefined,
    allocatedRamMb: 4096,
    customJavaPath: undefined,
    windowWidth: undefined,
    windowHeight: undefined,
    fullscreen: undefined,
    gameDirectory: undefined,
    preLaunchCommand: undefined,
    notes: undefined,
  };
}

function profileToDraft(p: Profile): DraftProfile {
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...draft } = p;
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
  const reload = useProfileStore((s) => s.load);

  const t = useT();
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [draft, setDraft] = useState<DraftProfile>(emptyDraft);
  const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
  const [verification, setVerification] = useState<ManifestVerification | null>(null);
  /** The profile whose delete confirmation is open. */
  const [deleting, setDeleting] = useState<Profile | null>(null);
  /** True while the "where does this profile come from?" dialog is open. */
  const [choosingSource, setChoosingSource] = useState(false);
  /** Profile files left on disk by a "delete, keep files". */
  const [orphans, setOrphans] = useState<OrphanedProfile[]>([]);

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
    await api.profiles.discardOrphaned(profileId);
    await refreshOrphans();
  };
  const [syncing, setSyncing] = useState(false);

  const beginPreparing = useGameStore((s) => s.beginPreparing);
  const endPreparing = useGameStore((s) => s.endPreparing);
  const quickConnectPreparing = useGameStore((s) =>
    selectedId ? s.preparing.has(selectedId) : false,
  );
  const quickConnectBusy = useGameStore((s) =>
    selectedId ? s.running.has(selectedId) || s.preparing.has(selectedId) : false,
  );

  const selectedProfile = profiles.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!selectedId) {
      setSyncStatus(null);
      setVerification(null);
      return;
    }
    void api.profiles.getSyncStatus(selectedId).then((r) => {
      if (r.success && r.data) setSyncStatus(r.data);
    });
    if (selectedProfile?.manifestUrl) {
      void api.manifest.verify(selectedId).then((r) => {
        if (r.success && r.data) setVerification(r.data);
      });
    } else {
      setVerification(null);
    }
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
    setDraft(emptyDraft());
    setMode('create');
  };

  const startEdit = () => {
    if (!selectedProfile) return;
    setDraft(profileToDraft(selectedProfile));
    setMode('edit');
  };

  const cancel = () => setMode('view');

  const save = async () => {
    if (!draft.name.trim()) return;
    if (mode === 'create') {
      await createProfile(draft);
    } else if (mode === 'edit' && selectedProfile) {
      await updateProfile(selectedProfile.id, draft);
    }
    setMode('view');
  };

  const handleSync = async () => {
    if (!selectedId) return;
    setSyncing(true);
    try {
      await api.mods.syncManifest(selectedId);
      const r = await api.profiles.getSyncStatus(selectedId);
      if (r.success && r.data) setSyncStatus(r.data);
    } finally {
      setSyncing(false);
    }
  };

  const handleCancelSync = async () => {
    if (!selectedId) return;
    await api.game.cancel(selectedId);
  };

  const handleQuickConnect = async () => {
    if (!selectedId || quickConnectBusy) return;
    beginPreparing(selectedId);
    try {
      await api.game.launch({ profileId: selectedId, quickConnect: true });
    } finally {
      endPreparing(selectedId);
    }
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

  const handleImport = async () => {
    const filePath = await api.system.selectFile([{ name: 'Profile JSON', extensions: ['json'] }]);
    if (!filePath.success || !filePath.data) return;
    // Read file via fetch — file:// URLs aren't allowed, so we round-trip through a fresh tag
    const json = await fetch(`file://${filePath.data}`)
      .then((r) => r.text())
      .catch(() => null);
    if (!json) return;
    await api.profiles.import(json);
    await reload();
  };

  return (
    <div className="flex h-full">
      {/* Profile list */}
      <div className="flex w-64 flex-col border-r border-rf-border bg-rf-bg-secondary">
        <div className="flex items-center justify-between border-b border-rf-border p-3">
          <h2 className="text-xs font-display font-semibold text-rf-text-secondary uppercase tracking-wider">
            {t('profiles.title')}
          </h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={<Upload size={14} />}
              onClick={handleImport}
              title={t('profiles.import')}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus size={14} />}
              onClick={startCreate}
              title={t('profiles.new')}
            />
          </div>
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
                    <Button size="sm" variant="danger" onClick={() => void discard(profile.id)}>
                      {t('orphans.discard')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail / form */}
      <div className="flex-1 overflow-y-auto p-6">
        {mode !== 'view' ? (
          <ProfileForm
            draft={draft}
            onChange={setDraft}
            onCancel={cancel}
            onSave={save}
            isCreate={mode === 'create'}
            profile={mode === 'edit' ? selectedProfile : undefined}
          />
        ) : selectedProfile ? (
          <ProfileDetail
            profile={selectedProfile}
            syncStatus={syncStatus}
            verification={verification}
            syncing={syncing}
            onCancelSync={handleCancelSync}
            onEdit={startEdit}
            onDuplicate={() =>
              duplicateProfile(
                selectedProfile.id,
                t('profiles.copyName', { name: selectedProfile.name }),
              )
            }
            onDelete={() => setDeleting(selectedProfile)}
            onExport={handleExport}
            onOpenFolder={() => void api.profiles.openFolder(selectedProfile.id)}
            onSync={handleSync}
            onQuickConnect={handleQuickConnect}
            quickConnectBusy={quickConnectBusy}
            quickConnectPreparing={quickConnectPreparing}
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
          onCreated={(profileId) => {
            setChoosingSource(false);
            void reload().then(() => select(profileId));
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
            void removeProfile(id, deleteFiles);
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
  onCancelSync: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onOpenFolder: () => void;
  onSync: () => void;
  onQuickConnect: () => void;
  quickConnectBusy: boolean;
  quickConnectPreparing: boolean;
}

function ProfileDetail({
  profile,
  syncStatus,
  verification,
  syncing,
  onCancelSync,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onOpenFolder,
  onSync,
  onQuickConnect,
  quickConnectBusy,
  quickConnectPreparing,
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
            onClick={onDuplicate}
            title={t('common.duplicate')}
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

      {profile.manifestUrl && (
        <div className="space-y-2 rounded-lg border border-rf-border bg-rf-surface p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-rf-text-muted">{t('profiles.manifestUrl')}</p>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={12} />}
              loading={syncing}
              disabled={syncing}
              onClick={onSync}
            >
              {t('profiles.sync')}
            </Button>
            {/* A modpack sync is a long download — let the user stop it. */}
            {syncing && (
              <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={onCancelSync}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
          <p className="text-xs font-mono text-rf-text break-all">{profile.manifestUrl}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {syncStatus && <SyncBadge status={syncStatus} />}
            {verification && <VerificationBadge verification={verification} />}
          </div>
        </div>
      )}

      {/* Spinner only while preparing — a running game has nothing pending. */}
      {profile.serverIp && (
        <Button
          onClick={onQuickConnect}
          size="lg"
          loading={quickConnectPreparing}
          disabled={quickConnectBusy}
        >
          {t('profiles.quickConnect', {
            address: `${profile.serverIp}:${profile.serverPort ?? 25565}`,
          })}
        </Button>
      )}

      {profile.notes && (
        <div className="rounded-lg border border-rf-border bg-rf-surface p-3">
          <p className="text-xs text-rf-text-muted mb-1">{t('profiles.notes')}</p>
          <p className="text-sm text-rf-text-secondary whitespace-pre-wrap">{profile.notes}</p>
        </div>
      )}

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
  isCreate: boolean;
  /** The saved profile being edited; absent while creating a new one. */
  profile?: Profile;
}

function ProfileForm({ draft, onChange, onCancel, onSave, isCreate, profile }: FormProps) {
  // Closed lists rather than free text: a typo in either field only surfaces
  // minutes later as a failed download. Both fall back to a text input if the
  // list cannot be fetched, so a first run without network is still usable.
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const [mcVersionsFailed, setMcVersionsFailed] = useState(false);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersionsFailed, setLoaderVersionsFailed] = useState(false);
  const [noLoaderBuilds, setNoLoaderBuilds] = useState(false);

  // The version lookup resolves after the render that started it, so the effect
  // below needs the draft as it is *then*, not as it was when the fetch began.
  const latest = useRef({ draft, onChange });
  latest.current = { draft, onChange };

  useEffect(() => {
    let cancelled = false;
    void api.game.getVersions().then((r) => {
      if (cancelled) return;
      if (r.success && r.data?.length) setMcVersions(r.data);
      else setMcVersionsFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

      // Every loader version belongs to exactly one Minecraft version, so a
      // version carried over from the previous selection is now wrong. Without
      // this the select falls back to displaying its first option while the
      // draft still holds the stale value — and that is what gets saved.
      const { draft: current, onChange: apply } = latest.current;
      if (
        current.modLoaderVersion &&
        !versions.some((v) => v.version === current.modLoaderVersion)
      ) {
        apply({ ...current, modLoaderVersion: undefined });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draft.modLoader, draft.minecraftVersion]);

  const t = useT();
  const set = <K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) => {
    onChange({ ...draft, [key]: value });
  };

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
          <Select
            label={t('profileForm.mcVersion')}
            options={mcVersions.map((v) => ({ value: v, label: v }))}
            value={draft.minecraftVersion}
            onChange={(e) => set('minecraftVersion', e.target.value)}
          />
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
            options={[
              { value: '', label: t('profileForm.loaderVersionLatest') },
              ...loaderVersions.map((v) => ({
                value: v.version,
                label: v.stable ? v.version : `${v.version} (${t('profileForm.loaderUnstable')})`,
              })),
            ]}
            value={draft.modLoaderVersion ?? ''}
            onChange={(e) => set('modLoaderVersion', e.target.value || undefined)}
          />
        ) : (
          <Input
            label={t('profileForm.loaderVersion')}
            value={draft.modLoaderVersion ?? ''}
            onChange={(e) => set('modLoaderVersion', e.target.value || undefined)}
            placeholder="latest"
            error={loaderVersionsFailed ? t('profileForm.versionsFailed') : undefined}
          />
        )}
        <Input
          label={t('profileForm.ram')}
          type="number"
          value={draft.allocatedRamMb}
          onChange={(e) => set('allocatedRamMb', Number(e.target.value))}
          min={512}
          max={32768}
          step={512}
        />
        <Input
          label={t('profileForm.manifestUrl')}
          value={draft.manifestUrl ?? ''}
          onChange={(e) => set('manifestUrl', e.target.value || undefined)}
          placeholder="https://server.com/manifest.json"
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
        />
        <Input
          label={t('profileForm.javaArgs')}
          value={draft.javaArgs ?? ''}
          onChange={(e) => set('javaArgs', e.target.value || undefined)}
          placeholder="-XX:+UseG1GC"
          className="col-span-2"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-rf-text-secondary">
          {t('profileForm.notes')}
        </label>
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || undefined)}
          rows={3}
          className="w-full rounded-lg border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-text placeholder:text-rf-text-muted outline-none focus:border-rf-accent transition-colors resize-none"
          placeholder={t('profileForm.notesPlaceholder')}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} icon={<Save size={14} />} disabled={!draft.name.trim()}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel} icon={<X size={14} />}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
