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
    <aside className="w-64 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-r border-gray-200 dark:border-gray-700 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <img src={logoImg} alt="DevBox Pro" className="w-8 h-8" />
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            DevBox Pro
          </span>
        </div>
      </div>

      {/* New Project Button */}
      <div className="px-4 py-4">
        <NavLink
          to="/projects/new"
          onClick={(e) => handleNavClick(e, '/projects/new')}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Project
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={(e) => handleNavClick(e, item.href)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.name}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
        {/* Settings */}
        <NavLink
          to="/settings"
          onClick={(e) => handleNavClick(e, '/settings')}
          className={clsx(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            location.pathname === '/settings'
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
          )}
        >
          <Settings className="w-5 h-5" />
          Settings
        </NavLink>

        {/* Dark mode toggle */}
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50 transition-colors"
        >
          {darkMode ? (
            <>
              <Sun className="w-5 h-5" />
              Light Mode
            </>
          ) : (
            <>
              <Moon className="w-5 h-5" />
              Dark Mode
            </>
          )}
        </button>
      </div>

      {/* Version */}
      <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Version {APP_VERSION}
        </p>
      </div>
    </aside>
  );
}

export default Sidebar;
