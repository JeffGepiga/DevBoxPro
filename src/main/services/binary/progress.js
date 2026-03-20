module.exports = {
  addProgressListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },

  emitProgress(id, progress) {
    const isProgressUpdate = (progress.status === 'downloading' || progress.status === 'extracting')
      && progress.progress !== 0
      && progress.progress !== 100;

    if (!isProgressUpdate) {
      this.downloadProgress.set(id, progress);
      this.lastProgressEmit.delete(id);
      this.listeners.forEach((callback) => callback(id, progress));

      if (progress.status === 'completed' || progress.status === 'error') {
        setTimeout(() => {
          this.downloadProgress.delete(id);
          this.lastProgressEmit.delete(id);
        }, 1000);
      }
      return;
    }

    const now = Date.now();
    const last = this.lastProgressEmit.get(id);
    const currentProgress = progress.progress || 0;
    const timeSinceLast = last ? (now - last.time) : Infinity;
    const progressDelta = last ? Math.abs(currentProgress - last.progress) : Infinity;

    if (timeSinceLast >= this.progressThrottleMs || progressDelta >= this.progressMinDelta || !last) {
      this.downloadProgress.set(id, progress);
      this.lastProgressEmit.set(id, { time: now, progress: currentProgress });
      this.listeners.forEach((callback) => callback(id, progress));
    }
  },

  getActiveDownloads() {
    const active = {};
    for (const [id, progress] of this.downloadProgress.entries()) {
      if (progress.status !== 'completed' && progress.status !== 'error') {
        active[id] = progress;
      }
    }
    return active;
  },
};
