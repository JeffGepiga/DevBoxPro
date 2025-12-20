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
  Terminal,
  Copy,
  CheckCircle,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';

function Settings() {
  const { settings, refreshSettings } = useApp();
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
      // Refresh settings in context so other components get the updated values
      await refreshSettings();
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
      await refreshSettings();
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
      console.error('Error selecting directory:', error);
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
          <option value="phpstorm">PhpStorm</option>
          <option value="sublime">Sublime Text</option>
          <option value="atom">Atom</option>
        </select>
      </div>
    </div>
  );
}

function CliSettings({ settings, updateSetting }) {
  const [cliStatus, setCliStatus] = useState(null);
  const [alias, setAlias] = useState('dvp');
  const [instructions, setInstructions] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [addingToPath, setAddingToPath] = useState(false);
  const [syncingConfigs, setSyncingConfigs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState(null);

  // Load CLI status and alias
  useEffect(() => {
    const loadCliInfo = async () => {
      try {
        const status = await window.devbox?.cli?.getStatus();
        setCliStatus(status);
        
        const currentAlias = await window.devbox?.cli?.getAlias();
        setAlias(currentAlias || 'dvp');
        
        const instr = await window.devbox?.cli?.getInstructions();
        setInstructions(instr);
      } catch (error) {
        console.error('Error loading CLI info:', error);
      }
    };
    loadCliInfo();
  }, []);

  const handleInstallCli = async () => {
    setInstalling(true);
    setMessage(null);
    try {
      const result = await window.devbox?.cli?.install();
      setMessage({ type: 'success', text: `CLI tool installed successfully! Alias: ${result.alias}` });
      
      // Refresh status
      const status = await window.devbox?.cli?.getStatus();
      setCliStatus(status);
      const instr = await window.devbox?.cli?.getInstructions();
      setInstructions(instr);
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to install CLI: ${error.message}` });
    } finally {
      setInstalling(false);
    }
  };

  const handleAddToPath = async () => {
    setAddingToPath(true);
    setMessage(null);
    try {
      const result = await window.devbox?.cli?.addToPath();
      setMessage({ type: 'success', text: result.message + ' ' + result.note });
      
      // Refresh status
      const status = await window.devbox?.cli?.getStatus();
      setCliStatus(status);
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to add to PATH: ${error.message}` });
    } finally {
      setAddingToPath(false);
    }
  };

  const handleSaveAlias = async () => {
    try {
      await window.devbox?.cli?.setAlias(alias);
      setMessage({ type: 'success', text: `Alias changed to "${alias}". Please reinstall the CLI tool.` });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleSyncConfigs = async () => {
    setSyncingConfigs(true);
    setMessage(null);
    try {
      const results = await window.devbox?.cli?.syncProjectConfigs();
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      setMessage({ 
        type: failed > 0 ? 'warning' : 'success', 
        text: `Synced ${success} project(s)${failed > 0 ? `, ${failed} failed` : ''}`
      });
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to sync configs: ${error.message}` });
    } finally {
      setSyncingConfigs(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* CLI Info Card */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Terminal className="w-5 h-5" />
          CLI Tool
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Use the CLI tool to run PHP, Node.js, Composer, and npm commands with project-specific versions from any terminal or editor.
        </p>

        {/* Status */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
          {cliStatus?.installed ? (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle className="w-4 h-4" />
              Installed
            </span>
          ) : (
            <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
              <AlertCircle className="w-4 h-4" />
              Not installed
            </span>
          )}
          {cliStatus?.installed && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">In PATH:</span>
              {cliStatus?.inPath ? (
                <span className="text-green-600 dark:text-green-400">Yes</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">No</span>
              )}
            </>
          )}
        </div>

        {/* Message */}
        {message && (
          <div className={clsx(
            'p-3 rounded-lg mb-4 text-sm',
            message.type === 'success' && 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
            message.type === 'error' && 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
            message.type === 'warning' && 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
          )}>
            {message.text}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleInstallCli}
            disabled={installing}
            className="btn-primary"
          >
            {installing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {cliStatus?.installed ? 'Reinstall CLI' : 'Install CLI'}
          </button>
          
          {cliStatus?.installed && !cliStatus?.inPath && (
            <button
              onClick={handleAddToPath}
              disabled={addingToPath}
              className="btn-secondary"
            >
              {addingToPath ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Add to PATH
            </button>
          )}

          <button
            onClick={handleSyncConfigs}
            disabled={syncingConfigs}
            className="btn-secondary"
          >
            {syncingConfigs ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Sync Project Configs
          </button>
        </div>
      </div>

      {/* Alias Configuration */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Command Alias
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Customize the command alias used in your terminal. Default is <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">dvp</code>.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            className="input w-40"
            placeholder="dvp"
          />
          <button
            onClick={handleSaveAlias}
            disabled={!alias || alias === cliStatus?.alias}
            className="btn-secondary"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          After changing the alias, reinstall the CLI tool.
        </p>
      </div>

      {/* Usage Examples */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Usage Examples
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Navigate to your project folder and use these commands:
        </p>
        <div className="space-y-2">
          {[
            { cmd: `${alias} php artisan migrate`, desc: 'Run Laravel Artisan with project PHP version' },
            { cmd: `${alias} php artisan optimize`, desc: 'Optimize Laravel with correct PHP' },
            { cmd: `${alias} composer install`, desc: 'Install Composer dependencies' },
            { cmd: `${alias} npm install`, desc: 'Install npm packages with project Node.js' },
            { cmd: `${alias} npm run dev`, desc: 'Run npm scripts' },
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

      {/* Manual PATH Instructions */}
      {instructions && !cliStatus?.inPath && (
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Manual PATH Setup
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            If automatic PATH setup doesn't work, follow these steps:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {instructions.manual?.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {instructions.powershell && (
            <div className="mt-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Or run this PowerShell command:</p>
              <div className="flex items-center gap-2 p-3 bg-gray-900 rounded-lg">
                <code className="text-sm font-mono text-green-400 flex-1 overflow-x-auto">
                  {instructions.powershell}
                </code>
                <button
                  onClick={() => copyToClipboard(instructions.powershell)}
                  className="btn-ghost btn-sm text-gray-400 hover:text-white"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NetworkSettings({ settings, updateSetting }) {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Database Credentials
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          These credentials will be used for new projects and .env configuration
        </p>
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
              Note: This updates the setting for new projects. Use the Databases page to change the actual database password.
            </p>
          </div>
        </div>
      </div>

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

  // Load config info on mount
  useEffect(() => {
    const loadConfigInfo = async () => {
      try {
        const compatInfo = await window.devbox?.compatibility?.getConfigInfo();
        setConfigInfo(prev => ({ ...prev, compatibility: compatInfo }));
      } catch (error) {
        console.error('Error loading config info:', error);
      }
    };
    loadConfigInfo();
  }, []);

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
      console.error('Error applying binary updates:', error);
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
      console.error('Error applying compatibility updates:', error);
    } finally {
      setApplyingCompatibilityUpdates(false);
    }
  };

  return (
    <div className="space-y-6">
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
