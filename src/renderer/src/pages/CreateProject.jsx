import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  Check,
  Database,
  Globe,
  Settings,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';

const PROJECT_TYPES = [
  {
    id: 'laravel',
    name: 'Laravel',
    description: 'Full-stack PHP framework with Eloquent ORM',
    icon: '🔴',
    features: ['Artisan CLI', 'Queue Workers', 'Scheduler'],
  },
  {
    id: 'symfony',
    name: 'Symfony',
    description: 'Professional PHP framework for web applications',
    icon: '🟡',
    features: ['Console Commands', 'Doctrine ORM'],
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Popular CMS for websites and blogs',
    icon: '🔵',
    features: ['WP-CLI Support', 'Multisite Ready'],
  },
  {
    id: 'custom',
    name: 'Custom PHP',
    description: 'Any PHP application or framework',
    icon: '⚪',
    features: ['Flexible Configuration'],
  },
];

const PHP_VERSIONS = ['8.3', '8.2', '8.1', '8.0', '7.4'];

const WIZARD_STEPS = [
  { id: 'type', title: 'Project Type', icon: Folder },
  { id: 'details', title: 'Details', icon: Settings },
  { id: 'services', title: 'Services', icon: Database },
  { id: 'domain', title: 'Domain & SSL', icon: Globe },
  { id: 'review', title: 'Review', icon: Check },
];

function CreateProject() {
  const navigate = useNavigate();
  const { createProject } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    type: 'laravel',
    phpVersion: '8.2',
    services: {
      mysql: true,
      redis: false,
      queue: false,
    },
    domain: '',
    ssl: true,
    webServer: 'nginx', // 'nginx' or 'apache'
  });

  const updateFormData = (updates) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleSelectPath = async () => {
    const path = await window.devbox?.system.selectDirectory();
    if (path) {
      updateFormData({ path });

      // Auto-generate name from folder name if not set
      if (!formData.name) {
        const folderName = path.split(/[\\/]/).pop();
        updateFormData({ 
          name: folderName.charAt(0).toUpperCase() + folderName.slice(1),
          path 
        });
      }
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return !!formData.type;
      case 1:
        return !!formData.name && !!formData.path;
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const project = await createProject({
        ...formData,
        domains: formData.domain ? [formData.domain] : undefined,
      });

      if (project) {
        navigate(`/projects/${project.id}`);
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project: ' + error.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Create New Project
        </h1>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {WIZARD_STEPS.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center">
                <div
                  className={clsx(
                    'w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors',
                    index < currentStep
                      ? 'bg-green-500 text-white'
                      : index === currentStep
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  )}
                >
                  {index < currentStep ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <step.icon className="w-5 h-5" />
                  )}
                </div>
                <span
                  className={clsx(
                    'text-xs font-medium',
                    index <= currentStep
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  {step.title}
                </span>
              </div>
              {index < WIZARD_STEPS.length - 1 && (
                <div
                  className={clsx(
                    'flex-1 h-0.5 mx-4 mb-6',
                    index < currentStep ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="card p-8 mb-8">
        {currentStep === 0 && (
          <StepProjectType formData={formData} updateFormData={updateFormData} />
        )}
        {currentStep === 1 && (
          <StepDetails
            formData={formData}
            updateFormData={updateFormData}
            onSelectPath={handleSelectPath}
          />
        )}
        {currentStep === 2 && (
          <StepServices formData={formData} updateFormData={updateFormData} />
        )}
        {currentStep === 3 && (
          <StepDomain formData={formData} updateFormData={updateFormData} />
        )}
        {currentStep === 4 && <StepReview formData={formData} />}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="btn-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {currentStep < WIZARD_STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn-primary"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="btn-success"
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Create Project
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function StepProjectType({ formData, updateFormData }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Select Project Type
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Choose the framework or type of PHP application
      </p>

      <div className="grid grid-cols-2 gap-4">
        {PROJECT_TYPES.map((type) => (
          <button
            key={type.id}
            onClick={() => updateFormData({ type: type.id })}
            className={clsx(
              'p-6 rounded-xl border-2 text-left transition-all',
              formData.type === type.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            <div className="text-3xl mb-3">{type.icon}</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {type.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              {type.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {type.features.map((feature) => (
                <span key={feature} className="badge badge-neutral">
                  {feature}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepDetails({ formData, updateFormData, onSelectPath }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Project Details
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Configure the basic settings for your project
      </p>

      <div className="space-y-6">
        <div>
          <label className="label">Project Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => updateFormData({ name: e.target.value })}
            className="input"
            placeholder="My Awesome Project"
          />
        </div>

        <div>
          <label className="label">Project Path</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.path}
              onChange={(e) => updateFormData({ path: e.target.value })}
              className="input flex-1"
              placeholder="/path/to/project"
            />
            <button onClick={onSelectPath} className="btn-secondary">
              <Folder className="w-4 h-4" />
              Browse
            </button>
          </div>
        </div>

        <div>
          <label className="label">PHP Version</label>
          <div className="grid grid-cols-5 gap-2">
            {PHP_VERSIONS.map((version) => (
              <button
                key={version}
                onClick={() => updateFormData({ phpVersion: version })}
                className={clsx(
                  'py-3 px-4 rounded-lg border-2 font-medium transition-all',
                  formData.phpVersion === version
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                PHP {version}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepServices({ formData, updateFormData }) {
  const toggleService = (service) => {
    updateFormData({
      services: {
        ...formData.services,
        [service]: !formData.services[service],
      },
    });
  };

  const services = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'Relational database for data storage',
      icon: '🗄️',
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'In-memory cache and session storage',
      icon: '⚡',
    },
    {
      id: 'queue',
      name: 'Queue Worker',
      description: 'Background job processing (Laravel)',
      icon: '⚙️',
      laravelOnly: true,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Configure Services
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Select the services you need for this project
      </p>

      <div className="space-y-4">
        {services.map((service) => {
          const disabled = service.laravelOnly && formData.type !== 'laravel';

          return (
            <button
              key={service.id}
              onClick={() => !disabled && toggleService(service.id)}
              disabled={disabled}
              className={clsx(
                'w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-4',
                disabled
                  ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700'
                  : formData.services[service.id]
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <div className="text-2xl">{service.icon}</div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {service.name}
                  {service.laravelOnly && (
                    <span className="ml-2 text-xs text-gray-500">(Laravel only)</span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {service.description}
                </p>
              </div>
              <div
                className={clsx(
                  'w-6 h-6 rounded-full border-2 flex items-center justify-center',
                  formData.services[service.id]
                    ? 'border-green-500 bg-green-500'
                    : 'border-gray-300 dark:border-gray-600'
                )}
              >
                {formData.services[service.id] && (
                  <Check className="w-4 h-4 text-white" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepDomain({ formData, updateFormData }) {
  const suggestedDomain = formData.name
    ? `${formData.name.toLowerCase().replace(/\s+/g, '-')}.test`
    : '';

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Domain, SSL & Web Server
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Configure the local domain and web server for your project
      </p>

      <div className="space-y-6">
        {/* Web Server Selection */}
        <div>
          <label className="label">Web Server</label>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => updateFormData({ webServer: 'nginx' })}
              className={clsx(
                'p-4 rounded-xl border-2 text-left transition-all',
                formData.webServer === 'nginx'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🟢</span>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Nginx</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    High performance, low memory usage
                  </p>
                </div>
              </div>
              {formData.webServer === 'nginx' && (
                <div className="mt-2 flex items-center gap-1 text-primary-600 dark:text-primary-400 text-sm">
                  <Check className="w-4 h-4" />
                  Selected
                </div>
              )}
            </button>

            <button
              onClick={() => updateFormData({ webServer: 'apache' })}
              className={clsx(
                'p-4 rounded-xl border-2 text-left transition-all',
                formData.webServer === 'apache'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔴</span>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Apache</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    .htaccess support, flexibility
                  </p>
                </div>
              </div>
              {formData.webServer === 'apache' && (
                <div className="mt-2 flex items-center gap-1 text-primary-600 dark:text-primary-400 text-sm">
                  <Check className="w-4 h-4" />
                  Selected
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Domain Input */}
        <div>
          <label className="label">Local Domain</label>
          <input
            type="text"
            value={formData.domain}
            onChange={(e) => updateFormData({ domain: e.target.value })}
            className="input"
            placeholder={suggestedDomain || 'myproject.test'}
          />
          {suggestedDomain && !formData.domain && (
            <button
              onClick={() => updateFormData({ domain: suggestedDomain })}
              className="mt-2 text-sm text-primary-600 hover:text-primary-700"
            >
              Use suggested: {suggestedDomain}
            </button>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            A virtual host will be automatically created for both HTTP ({formData.domain || suggestedDomain || 'myproject.test'}) 
            and HTTPS (https://{formData.domain || suggestedDomain || 'myproject.test'})
          </p>
        </div>

        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.ssl}
              onChange={(e) => updateFormData({ ssl: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-white">
                Enable SSL (HTTPS)
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Generate a local SSL certificate for secure development
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

function StepReview({ formData }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Review Configuration
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Confirm your project settings before creating
      </p>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              Project Name
            </h3>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {formData.name}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              Project Type
            </h3>
            <p className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
              {formData.type}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              PHP Version
            </h3>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              PHP {formData.phpVersion}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              Domain
            </h3>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {formData.domain || 'Auto-assigned'}
              {formData.ssl && ' (SSL)'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              Web Server
            </h3>
            <p className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
              {formData.webServer === 'nginx' ? '🟢 Nginx' : '🔴 Apache'}
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
            Project Path
          </h3>
          <p className="text-gray-900 dark:text-white font-mono text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded">
            {formData.path}
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
            Enabled Services
          </h3>
          <div className="flex gap-2">
            {Object.entries(formData.services)
              .filter(([_, enabled]) => enabled)
              .map(([service]) => (
                <span key={service} className="badge badge-success capitalize">
                  {service}
                </span>
              ))}
            {!Object.values(formData.services).some(Boolean) && (
              <span className="text-gray-500 dark:text-gray-400">None selected</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateProject;
