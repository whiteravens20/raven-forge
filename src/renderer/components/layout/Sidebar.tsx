import { NavLink } from 'react-router';
import { Home, FolderOpen, Package, Sparkles, Settings, User, Coffee } from 'lucide-react';
import { useT, type TranslationKey } from '@renderer/i18n';

// The icon strip is narrow, so each entry carries a short label for the tile
// and a full one for assistive tech — they are not always the same word.
const navItems = [
  { to: '/', icon: Home, short: 'nav.home.short', title: 'nav.home.title' },
  { to: '/profiles', icon: FolderOpen, short: 'nav.profiles.short', title: 'nav.profiles.title' },
  { to: '/mods', icon: Package, short: 'nav.mods.short', title: 'nav.mods.title' },
  { to: '/content', icon: Sparkles, short: 'nav.content.short', title: 'nav.content.title' },
  { to: '/accounts', icon: User, short: 'nav.accounts.short', title: 'nav.accounts.title' },
  { to: '/settings', icon: Settings, short: 'nav.settings.short', title: 'nav.settings.title' },
] as const satisfies readonly {
  to: string;
  icon: typeof Home;
  short: TranslationKey;
  title: TranslationKey;
}[];

export function Sidebar() {
  const t = useT();

  return (
    <nav
      aria-label={t('nav.label')}
      className="flex w-16 flex-col items-center gap-1 bg-rf-bg-secondary border-r border-rf-border py-3 shrink-0"
    >
      {navItems.map(({ to, icon: Icon, short, title }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={t(title)}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-12 h-12 rounded-lg text-[10px] gap-0.5 transition-colors outline-none focus:ring-1 focus:ring-rf-accent ${
              isActive
                ? 'bg-rf-accent/15 text-rf-accent'
                : 'text-rf-text-muted hover:text-rf-text-secondary hover:bg-rf-surface'
            }`
          }
        >
          <Icon size={20} />
          <span>{t(short)}</span>
        </NavLink>
      ))}

      <div className="mt-auto">
        <NavLink
          to="/about"
          aria-label={t('nav.about.title')}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center w-12 h-12 rounded-lg text-[10px] gap-0.5 transition-colors outline-none focus:ring-1 focus:ring-rf-accent ${
              isActive
                ? 'bg-rf-accent/15 text-rf-accent'
                : 'text-rf-text-muted hover:text-rf-text-secondary hover:bg-rf-surface'
            }`
          }
        >
          <Coffee size={20} />
          <span>{t('nav.about.short')}</span>
        </NavLink>
      </div>
    </nav>
  );
}
