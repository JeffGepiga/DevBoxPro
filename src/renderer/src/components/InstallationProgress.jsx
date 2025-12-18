import React, { useState, useEffect, useRef } from 'react';
import { Terminal, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

function InstallationProgress({ isVisible, output, isComplete, hasError, onClose }) {
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[900px] max-h-[700px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {isComplete ? (
              hasError ? (
                <XCircle className="w-6 h-6 text-red-500" />
              ) : (
                <CheckCircle className="w-6 h-6 text-green-500" />
              )
            ) : (
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            )}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {isComplete
                  ? hasError
                    ? 'Installation Failed'
                    : 'Installation Complete'
                  : 'Installing Laravel...'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isComplete
                  ? hasError
                    ? 'An error occurred during installation'
                    : 'Your Laravel project is ready'
                  : 'This may take a few minutes...'}
              </p>
            </div>
          </div>
          {isComplete && (
            <button
              onClick={onClose}
              className="btn-primary"
            >
              {hasError ? 'Close' : 'View Project'}
            </button>
          )}
        </div>

        {/* Terminal Output */}
        <div className="flex-1 bg-gray-900 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-sm text-gray-300">Installation Output</span>
          </div>
          <div
            ref={outputRef}
            className="p-4 h-[500px] overflow-auto font-mono text-sm"
          >
            {output.length === 0 ? (
              <div className="text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting installation...
              </div>
            ) : (
              output.map((line, index) => (
                <div
                  key={index}
                  className={clsx(
                    'whitespace-pre-wrap break-all leading-relaxed',
                    line.type === 'command' && 'text-yellow-400 font-semibold mt-3 mb-1',
                    line.type === 'stdout' && 'text-gray-300',
                    line.type === 'stderr' && 'text-orange-400',
                    line.type === 'error' && 'text-red-400 font-semibold',
                    line.type === 'info' && 'text-cyan-400',
                    line.type === 'success' && 'text-green-400 font-medium',
                    line.type === 'warning' && 'text-yellow-500'
                  )}
                >
                  {line.text}
                </div>
              ))
            )}
            {!isComplete && output.length > 0 && (
              <div className="flex items-center gap-2 text-gray-400 mt-3 pt-2 border-t border-gray-700">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Running...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstallationProgress;
