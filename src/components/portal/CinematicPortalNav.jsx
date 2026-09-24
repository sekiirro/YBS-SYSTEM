import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Forms', path: '/portal/forms', aliases: ['/portal/assessments'] },
  { label: 'Nutrition', path: '/portal/nutrition', aliases: [] },
  { label: 'Workout', path: '/portal/exercise', aliases: ['/portal/workout'] },
  { label: 'Progress', path: '/portal/metrics', aliases: ['/portal/progress'] },
];

export default function CinematicPortalNav({ workspaceName, initials, displayName, onSignOut, warmActive = false }) {
  const location = useLocation();
  return <header className={cn('ybs-cine__nav', warmActive && 'ybs-cine__nav--warm')}>
    <div className="ybs-cine__nav-row">
      <Link to="/portal/dashboard" className="ybs-cine__brand" aria-label="YBS home">YBS <small>{workspaceName || 'Coaching'}</small></Link>
      <nav className="ybs-cine__links" aria-label="Client portal">
        {NAV_LINKS.map((item) => { const active = location.pathname === item.path || item.aliases.includes(location.pathname); return <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} className="ybs-cine__link">{item.label}</Link>; })}
      </nav>
      <div className="ybs-cine__nav-actions">
        <Link to="/portal/notifications" aria-label="Notifications" className="ybs-cine__iconbtn ybs-cine__iconbtn--bell"><Bell aria-hidden="true" /></Link>
        <Link to="/portal/profile" aria-label={`Profile for ${displayName}`} className="ybs-cine__profile"><span className="ybs-cine__avatar">{initials}</span><span className="ybs-cine__profile-copy"><strong>{displayName?.split(' ').filter(Boolean).slice(0, 2).join(' ') || 'Athlete'}</strong><small>Client</small></span></Link>
        <button type="button" onClick={onSignOut} className="ybs-cine__iconbtn" title="Sign out" aria-label="Sign out"><LogOut aria-hidden="true" /></button>
      </div>
    </div>
  </header>;
}
