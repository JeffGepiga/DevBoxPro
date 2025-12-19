import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  RefreshCw,
  Search,
  Filter,
  Trash2,
  Download,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
  Server,
  Folder,
} from 'lucide-react';
import clsx from 'clsx';

function Logs() {
  const { projects, services } = useApp();
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedLevel, setSelectedLevel] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef(null);

  useEffect(() => {
    loadLogs();
  }, [selectedSource]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      let logEntries = [];

      if (selectedSource === 'all') {
        // Load logs from all sources
        for (const project of projects) {
          const projectLogs = await window.devbox?.logs.getProjectLogs(project.id, 50);
          if (projectLogs) {
            logEntries.push(
              ...projectLogs.map((line) => ({
                source: 'project',
                sourceId: project.id,
                sourceName: project.name,
                raw: line,
                ...parseLogLine(line),
              }))
            );
          }
        }

        for (const [name] of Object.entries(services)) {
          const serviceLogs = await window.devbox?.logs.getServiceLogs(name, 50);
          if (serviceLogs) {
            logEntries.push(
              ...serviceLogs.map((line) => ({
                source: 'service',
                sourceId: name,
                sourceName: services[name]?.name || name,
                raw: line,
                ...parseLogLine(line),
              }))
            );
          }
        }
      } else if (selectedSource.startsWith('project:')) {
        const projectId = selectedSource.replace('project:', '');
        const projectLogs = await window.devbox?.logs.getProjectLogs(projectId, 200);
        const project = projects.find((p) => p.id === projectId);
        if (projectLogs) {
          logEntries = projectLogs.map((line) => ({
            source: 'project',
            sourceId: projectId,
            sourceName: project?.name || projectId,
            raw: line,
            ...parseLogLine(line),
          }));
        }
      } else if (selectedSource.startsWith('service:')) {
        const serviceName = selectedSource.replace('service:', '');
        const serviceLogs = await window.devbox?.logs.getServiceLogs(serviceName, 200);
        if (serviceLogs) {
          logEntries = serviceLogs.map((line) => ({
            source: 'service',
            sourceId: serviceName,
            sourceName: services[serviceName]?.name || serviceName,
            raw: line,
            ...parseLogLine(line),
          }));
        }
      }

      // Sort by timestamp
      logEntries.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeA - timeB;
      });

      setLogs(logEntries);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const parseLogLine = (line) => {
    const match = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);

    if (match) {
      return {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        message: match[3],
      };
    }

    return {
      timestamp: null,
      level: 'info',
      message: line,
    };
  };

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = selectedLevel === 'all' || log.level === selectedLevel;
    const matchesSearch =
      !searchQuery ||
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.sourceName.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesLevel && matchesSearch;
  });

  const clearLogs = async () => {
    if (selectedSource === 'all') {
      // Clear all logs - ask for confirmation
      if (!window.confirm('Clear all logs from all projects and services?')) {
        return;
      }
      // Clear all project logs
      for (const project of projects) {
        await window.devbox?.logs.clearProjectLogs(project.id);
      }
      // Clear all service logs
      for (const name of Object.keys(services)) {
        await window.devbox?.logs.clearServiceLogs(name);
      }
    } else if (selectedSource.startsWith('project:')) {
      const projectId = selectedSource.replace('project:', '');
      await window.devbox?.logs.clearProjectLogs(projectId);
    } else if (selectedSource.startsWith('service:')) {
      const serviceName = selectedSource.replace('service:', '');
      await window.devbox?.logs.clearServiceLogs(serviceName);
    }
    loadLogs();
  };

  const exportLogs = () => {
    const content = filteredLogs.map((log) => log.raw).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devbox-logs-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelIcons = {
    info: Info,
    warn: AlertTriangle,
    error: AlertCircle,
    debug: Bug,
  };

  const levelColors = {
    info: 'text-blue-500',
    warn: 'text-yellow-500',
    error: 'text-red-500',
    debug: 'text-gray-500',
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Logs</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            View logs from all services and projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportLogs} className="btn-secondary">
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={clearLogs}
            className="btn-secondary"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
          <button onClick={loadLogs} disabled={loading} className="btn-secondary">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Source filter */}
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="select w-48"
          >
            <option value="all">All Sources</option>
            <optgroup label="Projects">
              {projects.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {project.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Services">
              {Object.entries(services).map(([name, service]) => (
                <option key={name} value={`service:${name}`}>
                  {service.name || name}
                </option>
              ))}
            </optgroup>
          </select>

          {/* Level filter */}
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="select w-32"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>

          {/* Auto-scroll toggle */}
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Log Viewer */}
      <div className="flex-1 card overflow-hidden flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filteredLogs.length} log entries
          </span>
        </div>
        <div className="flex-1 overflow-auto bg-gray-900 p-4 font-mono text-sm scrollbar-thin">
          {filteredLogs.length > 0 ? (
            <>
              {filteredLogs.map((log, index) => {
                const LevelIcon = levelIcons[log.level] || Info;

                return (
                  <div
                    key={index}
                    className="flex items-start gap-2 py-1 hover:bg-gray-800 px-2 rounded group"
                  >
                    <LevelIcon
                      className={clsx('w-4 h-4 mt-0.5 flex-shrink-0', levelColors[log.level])}
                    />
                    <span className="text-gray-500 flex-shrink-0 w-44">
                      {log.timestamp || '-'}
                    </span>
                    <span className="text-gray-400 flex-shrink-0 w-24 truncate" title={log.sourceName}>
                      [{log.sourceName}]
                    </span>
                    <span className="text-gray-300 break-all">{log.message}</span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Server className="w-12 h-12 mb-4" />
              <p>No logs to display</p>
              <p className="text-sm mt-1">
                Start some services or projects to see logs
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Logs;
