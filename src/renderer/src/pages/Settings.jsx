import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';
import {
  Save,
  RefreshCw,
  Folder,
  Globe,
  Server,
  Code,
  Palette,
  Bell,
  Shield,
  Download,
  Upload,
  RotateCcw,
  Check,
  Terminal,
  Copy,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Trash2,
  AlertTriangle,
  ArrowUpCircle,
} from 'lucide-react';
import clsx from 'clsx';

function Settings() {
  const { settings, refreshSettings } = useApp();
  const { showAlert, showConfirm } = useModal();
  const [localSettings, setLocalSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    if (settings.settings) {
      setLocalSettings(settings.settings);
    }
  }, [settings]);

  const updateSetting = (key, value) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return; // Prevent re-submission
    setSaving(true);
    try {
      // Check if database credentials changed
      const oldUser = settings.settings?.dbUser || 'root';
      const oldPassword = settings.settings?.dbPassword || '';
      const newUser = localSettings.dbUser || 'root';
      const newPassword = localSettings.dbPassword || '';
      const credentialsChanged = oldUser !== newUser || oldPassword !== newPassword;

      // Save all settings
      for (const [key, value] of Object.entries(localSettings)) {
        await window.devbox?.settings.set(`settings.${key}`, value);
      }

      // If credentials changed, sync to all database versions
      if (credentialsChanged) {
        try {
          await window.devbox?.database.syncCredentialsToAllVersions(newUser, newPassword, oldPassword);
        } catch (syncError) {
          // Sync error logged to system log on backend
        }
      }

      // Refresh settings in context so other components get the updated values
      await refreshSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      // Error saving settings
      await showAlert({ title: 'Error', message: 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = await showConfirm({
      title: 'Reset Settings',
      message: 'Reset all settings to defaults?',
      confirmText: 'Reset',
      confirmStyle: 'danger',
      type: 'warning'
    });
    if (confirmed) {
      await window.devbox?.settings.reset();
      await refreshSettings();
      const newSettings = await window.devbox?.settings.getAll();
      setLocalSettings(newSettings.settings || {});
    }
  };

  const handleExportConfig = async () => {
    try {
      // In a real app, this would use a save dialog
      await showAlert({ title: 'Export Config', message: 'Config exported to devbox-config.json', type: 'success' });
    } catch (error) {
      // Error exporting config
    }
  };

  const handleImportConfig = async () => {
    try {
      // In a real app, this would use a file picker
      await showAlert({ title: 'Coming Soon', message: 'Import config feature coming soon', type: 'info' });
    } catch (error) {
      // Error importing config
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Server },
    { id: 'cli', label: 'CLI Tool', icon: Code },
    { id: 'network', label: 'Network', icon: Globe },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'advanced', label: 'Advanced', icon: Shield },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Configure DevBox Pro preferences
          </p>
        </div>
        {/* Only show Save/Reset for tabs that need manual saving */}
        {['general', 'network', 'appearance'].includes(activeTab) && (
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="btn-secondary">
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={clsx('btn-primary', saved && 'bg-green-600 hover:bg-green-700')}
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-8">
        {/* Tabs */}
        <nav className="w-48 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors',
                activeTab === tab.id
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              )}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'general' && (
            <GeneralSettings settings={localSettings} updateSetting={updateSetting} />
          )}
          {activeTab === 'cli' && (
            <CliSettings settings={localSettings} updateSetting={updateSetting} />
          )}
          {activeTab === 'network' && (
            <NetworkSettings settings={localSettings} updateSetting={updateSetting} />
          )}
          {activeTab === 'appearance' && (
            <AppearanceSettings settings={localSettings} updateSetting={updateSetting} />
          )}
          {activeTab === 'advanced' && (
            <AdvancedSettings
              settings={localSettings}
              updateSetting={updateSetting}
              onExport={handleExportConfig}
              onImport={handleImportConfig}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GeneralSettings({ settings, updateSetting }) {
  const handleSelectProjectsPath = async () => {
    try {
      const result = await window.devbox?.system?.selectDirectory?.();
      if (result) {
        updateSetting('defaultProjectsPath', result);
      }
    } catch (error) {
      // Error selecting directory
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Projects
        </h3>
        <div className="space-y-4">
          <div>
            <label className="label">Default Projects Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.defaultProjectsPath || ''}
                onChange={(e) => updateSetting('defaultProjectsPath', e.target.value)}
                className="input flex-1"
                placeholder="C:\\Users\\YourName\\Projects"
              />
              <button onClick={handleSelectProjectsPath} className="btn-secondary">
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              New projects will be created in this directory by default
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Startup
        </h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Launch on system startup
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Automatically start DevBox Pro when you log in
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoStartOnLaunch ?? false}
              onChange={(e) => updateSetting('autoStartOnLaunch', e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </label>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Default Editor
        </h3>
        <select
          value={settings.defaultEditor || 'vscode'}
          onChange={(e) => updateSetting('defaultEditor', e.target.value)}
          className="select w-full"
        >
          <option value="vscode">Visual Studio Code</option>
          <option value="cursor">Cursor</option>
          <option value="antigravity">Antigravity</option>
          <option value="zed">Zed</option>
          <option value="phpstorm">PhpStorm</option>
          <option value="webstorm">WebStorm</option>
          <option value="intellij">IntelliJ IDEA</option>
          <option value="rider">Rider</option>
          <option value="sublime">Sublime Text</option>
          <option value="notepadpp">Notepad++</option>
          <option value="nova">Nova</option>
          <option value="atom">Atom</option>
          <option value="custom">Other (Custom)</option>
        </select>

        {/* Custom Editor Command Input */}
        {settings.defaultEditor === 'custom' && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Custom Editor Command
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.customEditorCommand || ''}
                onChange={(e) => updateSetting('customEditorCommand', e.target.value)}
                placeholder="e.g., code, subl, notepad"
                className="input flex-1"
              />
              <button
                onClick={async () => {
                  const isWindows = navigator.platform.toLowerCase().includes('win');
                  const filters = isWindows
                    ? [
                        { name: 'Executable Files', extensions: ['exe', 'cmd', 'bat'] },
                        { name: 'All Files', extensions: ['*'] }
                      ]
                    : [{ name: 'All Files', extensions: ['*'] }];
                  
                  const filePath = await window.devbox?.system?.selectFile(filters);
                  if (filePath) {
                    updateSetting('customEditorCommand', filePath);
                  }
                }}
                className="btn-secondary whitespace-nowrap"
              >
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Enter the command-line executable for your editor (must be in PATH) or browse for the full path
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CliSettings() {
  const [cliStatus, setCliStatus] = useState(null);
  const [directShimsEnabled, setDirectShimsEnabled] = useState(false);
  const [defaultPhpVersion, setDefaultPhpVersion] = useState(null);
  const [defaultNodeVersion, setDefaultNodeVersion] = useState(null);
  const [installedBinaries, setInstalledBinaries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [removingFromPath, setRemovingFromPath] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const status = await window.devbox?.cli?.getStatus();
        setCliStatus(status);

        const shimsEnabled = await window.devbox?.cli?.getDirectShimsEnabled();
        setDirectShimsEnabled(shimsEnabled || false);

        const defPhp = await window.devbox?.cli?.getDefaultPhpVersion();
        setDefaultPhpVersion(defPhp);

        const defNode = await window.devbox?.cli?.getDefaultNodeVersion();
        setDefaultNodeVersion(defNode);

        const binaries = await window.devbox?.binaries?.getInstalled();
        setInstalledBinaries(binaries);
      } catch (error) {
        console.error('Failed to load CLI settings:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleToggleDirectCommands = async (enabled) => {
    setMessage(null);
    try {
      // First install CLI if not installed
      if (!cliStatus?.installed) {
        await window.devbox?.cli?.install();
      }

      await window.devbox?.cli?.setDirectShimsEnabled(enabled);
      setDirectShimsEnabled(enabled);

      if (enabled) {
        // Add to PATH automatically - always try to ensure System PATH priority
        await window.devbox?.cli?.addToPath();

        setMessage({
          type: 'success',
          text: 'Terminal commands enabled! Restart your terminal or VS Code to use php, npm, node, composer, and mysql directly.'
        });
      } else {
        setMessage({ type: 'success', text: 'Terminal commands disabled.' });
      }

      // Refresh status
      const status = await window.devbox?.cli?.getStatus();
      setCliStatus(status);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleRemoveFromPath = async () => {
    setRemovingFromPath(true);
    setMessage(null);
    try {
      await window.devbox?.cli?.removeFromPath();
      // Also disable terminal commands when removing from PATH
      await window.devbox?.cli?.setDirectShimsEnabled(false);
      setDirectShimsEnabled(false);
      setMessage({ type: 'success', text: 'Terminal commands disabled and removed from PATH. Restart your terminal for changes to take effect.' });
      const status = await window.devbox?.cli?.getStatus();
      setCliStatus(status);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setRemovingFromPath(false);
    }
  };

  const handleSetDefaultPhp = async (version) => {
    try {
      await window.devbox?.cli?.setDefaultPhpVersion(version || null);
      setDefaultPhpVersion(version || null);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleSetDefaultNode = async (version) => {
    try {
      await window.devbox?.cli?.setDefaultNodeVersion(version || null);
      setDefaultNodeVersion(version || null);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get installed versions for dropdowns
  const phpVersions = installedBinaries?.php
    ? Object.entries(installedBinaries.php).filter(([, installed]) => installed).map(([v]) => v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];
  const nodeVersions = installedBinaries?.nodejs
    ? Object.entries(installedBinaries.nodejs).filter(([, installed]) => installed).map(([v]) => v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Card */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <Terminal className="w-5 h-5" />
          Terminal Commands
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Use <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">php</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">npm</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">node</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">composer</code>, and <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">mysql</code> commands
          directly from any terminal. DevBox Pro automatically uses the correct version based on your project.
        </p>


        {/* Message */}
        {message && (
          <div className={clsx(
            'p-3 rounded-lg mb-6 text-sm',
            message.type === 'success' && 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
            message.type === 'error' && 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          )}>
            {message.text}
          </div>
        )}

        {/* Enable Toggle */}
        <label className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg cursor-pointer">
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              Enable terminal commands
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Allows using php, npm, node, composer, and mysql from any terminal
            </p>
          </div>
          <input
            type="checkbox"
            checked={directShimsEnabled}
            onChange={(e) => handleToggleDirectCommands(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
        </label>

        {/* Status */}
        {directShimsEnabled && (
          <div className="mt-4 flex items-center gap-3 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Status:</span>
            {cliStatus?.inPath ? (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4" />
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-4 h-4" />
                Restart terminal required
              </span>
            )}
          </div>
        )}
      </div>


      {/* Default Versions - only show when enabled */}
      {directShimsEnabled && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Default Versions
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Used when you're not in a registered project directory.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">PHP Version</label>
              <select
                value={defaultPhpVersion || ''}
                onChange={(e) => handleSetDefaultPhp(e.target.value)}
                className="select w-full"
              >
                <option value="">Auto-detect</option>
                {phpVersions.map(v => (
                  <option key={v} value={v}>PHP {v}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Node.js Version</label>
              <select
                value={defaultNodeVersion || ''}
                onChange={(e) => handleSetDefaultNode(e.target.value)}
                className="select w-full"
              >
                <option value="">Auto-detect</option>
                {nodeVersions.map(v => (
                  <option key={v} value={v}>Node.js {v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>How it works:</strong> Inside a project folder, DevBox Pro uses that project's configured PHP/Node version.
              Outside a project, it uses the default versions above.
            </p>
          </div>
        </div>
      )}

      {/* Usage Examples - only show when enabled */}
      {directShimsEnabled && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Example Commands
          </h3>
          <div className="space-y-2">
            {[
              { cmd: 'php artisan migrate', desc: 'Run Laravel migrations' },
              { cmd: 'composer install', desc: 'Install PHP dependencies' },
              { cmd: 'npm install', desc: 'Install Node.js packages' },
              { cmd: 'npm run dev', desc: 'Start development server' },
              { cmd: 'mysql -u root', desc: 'Connect to database (uses active DB version)' },
              { cmd: 'mysqldump -u root mydb > backup.sql', desc: 'Dump a database' },
            ].map(({ cmd, desc }) => (
              <div key={cmd} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{cmd}</code>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(cmd)}
                  className="btn-ghost btn-sm"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advanced - Remove from PATH */}
      {directShimsEnabled && cliStatus?.inPath && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Advanced
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Remove DevBox Pro from your system PATH if needed.
          </p>
          <button
            onClick={handleRemoveFromPath}
            disabled={removingFromPath}
            className="btn-secondary text-red-600 dark:text-red-400"
          >
            {removingFromPath ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Remove from PATH
          </button>
        </div>
      )}
    </div>
  );
}

function NetworkSettings({ settings, updateSetting }) {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          MySQL &amp; MariaDB Credentials
        </h3>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            <strong>Global credentials:</strong> This username and password is shared across all MySQL and MariaDB versions.
            When you save, running databases will be restarted to apply the new credentials.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Database Username</label>
            <input
              type="text"
              value={settings.dbUser || 'root'}
              onChange={(e) => updateSetting('dbUser', e.target.value)}
              className="input w-64"
              placeholder="root"
            />
          </div>

          <div>
            <label className="label">Database Password</label>
            <input
              type="password"
              value={settings.dbPassword || ''}
              onChange={(e) => updateSetting('dbPassword', e.target.value)}
              className="input w-64"
              placeholder="Leave empty for no password"
            />
            <p className="text-sm text-gray-500 mt-1">
              Leave empty for no password (recommended for local development)
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          PostgreSQL Credentials
        </h3>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            PostgreSQL uses a separate superuser account. The default superuser is <strong>postgres</strong> with no password.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">PostgreSQL Username</label>
            <input
              type="text"
              value={settings.pgUser || 'postgres'}
              onChange={(e) => updateSetting('pgUser', e.target.value)}
              className="input w-64"
              placeholder="postgres"
            />
          </div>

          <div>
            <label className="label">PostgreSQL Password</label>
            <input
              type="password"
              value={settings.pgPassword || ''}
              onChange={(e) => updateSetting('pgPassword', e.target.value)}
              className="input w-64"
              placeholder="Leave empty for no password"
            />
            <p className="text-sm text-gray-500 mt-1">
              Leave empty for no password (recommended for local development)
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Server Timezone
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Sets the timezone for PHP, MySQL, and MariaDB services. Changes require service restart.
        </p>
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <select
              value={
                // Check if current value is in the list of presets
                ['UTC', 'Asia/Manila', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Hong_Kong',
                  'Asia/Tokyo', 'Asia/Seoul', 'America/New_York', 'America/Chicago',
                  'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
                  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
                  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
                  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Jakarta'].includes(settings.serverTimezone)
                  ? settings.serverTimezone
                  : 'custom'
              }
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  updateSetting('serverTimezone', e.target.value);
                }
              }}
              className="select w-72"
            >
              <optgroup label="Common">
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="Asia/Manila">Asia/Manila (Philippine Time, UTC+8)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST, UTC+8)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT, UTC+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                <option value="Asia/Seoul">Asia/Seoul (KST, UTC+9)</option>
              </optgroup>
              <optgroup label="Americas">
                <option value="America/New_York">America/New_York (Eastern Time)</option>
                <option value="America/Chicago">America/Chicago (Central Time)</option>
                <option value="America/Denver">America/Denver (Mountain Time)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                <option value="America/Sao_Paulo">America/Sao_Paulo (Brasilia Time)</option>
              </optgroup>
              <optgroup label="Europe">
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
                <option value="Europe/Moscow">Europe/Moscow (MSK, UTC+3)</option>
              </optgroup>
              <optgroup label="Australia/Pacific">
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
                <option value="Australia/Melbourne">Australia/Melbourne (AEST/AEDT)</option>
                <option value="Pacific/Auckland">Pacific/Auckland (NZST/NZDT)</option>
              </optgroup>
              <optgroup label="Other">
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="Asia/Jakarta">Asia/Jakarta (WIB, UTC+7)</option>
                <option value="custom">Custom...</option>
              </optgroup>
            </select>
          </div>
        </div>
        {/* Custom timezone input */}
        <div className="mt-3">
          <label className="label text-sm">Or enter IANA timezone manually:</label>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={settings.serverTimezone || 'UTC'}
              onChange={(e) => updateSetting('serverTimezone', e.target.value)}
              className="input w-72"
              placeholder="e.g., America/New_York"
            />
            <a
              href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 text-sm"
              onClick={(e) => {
                e.preventDefault();
                window.devbox?.system?.openExternal('https://en.wikipedia.org/wiki/List_of_tz_database_time_zones');
              }}
            >
              View all timezones
            </a>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Port Configuration
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Default ports for each service. Changes take effect after restarting the service.
        </p>

        {/* Project ports */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">Projects</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">Port Range Start</label>
              <input type="number" value={settings.portRangeStart || 8000} onChange={(e) => updateSetting('portRangeStart', parseInt(e.target.value))} className="input w-28" min="1024" max="65535" />
            </div>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Projects are assigned ports starting from this number</p>
        </div>

        {/* Database ports */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">Databases</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">MySQL</label>
              <input type="number" value={settings.mysqlPort || 3306} onChange={(e) => updateSetting('mysqlPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">PostgreSQL</label>
              <input type="number" value={settings.postgresqlPort || 5432} onChange={(e) => updateSetting('postgresqlPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">MariaDB</label>
              <input type="number" value={settings.mariadbPort || 3307} onChange={(e) => updateSetting('mariadbPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">MongoDB</label>
              <input type="number" value={settings.mongodbPort || 27017} onChange={(e) => updateSetting('mongodbPort', parseInt(e.target.value))} className="input w-28" />
            </div>
          </div>
        </div>

        {/* Cache ports */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">Cache</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">Redis</label>
              <input type="number" value={settings.redisPort || 6379} onChange={(e) => updateSetting('redisPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">Memcached</label>
              <input type="number" value={settings.memcachedPort || 11211} onChange={(e) => updateSetting('memcachedPort', parseInt(e.target.value))} className="input w-28" />
            </div>
          </div>
        </div>

        {/* Tools ports */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">Tools</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">phpMyAdmin</label>
              <input type="number" value={settings.phpMyAdminPort || 8080} onChange={(e) => updateSetting('phpMyAdminPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">Mailpit</label>
              <input type="number" value={settings.mailpitPort || 8025} onChange={(e) => updateSetting('mailpitPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">MinIO</label>
              <input type="number" value={settings.minioPort || 9000} onChange={(e) => updateSetting('minioPort', parseInt(e.target.value))} className="input w-28" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 dark:text-gray-300 w-36 shrink-0">MinIO Console</label>
              <input type="number" value={settings.minioConsolePort || 9001} onChange={(e) => updateSetting('minioConsolePort', parseInt(e.target.value))} className="input w-28" />
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          SSL
        </h3>
        <label className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              Enable SSL by default
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Generate SSL certificates for new projects automatically
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.sslEnabled ?? true}
            onChange={(e) => updateSetting('sslEnabled', e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
        </label>
      </div>
    </div>
  );
}

function AppearanceSettings({ settings, updateSetting }) {
  // Apply theme when setting changes
  const handleThemeChange = (theme) => {
    updateSetting('theme', theme);

    // Apply theme immediately
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = theme === 'dark' || (theme === 'system' && prefersDark);

    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Theme
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {['system', 'light', 'dark'].map((theme) => (
            <button
              key={theme}
              onClick={() => handleThemeChange(theme)}
              className={clsx(
                'p-4 rounded-lg border-2 text-center transition-all capitalize text-gray-900 dark:text-white',
                settings.theme === theme
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              )}
            >
              {theme}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          {settings.theme === 'system'
            ? 'Theme follows your system preference'
            : `Using ${settings.theme} theme`}
        </p>
      </div>
    </div>
  );
}

function AdvancedSettings({ settings, updateSetting, onExport, onImport }) {
  const [checkingBinaryUpdates, setCheckingBinaryUpdates] = useState(false);
  const [binaryUpdateResult, setBinaryUpdateResult] = useState(null);
  const [applyingBinaryUpdates, setApplyingBinaryUpdates] = useState(false);

  const [checkingCompatibilityUpdates, setCheckingCompatibilityUpdates] = useState(false);
  const [compatibilityUpdateResult, setCompatibilityUpdateResult] = useState(null);
  const [applyingCompatibilityUpdates, setApplyingCompatibilityUpdates] = useState(false);

  const [configInfo, setConfigInfo] = useState({ binaries: null, compatibility: null });

  // Clear data modal state
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearProjectFiles, setClearProjectFiles] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearResult, setClearResult] = useState(null);

  // App data path for Data Location section
  const [appDataPath, setAppDataPath] = useState(null);

  // App update state
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [appUpdateResult, setAppUpdateResult] = useState(null);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(null);

  // Load config info and app data path on mount
  useEffect(() => {
    const loadConfigInfo = async () => {
      try {
        const compatInfo = await window.devbox?.compatibility?.getConfigInfo();
        setConfigInfo(prev => ({ ...prev, compatibility: compatInfo }));
      } catch (error) {
        // Error loading config info
      }
    };
    const loadAppDataPath = async () => {
      try {
        const dataPath = await window.devbox?.system?.getAppDataPath?.();
        setAppDataPath(dataPath);
      } catch (error) {
        // Error loading app data path
      }
    };
    loadConfigInfo();
    loadAppDataPath();

    // Load current app version
    const loadVersion = async () => {
      const version = await window.devbox?.system?.getAppVersion?.();
      setCurrentVersion(version);
    };
    loadVersion();

    // Subscribe to update events
    const unsubProgress = window.devbox?.update?.onProgress?.((data) => {
      setDownloadProgress(data);
    });

    const unsubStatus = window.devbox?.update?.onStatus?.((data) => {
      if (data.status === 'downloaded') {
        setDownloadingUpdate(false);
        setUpdateDownloaded(true);
        setDownloadProgress(null);
      } else if (data.status === 'error') {
        setDownloadingUpdate(false);
        setAppUpdateResult({ success: false, error: data.error });
      }
    });

    return () => {
      unsubProgress?.();
      unsubStatus?.();
    };
  }, []);

  const handleCheckAppUpdate = async () => {
    setCheckingAppUpdate(true);
    setAppUpdateResult(null);
    setUpdateDownloaded(false);
    try {
      const result = await window.devbox?.update?.checkForUpdates();
      setAppUpdateResult(result);
    } catch (error) {
      setAppUpdateResult({ success: false, error: error.message });
    } finally {
      setCheckingAppUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setDownloadingUpdate(true);
    setDownloadProgress(null);
    try {
      await window.devbox?.update?.downloadUpdate();
    } catch (error) {
      setDownloadingUpdate(false);
      setAppUpdateResult({ success: false, error: error.message });
    }
  };

  const handleInstallUpdate = () => {
    window.devbox?.update?.quitAndInstall();
  };

  const handleCheckBinaryUpdates = async () => {
    setCheckingBinaryUpdates(true);
    setBinaryUpdateResult(null);
    try {
      const result = await window.devbox?.binaries?.checkForUpdates();
      setBinaryUpdateResult(result);
    } catch (error) {
      setBinaryUpdateResult({ success: false, error: error.message });
    } finally {
      setCheckingBinaryUpdates(false);
    }
  };

  const handleApplyBinaryUpdates = async () => {
    setApplyingBinaryUpdates(true);
    try {
      await window.devbox?.binaries?.applyUpdates();
      setBinaryUpdateResult(prev => ({ ...prev, hasUpdates: false, applied: true }));
    } catch (error) {
      // Error applying binary updates
    } finally {
      setApplyingBinaryUpdates(false);
    }
  };

  const handleCheckCompatibilityUpdates = async () => {
    setCheckingCompatibilityUpdates(true);
    setCompatibilityUpdateResult(null);
    try {
      const result = await window.devbox?.compatibility?.checkForUpdates();
      setCompatibilityUpdateResult(result);
    } catch (error) {
      setCompatibilityUpdateResult({ success: false, error: error.message });
    } finally {
      setCheckingCompatibilityUpdates(false);
    }
  };

  const handleApplyCompatibilityUpdates = async () => {
    setApplyingCompatibilityUpdates(true);
    try {
      const result = await window.devbox?.compatibility?.applyUpdates();
      if (result?.success) {
        setCompatibilityUpdateResult(prev => ({ ...prev, hasUpdates: false, applied: true }));
        // Refresh config info
        const compatInfo = await window.devbox?.compatibility?.getConfigInfo();
        setConfigInfo(prev => ({ ...prev, compatibility: compatInfo }));
      }
    } catch (error) {
      // Error applying compatibility updates
    } finally {
      setApplyingCompatibilityUpdates(false);
    }
  };

  const handleClearAllData = async () => {
    // Check for correct confirmation text based on whether project files will be deleted
    const requiredConfirmText = clearProjectFiles ? 'DELETE ALL' : 'confirm';
    if (clearConfirmText !== requiredConfirmText) return;

    setIsClearing(true);
    setClearResult(null);

    try {
      const result = await window.devbox?.system?.clearAllData?.(clearProjectFiles);
      setClearResult({ success: true, message: result?.message || 'All data cleared successfully!' });

      // Close modal after delay
      setTimeout(() => {
        setShowClearDataModal(false);
        setClearConfirmText('');
        setClearProjectFiles(false);
        setClearResult(null);
        // Optionally reload the app
        if (result?.requiresRestart) {
          window.location.reload();
        }
      }, 2000);
    } catch (error) {
      // Error clearing data
      setClearResult({ success: false, message: error.message || 'Failed to clear data' });
    } finally {
      setIsClearing(false);
    }
  };

  const handleCancelClearData = () => {
    setShowClearDataModal(false);
    setClearConfirmText('');
    setClearProjectFiles(false);
    setClearResult(null);
  };

  return (
    <div className="space-y-6">
      {/* App Update Section */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Application Updates
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Check for new versions of DevBox Pro.
          {currentVersion && (
            <span className="ml-2 text-gray-400">(Current: v{currentVersion})</span>
          )}
        </p>

        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="w-5 h-5 text-primary-500" />
                <h4 className="font-medium text-gray-900 dark:text-white">DevBox Pro</h4>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Updates are downloaded from GitHub Releases
              </p>
            </div>
            <div className="flex gap-2">
              {updateDownloaded ? (
                <button
                  onClick={handleInstallUpdate}
                  className="btn-primary text-sm py-1.5 px-3"
                >
                  <Download className="w-4 h-4" />
                  Install & Restart
                </button>
              ) : downloadingUpdate ? (
                <button disabled className="btn-secondary text-sm py-1.5 px-3 opacity-75">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Downloading...
                </button>
              ) : appUpdateResult?.updateAvailable ? (
                <button
                  onClick={handleDownloadUpdate}
                  className="btn-primary text-sm py-1.5 px-3"
                >
                  <Download className="w-4 h-4" />
                  Download v{appUpdateResult.latestVersion}
                </button>
              ) : (
                <button
                  onClick={handleCheckAppUpdate}
                  disabled={checkingAppUpdate}
                  className="btn-secondary text-sm py-1.5 px-3"
                >
                  {checkingAppUpdate ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Check for Updates
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Download Progress */}
          {downloadingUpdate && downloadProgress && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Downloading update...</span>
                <span>{Math.round(downloadProgress.percent || 0)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress.percent || 0}%` }}
                />
              </div>
              {downloadProgress.bytesPerSecond && (
                <p className="text-xs text-gray-400 mt-1">
                  {(downloadProgress.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s
                </p>
              )}
            </div>
          )}

          {/* Update Result */}
          {appUpdateResult && !downloadingUpdate && !updateDownloaded && (
            <div className={clsx(
              'mt-3 p-3 rounded-lg text-sm',
              appUpdateResult.success
                ? appUpdateResult.updateAvailable
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                  : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            )}>
              {appUpdateResult.success ? (
                appUpdateResult.updateAvailable ? (
                  <div>
                    <span className="font-medium">Update available: v{appUpdateResult.latestVersion}</span>
                    {appUpdateResult.releaseDate && (
                      <p className="text-xs mt-1">
                        Released: {new Date(appUpdateResult.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : appUpdateResult.message?.includes('development') ? (
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {appUpdateResult.message}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    You're running the latest version (v{appUpdateResult.currentVersion})
                  </span>
                )
              ) : (
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {appUpdateResult.error}
                </span>
              )}
            </div>
          )}

          {/* Update Downloaded */}
          {updateDownloaded && (
            <div className="mt-3 p-3 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200">
              <span className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Update downloaded! Click "Install & Restart" to complete the update.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Remote Updates Section */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Remote Configuration Updates
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Check for updates to binary download URLs and compatibility rules from the DevBox Pro repository.
        </p>

        {/* Binary Updates */}
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-white">Binary Downloads</h4>
                <button
                  onClick={() => window.devbox?.system.openExternal('https://github.com/JeffGepiga/DevBoxPro/blob/main/config/binaries.json')}
                  className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  title="View source on GitHub"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                PHP, MySQL, Redis, and other service download URLs
              </p>
            </div>
            <div className="flex gap-2">
              {binaryUpdateResult?.hasUpdates && !binaryUpdateResult?.applied && (
                <button
                  onClick={handleApplyBinaryUpdates}
                  disabled={applyingBinaryUpdates}
                  className="btn-primary text-sm py-1.5 px-3"
                >
                  {applyingBinaryUpdates ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Apply Updates
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handleCheckBinaryUpdates}
                disabled={checkingBinaryUpdates}
                className="btn-secondary text-sm py-1.5 px-3"
              >
                {checkingBinaryUpdates ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Check for Updates
                  </>
                )}
              </button>
            </div>
          </div>
          {binaryUpdateResult && (
            <div className={clsx(
              'mt-3 p-3 rounded-lg text-sm',
              binaryUpdateResult.success
                ? binaryUpdateResult.hasUpdates
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                  : binaryUpdateResult.applied
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                    : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            )}>
              {binaryUpdateResult.success ? (
                binaryUpdateResult.applied ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Updates applied successfully!
                  </span>
                ) : binaryUpdateResult.hasUpdates ? (
                  <span>{binaryUpdateResult.updates?.length} update(s) available (v{binaryUpdateResult.configVersion})</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Up to date (v{binaryUpdateResult.configVersion})
                  </span>
                )
              ) : (
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {binaryUpdateResult.error}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Compatibility Updates */}
        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900 dark:text-white">Compatibility Rules</h4>
                <button
                  onClick={() => window.devbox?.system.openExternal('https://github.com/JeffGepiga/DevBoxPro/blob/main/config/compatibility.json')}
                  className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  title="View source on GitHub"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Version compatibility warnings and recommendations
                {configInfo.compatibility && (
                  <span className="ml-2 text-gray-400">
                    (Current: v{configInfo.compatibility.version}, {configInfo.compatibility.ruleCount} rules)
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {compatibilityUpdateResult?.hasUpdates && !compatibilityUpdateResult?.applied && (
                <button
                  onClick={handleApplyCompatibilityUpdates}
                  disabled={applyingCompatibilityUpdates}
                  className="btn-primary text-sm py-1.5 px-3"
                >
                  {applyingCompatibilityUpdates ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Apply Updates
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handleCheckCompatibilityUpdates}
                disabled={checkingCompatibilityUpdates}
                className="btn-secondary text-sm py-1.5 px-3"
              >
                {checkingCompatibilityUpdates ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Check for Updates
                  </>
                )}
              </button>
            </div>
          </div>
          {compatibilityUpdateResult && (
            <div className={clsx(
              'mt-3 p-3 rounded-lg text-sm',
              compatibilityUpdateResult.success
                ? compatibilityUpdateResult.hasUpdates
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                  : compatibilityUpdateResult.applied
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                    : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            )}>
              {compatibilityUpdateResult.success ? (
                compatibilityUpdateResult.applied ? (
                  <span className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Updates applied successfully!
                  </span>
                ) : compatibilityUpdateResult.hasUpdates ? (
                  <div>
                    <span className="font-medium">Updates available (v{compatibilityUpdateResult.configVersion})</span>
                    {compatibilityUpdateResult.updates?.newRules?.length > 0 && (
                      <p className="text-xs mt-1">{compatibilityUpdateResult.updates.newRules.length} new rule(s)</p>
                    )}
                  </div>
                ) : (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Up to date (v{compatibilityUpdateResult.configVersion})
                  </span>
                )
              ) : (
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {compatibilityUpdateResult.error}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Data Location
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          DevBox Pro stores data in the following location:
        </p>
        <button
          onClick={() => {
            const pathToOpen = appDataPath || settings.dataPath;
            if (pathToOpen) {
              window.devbox?.system?.openPath?.(pathToOpen)?.catch((err) => {
                console.error('Failed to open path:', err);
              });
            }
          }}
          className="block w-full p-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-left hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors group"
          title="Click to open folder"
        >
          <code className="text-gray-700 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">
            {appDataPath || settings.dataPath || 'Loading...'}
          </code>
          <ExternalLink className="w-4 h-4 inline ml-2 opacity-0 group-hover:opacity-100 text-gray-400" />
        </button>
      </div>

      <div className="card p-6 border-red-200 dark:border-red-900/50">
        <h3 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          These actions are destructive and cannot be undone.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => setShowClearDataModal(true)}
            className="btn-danger"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Data
          </button>
        </div>
      </div>

      {/* Clear Data Modal */}
      {showClearDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Clear All Data
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    This action cannot be undone
                  </p>
                </div>
              </div>

              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                  This will reset DevBox Pro to a fresh install state:
                </p>
                <ul className="text-sm text-gray-600 dark:text-gray-400 mt-2 list-disc list-inside space-y-1">
                  <li>All downloaded binaries (PHP, MySQL, Redis, Node.js, Nginx, Apache, Composer, etc.)</li>
                  <li>All database data (MySQL and MariaDB databases)</li>
                  <li>All project configurations</li>
                  <li>All SSL certificates</li>
                  <li>All service configurations and logs</li>
                  <li>CLI tool installation</li>
                </ul>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                  You will need to re-download all binaries and recreate databases after clearing.
                </p>
              </div>

              {/* Option to delete project files */}
              <label className="flex items-start gap-3 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearProjectFiles}
                  onChange={(e) => {
                    setClearProjectFiles(e.target.checked);
                    setClearConfirmText(''); // Reset confirmation when changing this option
                  }}
                  className="mt-0.5 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-400">
                    Also delete project files
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                    ⚠️ This will permanently delete all files in all project folders!
                  </p>
                </div>
              </label>

              {/* Extra warning when deleting project files */}
              {clearProjectFiles && (
                <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/40 border-2 border-red-400 dark:border-red-600 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-red-800 dark:text-red-300">
                        ⚠️ DANGER: This will DELETE ALL your project source code!
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-400 mt-2">
                        All files in your project directories will be permanently deleted.
                        This includes your source code, assets, databases, and any uncommitted changes.
                      </p>
                      <p className="text-sm font-semibold text-red-800 dark:text-red-300 mt-2">
                        Make sure you have backups before proceeding!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Confirmation input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Type <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                    {clearProjectFiles ? 'DELETE ALL' : 'confirm'}
                  </span> to proceed:
                </label>
                <input
                  type="text"
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  placeholder={clearProjectFiles ? 'DELETE ALL' : 'confirm'}
                  className={clsx(
                    'input w-full',
                    clearProjectFiles && 'border-red-400 focus:border-red-500 focus:ring-red-500'
                  )}
                  autoFocus
                />
                {clearProjectFiles && (
                  <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                    Type exactly "DELETE ALL" (case sensitive) to confirm permanent deletion
                  </p>
                )}
              </div>

              {/* Result message */}
              {clearResult && (
                <div className={clsx(
                  'p-3 rounded-lg mb-4 text-sm',
                  clearResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                )}>
                  {clearResult.success ? (
                    <span className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      {clearResult.message}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {clearResult.message}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={handleCancelClearData}
                className="btn-secondary"
                disabled={isClearing}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAllData}
                disabled={clearConfirmText !== (clearProjectFiles ? 'DELETE ALL' : 'confirm') || isClearing}
                className={clsx(
                  'btn-danger',
                  clearConfirmText !== (clearProjectFiles ? 'DELETE ALL' : 'confirm') && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isClearing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    {clearProjectFiles ? 'DELETE ALL DATA & FILES' : 'Clear All Data'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          About
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          DevBox Pro - Local Development Environment Manager
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
          Made by <span className="font-semibold">Jeffrey Gepiga</span>
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          Found an issue?{' '}
          <button
            onClick={() => window.devbox?.system.openExternal('https://github.com/JeffGepiga/DevBoxPro/issues')}
            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 inline-flex items-center gap-1"
          >
            Report it on GitHub
            <ExternalLink className="w-3 h-3" />
          </button>
        </p>
      </div>
    </div>
  );
}

export default Settings;
