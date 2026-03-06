import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, RotateCcw, FileText, AlertTriangle, Check, Search, Code, LayoutGrid, Power } from 'lucide-react';
import clsx from 'clsx';
import { useModal } from '../context/ModalContext';

function PhpIniEditor({ version, isOpen, onClose }) {
  const { showConfirm } = useModal();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  const [activeTab, setActiveTab] = useState('extensions');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen && version) {
      loadPhpIni();
      setActiveTab('extensions');
      setSearchQuery('');
    }
  }, [isOpen, version]);

  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);

  const loadPhpIni = async () => {
    setLoading(true);
    setError(null);
    try {
      const ini = await window.devbox?.binaries.getPhpIni(version);
      if (ini) {
        setContent(ini);
        setOriginalContent(ini);
      } else {
        setError('php.ini file not found');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Parse extensions from php.ini content
  const extensions = useMemo(() => {
    if (!content) return [];
    
    // List of widely used extensions to always show, even if missing from php.ini
    const WIDELY_USED_EXTENSIONS = [
      'bz2', 'curl', 'ffi', 'ftp', 'fileinfo', 'gd', 'gettext', 'gmp', 'intl', 
      'imap', 'ldap', 'mbstring', 'exif', 'mysqli', 'oci8_12c', 'odbc', 'openssl',
      'pdo_firebird', 'pdo_mysql', 'pdo_oci', 'pdo_odbc', 'pdo_pgsql', 'pdo_sqlite',
      'pgsql', 'shmop', 'snmp', 'soap', 'sockets', 'sodium', 'sqlite3', 'tidy', 'xsl', 'zip',
      'redis', 'mongodb', 'imagick', 'memcached', 'xdebug', 'opcache', 'bcmath',
      'calendar', 'xmlrpc'
    ];
    
    const lines = content.split('\n');
    const extMap = new Map();
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      // Match extension=... or zend_extension=... with optional leading semicolon
      const match = trimmed.match(/^(;?)\s*(zend_extension|extension)\s*=\s*([^\s;]+)/i);
      
      if (match) {
        let extName = match[3].replace(/^["']|["']$/g, '');
        // Clean up names for display
        const displayName = extName
          .replace(/^php_/, '')
          .replace(/\.dll$/, '')
          .replace(/\.so$/, '');
          
        const ext = {
          lineIndex: index,
          isDisabled: match[1] === ';',
          type: match[2].toLowerCase(),
          name: extName,
          displayName,
          existsInFile: true,
        };

        // If we see the exact same display name, prefer the uncommented one if conflict exists
        if (extMap.has(displayName)) {
          const existing = extMap.get(displayName);
          if (existing.isDisabled && !ext.isDisabled) {
            extMap.set(displayName, ext);
          }
        } else {
          extMap.set(displayName, ext);
        }
      }
    });

    // Add widely used extensions that completely missing from the file
    WIDELY_USED_EXTENSIONS.forEach(extName => {
      if (!extMap.has(extName)) {
        extMap.set(extName, {
          lineIndex: -1, // Indicates it doesn't exist in file yet
          isDisabled: true, // Missing means it's not enabled
          type: extName === 'opcache' || extName === 'xdebug' ? 'zend_extension' : 'extension',
          name: extName, // We don't append .dll/.so strictly here, just the name is usually enough for modern PHP
          displayName: extName,
          existsInFile: false,
        });
      }
    });

    return Array.from(extMap.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [content]);

  const filteredExtensions = useMemo(() => {
    if (!searchQuery) return extensions;
    const query = searchQuery.toLowerCase();
    return extensions.filter(ext => 
      ext.displayName.toLowerCase().includes(query) || 
      ext.name.toLowerCase().includes(query)
    );
  }, [extensions, searchQuery]);

  const toggleExtension = (ext) => {
    const lines = content.split('\n');
    
    if (ext.existsInFile) {
      // Toggle existing line
      const line = lines[ext.lineIndex];
      if (line.match(/^\s*;/)) {
        // Remove the first semicolon
        lines[ext.lineIndex] = line.replace(/^(\s*);\s*/, '$1');
      } else {
        // Add a semicolon at the start
        lines[ext.lineIndex] = line.replace(/^(\s*)/, '$1;');
      }
    } else {
      // Doesn't exist, we must add it.
      // Easiest is to append to the end of the file
      lines.push(`\n; DevBox Pro automatically added extension`);
      lines.push(`${ext.type}=${ext.name}`);
    }
    
    setContent(lines.join('\n'));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.devbox?.binaries.savePhpIni(version, content);
      setOriginalContent(content);

      // Auto-restart running projects using this PHP version
      const allProjects = await window.devbox?.projects.getAll();
      if (allProjects) {
        const projectsToRestart = allProjects.filter(p =>
          p.isRunning && p.phpVersion === version
        );

        // Restart projects sequentially
        for (const project of projectsToRestart) {
          await window.devbox?.projects.restart(project.id);
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = await showConfirm({
      title: 'Reset php.ini',
      message: 'Are you sure you want to reset php.ini to default?',
      detail: 'This will overwrite your changes.',
      confirmText: 'Reset',
      confirmStyle: 'danger',
      type: 'warning'
    });
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await window.devbox?.binaries.resetPhpIni(version);
      await loadPhpIni();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    if (hasChanges) {
      const confirmed = await showConfirm({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to close?',
        confirmText: 'Close',
        confirmStyle: 'warning',
        type: 'warning'
      });
      if (!confirmed) {
        return;
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary-500" />
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                PHP {version} Configuration
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage extensions and php.ini settings
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-6 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('extensions')}
            className={clsx(
              'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
              activeTab === 'extensions'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            Extensions
          </button>
          <button
            onClick={() => setActiveTab('editor')}
            className={clsx(
              'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
              activeTab === 'editor'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            <Code className="w-4 h-4" />
            Raw Editor
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col bg-gray-50/30 dark:bg-gray-900/20">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-red-500">
              <AlertTriangle className="w-5 h-5 mr-2" />
              {error}
            </div>
          ) : (
            <>
              {activeTab === 'extensions' && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search extensions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {filteredExtensions.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No extensions found matching "{searchQuery}"
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredExtensions.map((ext) => (
                          <div 
                            key={`${ext.lineIndex}-${ext.name}`}
                            className={clsx(
                              "flex items-center justify-between p-3 rounded-lg border transition-all duration-200",
                              ext.isDisabled 
                                ? "bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/50" 
                                : "bg-primary-50/50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800"
                            )}
                          >
                            <div className="min-w-0 pr-3">
                              <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate flex items-center gap-2">
                                {ext.displayName}
                                {ext.type === 'zend_extension' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                                    Zend
                                  </span>
                                )}
                              </h4>
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 truncate font-mono">
                                {ext.name}
                              </p>
                            </div>
                            <button
                              onClick={() => toggleExtension(ext)}
                              className={clsx(
                                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                                ext.isDisabled ? "bg-gray-200 dark:bg-gray-700" : "bg-primary-500"
                              )}
                              role="switch"
                              aria-checked={!ext.isDisabled}
                            >
                              <span
                                aria-hidden="true"
                                className={clsx(
                                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                  ext.isDisabled ? "translate-x-0" : "translate-x-4"
                                )}
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'editor' && (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="flex-1 w-full p-4 font-mono text-sm bg-[#1e1e1e] text-gray-300 resize-none focus:outline-none leading-relaxed"
                  spellCheck={false}
                  placeholder="Paste or edit php.ini content here..."
                  style={{ minHeight: '400px' }}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-md">
                <AlertTriangle className="w-4 h-4" />
                Unsaved changes
              </span>
            )}
            {saved && (
              <span className="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-1.5 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-md">
                <Check className="w-4 h-4" />
                Saved successfully
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={loading || saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Default
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving || !hasChanges}
              className={clsx(
                'px-4 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 flex items-center gap-2 transition-all',
                (!hasChanges || saving)
                  ? 'bg-primary-400 cursor-not-allowed'
                  : 'bg-primary-600 hover:bg-primary-700 shadow-sm'
              )}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PhpIniEditor;
