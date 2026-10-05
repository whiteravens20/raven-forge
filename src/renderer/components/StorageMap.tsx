// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useT, type TranslationKey } from '@renderer/i18n';
import { formatBytes } from '@renderer/format';
import type { StorageEntry, StorageId, StorageReport } from '@shared/ipc-types';

const api = window.ravenforge;

const TITLES: Record<StorageId, TranslationKey> = {
  profiles: 'storage.profiles.title',
  gameFiles: 'storage.gameFiles.title',
  java: 'storage.java.title',
  loaders: 'storage.loaders.title',
  state: 'storage.state.title',
  logs: 'storage.logs.title',
  crashReports: 'storage.crashReports.title',
  browser: 'storage.browser.title',
  pointer: 'storage.pointer.title',
  updateCache: 'storage.updateCache.title',
  program: 'storage.program.title',
  legacyHome: 'storage.legacyHome.title',
};

const BODIES: Record<StorageId, TranslationKey> = {
  profiles: 'storage.profiles.body',
  gameFiles: 'storage.gameFiles.body',
  java: 'storage.java.body',
  loaders: 'storage.loaders.body',
  state: 'storage.state.body',
  logs: 'storage.logs.body',
  crashReports: 'storage.crashReports.body',
  browser: 'storage.browser.body',
  pointer: 'storage.pointer.body',
  updateCache: 'storage.updateCache.body',
  program: 'storage.program.body',
  legacyHome: 'storage.legacyHome.body',
};

const GROUPS: ReadonlyArray<{ where: StorageEntry['where']; heading: TranslationKey }> = [
  { where: 'data', heading: 'storage.groupData' },
  { where: 'home', heading: 'storage.groupHome' },
  { where: 'system', heading: 'storage.groupSystem' },
];

/**
 * Every place the launcher writes to on this computer, with what is there now.
 *
 * Measured, not described. The page this replaces showed one path and said
 * everything sat in it, which stopped being true the day the data folder could
 * be moved — the log, the crash reports and the browser's files stayed behind,
 * and nothing on screen said where. A list that is read off the disk cannot
 * drift from it, and it answers the question people actually arrive with: what
 * has this put on my machine, where, and how much.
 */
export function StorageMap() {
  const t = useT();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The row whose folder would not open, and what the system said. */
  const [openError, setOpenError] = useState<{ id: StorageId; message: string } | null>(null);

  const measure = useCallback(async () => {
    setMeasuring(true);
    setFailed(null);
    try {
      const result = await api.system.getStorage();
      if (result.success && result.data) setReport(result.data);
      else setFailed(result.error ?? t('storage.failed'));
    } finally {
      setMeasuring(false);
    }
  }, [t]);

  useEffect(() => {
    void measure();
  }, [measure]);

  const open = async (entry: StorageEntry) => {
    setOpenError(null);
    const result = await api.system.openPath(entry.path);
    if (!result.success) {
      setOpenError({ id: entry.id, message: result.error ?? t('storage.openFailed') });
    }
  };

  if (!report) {
    return (
      <p className="text-xs text-rf-text-muted" role="status">
        {failed ?? t('storage.measuring')}
      </p>
    );
  }

  const total = report.entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  // Until the data is moved the two folders are one, and saying so is better
  // than showing the same path under two headings as if they were different.
  const together = report.root === report.home;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-rf-text-muted" role="status">
          {measuring ? t('storage.measuring') : t('storage.total', { size: formatBytes(total) })}
        </p>
        <button
          onClick={() => void measure()}
          disabled={measuring}
          className="flex items-center gap-1 text-xs text-rf-accent-text hover:underline disabled:opacity-50"
        >
          <RefreshCw size={12} className={measuring ? 'motion-safe:animate-spin' : ''} />
          {t('storage.refresh')}
        </button>
      </div>
      {failed && <p className="text-xs text-rf-danger">{failed}</p>}

      {GROUPS.map(({ where, heading }) => {
        const entries = report.entries.filter((entry) => entry.where === where);
        if (entries.length === 0) return null;
        return (
          <div key={where} className="space-y-1.5">
            <div>
              <h3 className="text-xs font-semibold text-rf-text-secondary">{t(heading)}</h3>
              {where !== 'system' && (
                <code className="select-text break-all font-mono text-[11px] text-rf-text-muted">
                  {where === 'data' ? report.root : report.home}
                </code>
              )}
              {where === 'home' && together && (
                <p className="text-xs text-rf-text-muted">{t('storage.homeIsData')}</p>
              )}
            </div>
            <div className="divide-y divide-rf-border overflow-hidden rounded-lg border border-rf-border bg-rf-surface">
              {entries.map((entry) => (
                <div key={entry.id} className="space-y-0.5 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-rf-text">{t(TITLES[entry.id])}</span>
                    <span className="text-xs tabular-nums text-rf-text-muted">
                      {entry.bytes === null ? t('storage.nothingYet') : formatBytes(entry.bytes)}
                    </span>
                    {entry.openable && entry.bytes !== null && (
                      <button
                        onClick={() => void open(entry)}
                        className="ml-auto flex shrink-0 items-center gap-1 text-xs text-rf-accent-text hover:underline"
                      >
                        <FolderOpen size={12} />
                        {t('common.openFolder')}
                      </button>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-rf-text-secondary">
                    {t(BODIES[entry.id])}
                  </p>
                  <code className="block select-text break-all font-mono text-[10px] leading-relaxed text-rf-text-muted">
                    {entry.path}
                  </code>
                  {openError?.id === entry.id && (
                    <p className="text-xs text-rf-danger">{openError.message}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <Keychain report={report} />
    </div>
  );
}

/**
 * What the operating system keeps for the launcher, said for this system.
 *
 * The earlier wording was "the system's password safe, the same one your
 * browser uses" — true of no browser, and no help to anyone who wanted to go
 * and look. This names the store, the way into it and what the entries are
 * called, because a claim about where a sign-in is kept is one a person should
 * be able to check.
 */
function Keychain({ report }: { report: StorageReport }) {
  const t = useT();
  const { platform, secrets } = report.keychain;

  const where: TranslationKey =
    platform === 'win32'
      ? 'storage.keychain.windows'
      : platform === 'darwin'
        ? 'storage.keychain.mac'
        : 'storage.keychain.linux';

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-rf-text-secondary">
        {t('storage.keychain.title')}
      </h3>
      <div className="space-y-1.5 rounded-lg border border-rf-border bg-rf-surface p-3 text-xs leading-relaxed text-rf-text-secondary">
        <p>{t('storage.keychain.what')}</p>
        <p>{t(where)}</p>
        <p className={secrets === null ? 'text-rf-warning' : 'text-rf-text'}>
          {secrets === null
            ? t('storage.keychain.unavailable')
            : secrets === 0
              ? t('storage.keychain.none')
              : t.plural('storage.keychain.count', secrets)}
        </p>
        <p>{t('storage.keychain.remove')}</p>
      </div>
    </div>
  );
}
