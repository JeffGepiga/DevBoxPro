module.exports = {
  async createQueueWorker(projectId, options = {}) {
    const config = {
      name: options.name || 'queue-worker',
      command: `php artisan queue:work ${options.connection || ''} --sleep=${options.sleep || 3} --tries=${options.tries || 3} --max-jobs=${options.maxJobs || 1000} --max-time=${options.maxTime || 3600}`,
      autostart: options.autostart !== false,
      autorestart: true,
      numprocs: options.workers || 1,
    };

    return this.addProcess(projectId, config);
  },

  async createScheduleWorker(projectId) {
    const config = {
      name: 'schedule-runner',
      command: 'php artisan schedule:work',
      autostart: true,
      autorestart: true,
      numprocs: 1,
    };

    return this.addProcess(projectId, config);
  },

  async createHorizonWorker(projectId) {
    const config = {
      name: 'horizon',
      command: 'php artisan horizon',
      autostart: true,
      autorestart: true,
      numprocs: 1,
    };

    return this.addProcess(projectId, config);
  },
};