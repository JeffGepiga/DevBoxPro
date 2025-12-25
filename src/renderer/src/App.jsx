import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { RefreshCw, CheckCircle, AlertCircle, X, Database } from 'lucide-react';
import clsx from 'clsx';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Services from './pages/Services';
import Databases from './pages/Databases';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import CreateProject from './pages/CreateProject';
import BinaryManager from './pages/BinaryManager';
import { AppProvider, useApp } from './context/AppContext';
import { ModalProvider } from './context/ModalContext';

// Global database operation notification component
function GlobalDatabaseNotification() {
  const { databaseOperation, clearDatabaseOperation } = useApp();
  const location = useLocation();

  // Don't show on Databases page - it has its own notification
  if (location.pathname === '/databases' || !databaseOperation) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className={clsx(
        'rounded-lg shadow-lg p-4 border-2 flex items-center gap-3',
        databaseOperation.status === 'error'
          ? 'border-red-400 bg-red-50 dark:bg-red-900/90'
          : databaseOperation.status === 'complete'
            ? 'border-green-400 bg-green-50 dark:bg-green-900/90'
            : 'border-blue-400 bg-blue-50 dark:bg-blue-900/90'
      )}>
        <div className="flex-shrink-0">
          {databaseOperation.status === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : databaseOperation.status === 'complete' ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-gray-500" />
            <p className="font-medium text-gray-900 dark:text-white text-sm">
              {databaseOperation.type === 'export' ? 'Exporting' : 'Importing'} {databaseOperation.dbName}
            </p>
          </div>
          <p className={clsx(
            'text-xs truncate',
            databaseOperation.status === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400'
          )}>
            {databaseOperation.message}
          </p>
        </div>
        {(databaseOperation.status === 'complete' || databaseOperation.status === 'error') && (
          <button
            onClick={clearDatabaseOperation}
            className="flex-shrink-0 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>
    </div>
  );
}

function AppContent({ darkMode, setDarkMode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar darkMode={darkMode} setDarkMode={setDarkMode} />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/services" element={<Services />} />
          <Route path="/databases" element={<Databases />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/binaries" element={<BinaryManager />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <GlobalDatabaseNotification />
    </div>
  );
}

function App() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // Load saved theme setting first
    const loadTheme = async () => {
      try {
        const settings = await window.devbox?.settings.getAll();
        const savedTheme = settings?.settings?.theme || 'system';
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedTheme === 'dark') {
          setDarkMode(true);
        } else if (savedTheme === 'light') {
          setDarkMode(false);
        } else {
          // System preference
          setDarkMode(prefersDark);
        }
      } catch (error) {
        // Fallback to system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setDarkMode(prefersDark);
      }
    };

    loadTheme();

    // Listen for system preference changes (only applies when theme is 'system')
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = async (e) => {
      try {
        const settings = await window.devbox?.settings.getAll();
        if (settings?.settings?.theme === 'system') {
          setDarkMode(e.matches);
        }
      } catch {
        setDarkMode(e.matches);
      }
    };
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <AppProvider>
      <ModalProvider>
        <AppContent darkMode={darkMode} setDarkMode={setDarkMode} />
      </ModalProvider>
    </AppProvider>
  );
}

export default App;
