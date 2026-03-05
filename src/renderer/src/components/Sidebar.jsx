import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Server,
  Database,
  FileText,
  Settings,
  Moon,
  Sun,
  Plus,
  Box,
  Download,
} from 'lucide-react';
import clsx from 'clsx';
import logoImg from '/logo.svg';
import { APP_VERSION } from '../../../shared/appConfig';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Services', href: '/services', icon: Server },
  { name: 'Databases', href: '/databases', icon: Database },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Binaries', href: '/binaries', icon: Download },
];

function Sidebar({ darkMode, setDarkMode }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Prevent Ctrl+click from opening new tab - handle navigation programmatically
  const handleNavClick = (e, href) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      navigate(href);
    }
  };

  return (
    <aside className="w-64 bg-white/60 dark:bg-gray-900/50 backdrop-blur-2xl border-r border-white/20 dark:border-white/5 flex flex-col shadow-xl z-50">
      {/* Logo */}
      <div className="h-20 flex items-center px-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 p-1.5 shadow-lg shadow-primary-500/30 flex items-center justify-center">
            <img src={logoImg} alt="DevBox Pro" className="w-full h-full drop-shadow-md brightness-0 invert" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 tracking-tight">
            DevBox Pro
          </span>
        </div>
      </div>

      {/* New Project Button */}
      <div className="px-4 py-2 mb-2">
        <NavLink
          to="/projects/new"
          onClick={(e) => handleNavClick(e, '/projects/new')}
          className="btn-primary w-full flex items-center justify-center gap-2 shadow-[0_4px_14px_0_rgb(14,165,233,0.39)] hover:shadow-[0_6px_20px_rgba(14,165,233,0.23)] hover:-translate-y-[1px]"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          New Project
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1.5 overflow-y-auto scrollbar-thin">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={(e) => handleNavClick(e, item.href)}
              className={clsx(
                'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 relative overflow-hidden',
                isActive
                  ? 'text-primary-700 dark:text-primary-300 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-800/50'
              )}
            >
              {/* Active Indicator Background */}
              {isActive && (
                <div className="absolute inset-0 bg-gradient-to-r from-primary-500/10 to-primary-500/5 dark:from-primary-500/20 dark:to-primary-500/10 border border-primary-500/20 dark:border-primary-500/10 rounded-xl" />
              )}
              {/* Active indicator glowing line */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-500 rounded-r-full shadow-[0_0_10px_rgba(14,165,233,0.8)]" />
              )}

              <item.icon className={clsx("w-5 h-5 relative z-10 transition-transform duration-300", isActive ? "scale-110" : "group-hover:scale-110")} />
              <span className="relative z-10">{item.name}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-4 space-y-1.5">
        <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent mb-4" />

        {/* Settings */}
        <NavLink
          to="/settings"
          onClick={(e) => handleNavClick(e, '/settings')}
          className={clsx(
            'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 relative overflow-hidden',
            location.pathname === '/settings'
              ? 'text-primary-700 dark:text-primary-300 shadow-sm'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-800/50'
          )}
        >
          {location.pathname === '/settings' && (
            <div className="absolute inset-0 bg-gradient-to-r from-primary-500/10 to-primary-500/5 dark:from-primary-500/20 dark:to-primary-500/10 border border-primary-500/20 dark:border-primary-500/10 rounded-xl" />
          )}
          {location.pathname === '/settings' && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary-500 rounded-r-full shadow-[0_0_10px_rgba(14,165,233,0.8)]" />
          )}
          <Settings className={clsx("w-5 h-5 relative z-10 transition-transform duration-300", location.pathname === '/settings' ? "scale-110 rotate-90" : "group-hover:rotate-90")} />
          <span className="relative z-10">Settings</span>
        </NavLink>

        {/* Dark mode toggle */}
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-800/50 transition-all duration-300"
        >
          {darkMode ? (
            <>
              <Sun className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90 text-yellow-500" />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-5 h-5 transition-transform duration-300 group-hover:-rotate-12 text-slate-700" />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </div>

      {/* Version */}
      <div className="px-6 py-4 text-center">
        <p className="text-[11px] font-medium tracking-wider uppercase text-gray-400 dark:text-gray-500/80">
          DevBox Pro v{APP_VERSION}
        </p>
      </div>
    </aside>
  );
}

export default Sidebar;
