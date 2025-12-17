import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
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
} from 'lucide-react';
import clsx from 'clsx';

function Settings() {
  const { settings } = useApp();
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
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(localSettings)) {
        await window.devbox?.settings.set(`settings.${key}`, value);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (window.confirm('Reset all settings to defaults?')) {
      await window.devbox?.settings.reset();
      const newSettings = await window.devbox?.settings.getAll();
      setLocalSettings(newSettings.settings || {});
    }
  };

  const handleExportConfig = async () => {
    try {
      // In a real app, this would use a save dialog
      alert('Config exported to devbox-config.json');
    } catch (error) {
      console.error('Error exporting config:', error);
    }
  };

  const handleImportConfig = async () => {
    try {
      // In a real app, this would use a file picker
      alert('Import config feature coming soon');
    } catch (error) {
      console.error('Error importing config:', error);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Server },
    { id: 'network', label: 'Network', icon: Globe },
    { id: 'php', label: 'PHP', icon: Code },
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
          {activeTab === 'network' && (
            <NetworkSettings settings={localSettings} updateSetting={updateSetting} />
          )}
          {activeTab === 'php' && (
            <PhpSettings settings={localSettings} updateSetting={updateSetting} />
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
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Startup
        </h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                Auto-start services
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Start MySQL, Redis, and other services when DevBox Pro launches
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoStartServices ?? true}
              onChange={(e) => updateSetting('autoStartServices', e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
          </label>

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
          <option value="phpstorm">PhpStorm</option>
          <option value="sublime">Sublime Text</option>
          <option value="atom">Atom</option>
        </select>
      </div>
    </div>
  );
}

function NetworkSettings({ settings, updateSetting }) {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Port Configuration
        </h3>
        <div className="space-y-4">
          <div>
            <label className="label">Project Port Range Start</label>
            <input
              type="number"
              value={settings.portRangeStart || 8000}
              onChange={(e) => updateSetting('portRangeStart', parseInt(e.target.value))}
              className="input w-32"
              min="1024"
              max="65535"
            />
            <p className="text-sm text-gray-500 mt-1">
              Projects will be assigned ports starting from this number
            </p>
          </div>

          <div>
            <label className="label">MySQL Port</label>
            <input
              type="number"
              value={settings.mysqlPort || 3306}
              onChange={(e) => updateSetting('mysqlPort', parseInt(e.target.value))}
              className="input w-32"
            />
          </div>

          <div>
            <label className="label">Redis Port</label>
            <input
              type="number"
              value={settings.redisPort || 6379}
              onChange={(e) => updateSetting('redisPort', parseInt(e.target.value))}
              className="input w-32"
            />
          </div>

          <div>
            <label className="label">phpMyAdmin Port</label>
            <input
              type="number"
              value={settings.phpMyAdminPort || 8080}
              onChange={(e) => updateSetting('phpMyAdminPort', parseInt(e.target.value))}
              className="input w-32"
            />
          </div>

          <div>
            <label className="label">Mailpit Port</label>
            <input
              type="number"
              value={settings.mailpitPort || 8025}
              onChange={(e) => updateSetting('mailpitPort', parseInt(e.target.value))}
              className="input w-32"
            />
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

function PhpSettings({ settings, updateSetting }) {
  const phpVersions = ['8.3', '8.2', '8.1', '8.0', '7.4'];

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Default PHP Version
        </h3>
        <div className="grid grid-cols-5 gap-2">
          {phpVersions.map((version) => (
            <button
              key={version}
              onClick={() => updateSetting('defaultPhpVersion', version)}
              className={clsx(
                'py-3 px-4 rounded-lg border-2 font-medium transition-all',
                settings.defaultPhpVersion === version
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              )}
            >
              PHP {version}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppearanceSettings({ settings, updateSetting }) {
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
              onClick={() => updateSetting('theme', theme)}
              className={clsx(
                'p-4 rounded-lg border-2 text-center transition-all capitalize',
                settings.theme === theme
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              )}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdvancedSettings({ settings, updateSetting, onExport, onImport }) {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Configuration
        </h3>
        <div className="flex gap-4">
          <button onClick={onExport} className="btn-secondary">
            <Download className="w-4 h-4" />
            Export Config
          </button>
          <button onClick={onImport} className="btn-secondary">
            <Upload className="w-4 h-4" />
            Import Config
          </button>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Data Location
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          DevBox Pro stores data in the following location:
        </p>
        <code className="block p-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm">
          {settings.dataPath || '~/.devbox-pro'}
        </code>
      </div>

      <div className="card p-6 border-red-200 dark:border-red-900/50">
        <h3 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          These actions are destructive and cannot be undone.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => {
              if (window.confirm('Clear all project data? This cannot be undone.')) {
                // Would clear project data
              }
            }}
            className="btn-danger"
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
