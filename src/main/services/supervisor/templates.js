const { isProductionMode, PRODUCTION_WORKER } = require('../../../shared/deploymentMode');

module.exports = {
  async createQueueWorker(projectId, options = {}) {
    const project = this.getProject(projectId);
    const globalSettings = this.configStore?.get('settings', {});
    const isProd = isProductionMode(project, globalSettings);

    const sleep = options.sleep ?? PRODUCTION_WORKER.sleep;
    const tries = options.tries ?? (isProd ? PRODUCTION_WORKER.tries : 1);
    const maxJobs = options.maxJobs ?? (isProd ? PRODUCTION_WORKER.maxJobs : 500);
    const maxTime = options.maxTime ?? PRODUCTION_WORKER.maxTime;
    const memory = options.memory ?? (isProd ? PRODUCTION_WORKER.memory : 64);
    const timeout = options.timeout ?? (isProd ? PRODUCTION_WORKER.timeout : 0);
    const workers = options.workers ?? (isProd ? PRODUCTION_WORKER.numprocs : 1);

    let command = `php artisan queue:work ${options.connection || ''} --sleep=${sleep} --tries=${tries} --max-jobs=${maxJobs} --max-time=${maxTime} --memory=${memory}`.trim();
    if (timeout > 0) {
      command += ` --timeout=${timeout}`;
    }

    const config = {
      name: options.name || 'queue-worker',
      command,
      autostart: options.autostart !== false,
      autorestart: true,
      numprocs: workers,
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