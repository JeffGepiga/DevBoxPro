module.exports = {
  setStatusEmitter(callback) {
    this.statusEmitter = typeof callback === 'function' ? callback : null;
  },

  serializeTunnelState(projectId, state) {
    if (!state) {
      return null;
    }

    return {
      projectId,
      provider: state.provider || null,
      publicUrl: state.publicUrl || null,
      status: state.status || 'stopped',
      error: state.error || null,
      startedAt: state.startedAt || null,
      targetUrl: state.targetUrl || null,
    };
  },

  emitTunnelStatus(payload) {
    if (!payload || typeof this.statusEmitter !== 'function') {
      return;
    }

    this.statusEmitter(payload);
  },

  getTunnelStatus(projectId) {
    return this.serializeTunnelState(projectId, this.activeTunnels.get(projectId));
  },

  getAllTunnelStatuses() {
    const result = {};

    for (const [projectId, state] of this.activeTunnels.entries()) {
      result[projectId] = this.serializeTunnelState(projectId, state);
    }

    return result;
  },
};