import clsx from 'clsx';
import { Activity, ChartColumn, ExternalLink, Layers, LogOut, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { type AdminMessages, useT } from '../i18n';

const NAV: { to: string; label: keyof AdminMessages['nav']; icon: LucideIcon; end: boolean }[] = [
  { to: '/admin', label: 'versions', icon: Layers, end: true },
  { to: '/admin/analytics', label: 'analytics', icon: ChartColumn, end: false },
  { to: '/admin/events', label: 'events', icon: Activity, end: false },
  { to: '/admin/sessions', label: 'sessions', icon: Users, end: false },
];

const itemBase =
  'flex shrink-0 flex-col items-center gap-[5px] rounded-xl px-1.5 py-2.5 text-[10px] font-medium transition-colors duration-150 md:w-[60px] md:px-0';

/** Lime "FR" square used by the rail and the sign-in screen. */
export function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid shrink-0 place-items-center bg-signal font-mono font-bold text-ad-bg',
        size === 'lg' ? 'size-[34px] rounded-[10px] text-sm' : 'size-[38px] rounded-[11px] text-[13px]',
      )}
    >
      FR
    </span>
  );
}

function RailItem({ icon: Icon, label, compact = false }: { icon: LucideIcon; label: ReactNode; compact?: boolean }) {
  return (
    <>
      <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      {/* Secondary items show only the icon in the narrow top bar. */}
      <span className={compact ? 'sr-only md:not-sr-only' : undefined}>{label}</span>
    </>
  );
}

/**
 * 76px instrument rail (desktop) / top bar (narrow screens): logo, page links, and at the bottom the
 * language switch, a link that opens the public funnel plus "sign out" when the admin is signed in
 * with a token. On phones the page links take a second row of the top bar, so the language
 * switch never pushes them out of view.
 */
export function Sidebar({ onSignOut }: { onSignOut?: () => void }) {
  const t = useT();
  return (
    <aside className="z-30 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-ad-line bg-ad-root px-3 py-2 sm:flex-nowrap md:sticky md:top-0 md:h-dvh md:w-[76px] md:flex-col md:gap-2 md:border-r md:border-b-0 md:px-0 md:py-[18px]">
      <NavLink to="/admin" aria-label={t.nav.home} className="rounded-[11px] md:mb-3.5">
        <LogoMark />
      </NavLink>

      <nav
        aria-label={t.nav.sections}
        className="order-last flex min-w-0 basis-full gap-1 overflow-x-auto [scrollbar-width:none] sm:order-none sm:flex-1 sm:basis-auto md:flex-none md:flex-col md:gap-2 md:overflow-visible"
      >
        {NAV.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                itemBase,
                'min-w-[52px]',
                isActive ? 'bg-ad-chip text-ad-text' : 'text-ad-faint hover:bg-ad-chip/50 hover:text-ad-text-2',
              )
            }
          >
            <RailItem icon={icon} label={t.nav[label]} />
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 gap-1 sm:ml-0 md:mt-auto md:flex-col md:gap-2">
        <LanguageSwitcher tone="admin" size="sm" className="mr-1 self-center md:mr-0 md:mb-1.5" />
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className={clsx(itemBase, 'min-w-9 text-ad-faint hover:bg-ad-chip/50 hover:text-ad-text-2')}
        >
          <RailItem icon={ExternalLink} label={t.nav.funnel} compact />
        </a>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className={clsx(itemBase, 'min-w-9 text-ad-faint hover:bg-ad-chip/50 hover:text-bad-ink')}
          >
            <RailItem icon={LogOut} label={t.nav.signOut} compact />
          </button>
        )}
      </div>
    </aside>
  );
}
