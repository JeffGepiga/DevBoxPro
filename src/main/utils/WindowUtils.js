function showAndFocusWindow(window, appInstance) {
  if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
    return false;
  }

  if (typeof appInstance?.focus === 'function') {
    try {
      appInstance.focus({ steal: true });
    } catch {
      appInstance.focus();
    }
  }

  if (typeof window.setSkipTaskbar === 'function') {
    window.setSkipTaskbar(false);
  }

  if (typeof window.isMinimized === 'function' && window.isMinimized()) {
    window.restore();
  }

  if (typeof window.show === 'function') {
    window.show();
  }

  if (typeof window.moveTop === 'function') {
    window.moveTop();
  }

  if (process.platform === 'win32' && typeof window.setAlwaysOnTop === 'function') {
    window.setAlwaysOnTop(true);
  }

  if (typeof window.focus === 'function') {
    window.focus();
  }

  if (process.platform === 'win32' && typeof window.setAlwaysOnTop === 'function') {
    window.setAlwaysOnTop(false);
  }

  return true;
}

module.exports = {
  showAndFocusWindow,
};