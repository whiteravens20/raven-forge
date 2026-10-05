// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { ShieldCheck, ExternalLink } from 'lucide-react';
import {
  MS_AUTH_BASE,
  XBOX_AUTH_URL,
  XSTS_AUTH_URL,
  MC_SERVICES_API,
  MOJANG_VERSION_MANIFEST,
  MOJANG_RESOURCES,
  ADOPTIUM_API,
  FABRIC_META_API,
  QUILT_META_API,
  FORGE_MAVEN_ROOT,
  FORGE_PROMOTIONS_URL,
  NEOFORGE_MAVEN_ROOT,
  MODRINTH_API_BASE,
  MODRINTH_CDN_HOST,
} from '@shared/constants';
import { WHITE_RAVENS_PACKS_URL, privacyPolicyUrl } from '@shared/branding';
import { useSettingsStore } from '@stores/settings-store';
import { StorageMap } from '@components/StorageMap';
import { useT, useLocale, type TranslationKey } from '@renderer/i18n';

const api = window.ravenforge;

/**
 * What this page is for.
 *
 * The full policy lives in `docs/PRIVACY.md` and is linked at the bottom, so
 * this is deliberately not a copy of it — a second copy of a document is a
 * document that will disagree with the first one within two releases.
 *
 * It answers the same question about *this* install instead: every place the
 * launcher has written to on this disk, measured; the feed addresses actually
 * configured; and a destination list built from the constants the networking
 * code fetches from. Change an endpoint and this page changes with it; add one
 * and it will be missing here, which is the failure mode worth having, because
 * it is the only one a reader can spot.
 */

/** `https://api.modrinth.com/v2` → `api.modrinth.com`. */
function host(url: string): string {
  return new URL(url).host;
}

interface Destination {
  /**
   * Who this is, in words. The addresses below it are the proof, not the
   * heading — nobody recognises their Minecraft account in
   * `xsts.auth.xboxlive.com`.
   */
  who: TranslationKey;
  hosts: string[];
  when: TranslationKey;
  sends: TranslationKey;
  /** Draws the eye: this is the one that carries something you typed. */
  notable?: boolean;
}

const DESTINATIONS: readonly Destination[] = [
  {
    who: 'privacy.dest.auth.who',
    hosts: [host(MS_AUTH_BASE), host(XBOX_AUTH_URL), host(XSTS_AUTH_URL), host(MC_SERVICES_API)],
    when: 'privacy.dest.auth.when',
    sends: 'privacy.dest.auth.sends',
  },
  {
    who: 'privacy.dest.mojang.who',
    hosts: [host(MOJANG_VERSION_MANIFEST), host(MOJANG_RESOURCES)],
    when: 'privacy.dest.mojang.when',
    sends: 'privacy.dest.nothing',
  },
  {
    who: 'privacy.dest.java.who',
    hosts: [host(ADOPTIUM_API)],
    when: 'privacy.dest.java.when',
    sends: 'privacy.dest.java.sends',
  },
  {
    who: 'privacy.dest.loaders.who',
    hosts: [
      host(FABRIC_META_API),
      host(QUILT_META_API),
      host(FORGE_MAVEN_ROOT),
      host(FORGE_PROMOTIONS_URL),
      host(NEOFORGE_MAVEN_ROOT),
    ],
    when: 'privacy.dest.loaders.when',
    sends: 'privacy.dest.nothing',
  },
  {
    who: 'privacy.dest.modrinth.who',
    // The API, and the host the files and icons it points at are served from.
    hosts: [host(MODRINTH_API_BASE), MODRINTH_CDN_HOST],
    when: 'privacy.dest.modrinth.when',
    sends: 'privacy.dest.modrinth.sends',
    notable: true,
  },
  {
    who: 'privacy.dest.packs.who',
    hosts: [host(WHITE_RAVENS_PACKS_URL)],
    when: 'privacy.dest.packs.when',
    sends: 'privacy.dest.nothing',
  },
  {
    who: 'privacy.dest.updates.who',
    // electron-updater derives this from the publish block in
    // electron-builder.config.js, so there is no constant to point at.
    hosts: ['github.com'],
    when: 'privacy.dest.updates.when',
    sends: 'privacy.dest.updates.sends',
  },
];

export function PrivacyPage() {
  const t = useT();
  const locale = useLocale();
  const settings = useSettingsStore((s) => s.settings);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header className="space-y-3">
        <h1 className="text-lg font-display font-semibold text-rf-text">{t('privacy.title')}</h1>
        <div className="flex items-start gap-3 rounded-lg border border-rf-accent/30 bg-rf-accent/5 p-4">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-rf-accent-text" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-rf-text">{t('privacy.lead')}</p>
            <p className="text-xs leading-relaxed text-rf-text-secondary">
              {t('privacy.leadBody')}
            </p>
          </div>
        </div>
      </header>

      <Section title={t('privacy.never.title')}>
        <ul className="space-y-1.5">
          {(
            [
              'privacy.never.telemetry',
              'privacy.never.identifier',
              'privacy.never.upload',
              'privacy.never.account',
            ] as const
          ).map((key) => (
            <Item key={key}>{t(key)}</Item>
          ))}
        </ul>
      </Section>

      <Section title={t('privacy.local.title')}>
        <p className="text-sm leading-relaxed text-rf-text-secondary">{t('privacy.local.body')}</p>
        {/* Read off the disk, not written down: one path and "everything is in
            it" was true of a default install and of nothing else. */}
        <StorageMap />
      </Section>

      <Section title={t('privacy.dest.title')}>
        <p className="text-sm leading-relaxed text-rf-text-secondary">{t('privacy.dest.body')}</p>
        <div className="divide-y divide-rf-border overflow-hidden rounded-lg border border-rf-border bg-rf-surface">
          {DESTINATIONS.map((dest) => (
            <div key={dest.hosts.join()} className="space-y-1 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-rf-text">{t(dest.who)}</span>
                <span className="text-xs text-rf-text-muted">— {t(dest.when)}</span>
              </div>
              <p
                className={`text-xs leading-relaxed ${
                  dest.notable ? 'text-rf-warning' : 'text-rf-text-secondary'
                }`}
              >
                {t(dest.sends)}
              </p>
              {/* Small and last: the addresses are here so the claim above can
                  be checked, not because anybody needs to read them. */}
              <p className="font-mono text-[10px] leading-relaxed text-rf-text-muted">
                {dest.hosts.join('  ·  ')}
              </p>
            </div>
          ))}
        </div>

        {/* Configurable, so shown as configured rather than as shipped. */}
        <div className="space-y-1.5">
          <p className="text-sm text-rf-text-secondary">{t('privacy.dest.feeds')}</p>
          <FeedRow label={t('settings.newsFeed')} url={settings?.newsFeedUrl} />
          <FeedRow label={t('settings.announcementFeed')} url={settings?.announcementFeedUrl} />
        </div>
      </Section>

      <Section title={t('privacy.game.title')}>
        <p className="text-sm leading-relaxed text-rf-text-secondary">{t('privacy.game.body')}</p>
        <p className="rounded-lg border border-rf-warning/30 bg-rf-warning/5 p-3 text-xs leading-relaxed text-rf-text-secondary">
          {t('privacy.game.mods')}
        </p>
      </Section>

      <Section title={t('privacy.control.title')}>
        <ul className="space-y-1.5">
          {(
            [
              'privacy.control.offline',
              'privacy.control.feeds',
              'privacy.control.proxy',
              'privacy.control.discord',
              'privacy.control.packs',
              'privacy.control.updates',
              'privacy.control.diagnostics',
              'privacy.control.location',
              'privacy.control.delete',
            ] as const
          ).map((key) => (
            <Item key={key}>{t(key)}</Item>
          ))}
        </ul>
      </Section>

      <footer className="flex flex-col gap-2 border-t border-rf-border pt-4">
        <button
          onClick={() => void api.system.openUrl(privacyPolicyUrl(locale))}
          className="flex items-center gap-1.5 self-start text-sm text-rf-accent-text hover:underline"
        >
          <ExternalLink size={14} />
          {t('privacy.fullPolicy')}
        </button>
        <p className="text-xs leading-relaxed text-rf-text-muted">{t('privacy.fullPolicyHint')}</p>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-rf-text-secondary">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm leading-relaxed text-rf-text-secondary">
      <span aria-hidden className="text-rf-accent-text">
        •
      </span>
      <span>{children}</span>
    </li>
  );
}

/** An address the player set, or a plain statement that they turned it off. */
function FeedRow({ label, url }: { label: string; url?: string }) {
  const t = useT();

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-rf-border bg-rf-surface px-3 py-2">
      <span className="text-xs text-rf-text-muted">{label}:</span>
      {url ? (
        <code className="break-all font-mono text-xs text-rf-text-secondary">{host(url)}</code>
      ) : (
        <span className="text-xs text-rf-text-secondary">{t('privacy.dest.feedOff')}</span>
      )}
    </div>
  );
}
