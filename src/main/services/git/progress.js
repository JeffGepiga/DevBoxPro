module.exports = {
  onProgress(callback) {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  },

  emitProgress(progress) {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch (err) {
      }
    }
  },
};