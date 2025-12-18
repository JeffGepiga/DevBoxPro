import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import InstallationProgress from '../components/InstallationProgress';
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  Check,
  Database,
  Globe,
  Settings,
  Zap,
  AlertTriangle,
  Download,
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

const PHP_VERSIONS = ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'];

const WIZARD_STEPS = [
  { id: 'type', title: 'Project Type', icon: Folder },
  { id: 'details', title: 'Details', icon: Settings },
  { id: 'services', title: 'Services', icon: Database },
  { id: 'domain', title: 'Domain & Server', icon: Globe },
  { id: 'review', title: 'Review', icon: Check },
];

function CreateProject() {
  const navigate = useNavigate();
  const { createProject, settings } = useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [showInstallProgress, setShowInstallProgress] = useState(false);
  const [installOutput, setInstallOutput] = useState([]);
  const [installComplete, setInstallComplete] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const [defaultProjectsPath, setDefaultProjectsPath] = useState('');
  const [pathManuallySet, setPathManuallySet] = useState(false);
  const [binariesStatus, setBinariesStatus] = useState({
    loading: true,
    php: [],
    nginx: false,
    apache: false,
    mysql: false,
    mariadb: false,
    redis: false,
  });
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    type: 'laravel',
    phpVersion: '8.4',
    installFresh: true, // Install fresh Laravel/WordPress
    services: {
      mysql: true,
      mariadb: false,
      redis: false,
      queue: false,
    },
    domain: '',
    ssl: true,
    webServer: 'nginx', // 'nginx' or 'apache'
  });

  // Load default projects path from settings
  useEffect(() => {
    const loadDefaultPath = async () => {
      try {
        const allSettings = await window.devbox?.settings?.getAll?.();
        const defaultPath = allSettings?.settings?.defaultProjectsPath;
        if (defaultPath) {
          setDefaultProjectsPath(defaultPath);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    loadDefaultPath();
  }, []);

  // Auto-generate path when name changes (if path wasn't manually set)
  useEffect(() => {
    if (formData.name && defaultProjectsPath && !pathManuallySet) {
      // Generate path from name: remove special chars, lowercase, replace spaces with dashes
      const safeFolderName = formData.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      
      // Use platform-appropriate separator
      const separator = navigator.platform.toLowerCase().includes('win') ? '\\' : '/';
      const generatedPath = `${defaultProjectsPath}${separator}${safeFolderName}`;
      
      setFormData(prev => ({ ...prev, path: generatedPath }));
    }
  }, [formData.name, defaultProjectsPath, pathManuallySet]);

  // Listen for terminal output during installation - always active
  useEffect(() => {
    const handleOutput = (data) => {
      // Add null check for data since different terminal events have different structures
      if (!data || !data.projectId) return;
      console.log('Received terminal output:', data);
      if (data.projectId === 'installation') {
        // Check for completion signal
        if (data.type === 'complete') {
          setInstallComplete(true);
          return;
        }
        
        // Don't add empty text
        if (!data.text) return;
        
        // Check for error in type
        if (data.type === 'error') {
          setInstallError(true);
        }
        
        setInstallOutput((prev) => [...prev, { text: data.text, type: data.type }]);
      }
    };

    // Handle installation complete event - auto redirect to project overview
    const handleInstallComplete = (event, data) => {
      console.log('Installation complete:', data);
      if (data?.projectId) {
        // Small delay to let user see the success message
        setTimeout(() => {
          setShowInstallProgress(false);
          navigate(`/projects/${data.projectId}`);
        }, 2000);
      }
    };

    // Subscribe to terminal output immediately
    const cleanupOutput = window.devbox?.terminal?.onOutput?.(handleOutput);
    const cleanupComplete = window.devbox?.terminal?.onInstallComplete?.(handleInstallComplete);

    return () => {
      if (cleanupOutput && typeof cleanupOutput === 'function') {
        cleanupOutput();
      }
      if (cleanupComplete && typeof cleanupComplete === 'function') {
        cleanupComplete();
      }
    };
  }, [navigate]); // Add navigate dependency

  // Check available binaries on mount
  useEffect(() => {
    const checkBinaries = async () => {
      try {
        const status = await window.devbox?.binaries.getStatus();
        if (status) {
          const phpVersions = Object.entries(status.php || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);
          
          setBinariesStatus({
            loading: false,
            php: phpVersions,
            nginx: status.nginx?.installed || false,
            apache: status.apache?.installed || false,
            mysql: status.mysql?.installed || false,
            mariadb: status.mariadb?.installed || false,
            redis: status.redis?.installed || false,
          });

          // Set default PHP version to first available
          if (phpVersions.length > 0 && !phpVersions.includes(formData.phpVersion)) {
            updateFormData({ phpVersion: phpVersions[0] });
          }
        } else {
          setBinariesStatus(prev => ({ ...prev, loading: false }));
        }
      } catch (error) {
        console.error('Error checking binaries:', error);
        setBinariesStatus(prev => ({ ...prev, loading: false }));
      }
    };
    checkBinaries();
  }, []);

  // Check if required binaries are available
  const hasRequiredBinaries = () => {
    return binariesStatus.php.length > 0 && (binariesStatus.nginx || binariesStatus.apache);
  };

  const updateFormData = (updates) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleSelectPath = async () => {
    const path = await window.devbox?.system.selectDirectory();
    if (path) {
      setPathManuallySet(true); // Mark path as manually set
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
    
    // Reset and show installation progress if installing fresh
    const shouldShowProgress = formData.installFresh && (formData.type === 'laravel' || formData.type === 'wordpress');
    
    if (shouldShowProgress) {
      setInstallOutput([]); // Clear previous output
      setInstallComplete(false);
      setInstallError(false);
      setShowInstallProgress(true);
    }

    try {
      const project = await createProject({
        ...formData,
        domains: formData.domain ? [formData.domain] : undefined,
      });

      if (project) {
        setCreatedProject(project);
        
        if (!shouldShowProgress) {
          // No installation needed, navigate directly
          navigate(`/projects/${project.id}`);
        }
        // If shouldShowProgress is true, we wait for the 'complete' signal from IPC
        // The installation is running in the background
      }
    } catch (error) {
      console.error('Error creating project:', error);
      if (shouldShowProgress) {
        setInstallOutput((prev) => [...prev, { text: `Error: ${error.message}`, type: 'error' }]);
        setInstallComplete(true);
        setInstallError(true);
      } else {
        alert('Failed to create project: ' + error.message);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleInstallClose = () => {
    setShowInstallProgress(false);
    if (createdProject && !installError) {
      // Navigate to terminal tab of the new project
      navigate(`/projects/${createdProject.id}?tab=terminal`);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Installation Progress Modal */}
      <InstallationProgress
        isVisible={showInstallProgress}
        output={installOutput}
        isComplete={installComplete}
        hasError={installError}
        onClose={handleInstallClose}
      />

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

      {/* Loading state */}
      {binariesStatus.loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Checking available binaries...</span>
        </div>
      )}

      {/* Missing binaries warning */}
      {!binariesStatus.loading && !hasRequiredBinaries() && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                Required Binaries Not Installed
              </h3>
              <p className="text-yellow-700 dark:text-yellow-300 mb-4">
                Before creating a project, you need to download the required binaries. Please install the following:
              </p>
              <ul className="list-disc list-inside text-yellow-700 dark:text-yellow-300 mb-4 space-y-1">
                {binariesStatus.php.length === 0 && (
                  <li><strong>PHP</strong> - At least one PHP version is required</li>
                )}
                {!binariesStatus.nginx && !binariesStatus.apache && (
                  <li><strong>Web Server</strong> - Nginx or Apache is required</li>
                )}
              </ul>
              <Link
                to="/binaries"
                className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Go to Binary Manager
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Show wizard only if binaries are available */}
      {!binariesStatus.loading && hasRequiredBinaries() && (
        <>
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
            availablePhpVersions={binariesStatus.php}
            setPathManuallySet={setPathManuallySet}
            defaultProjectsPath={defaultProjectsPath}
          />
        )}
        {currentStep === 2 && (
          <StepServices formData={formData} updateFormData={updateFormData} binariesStatus={binariesStatus} />
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
                {formData.installFresh && (formData.type === 'laravel' || formData.type === 'wordpress')
                  ? `Installing ${formData.type === 'laravel' ? 'Laravel' : 'WordPress'}...`
                  : 'Creating...'}
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
        </>
      )}
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

function StepDetails({ formData, updateFormData, onSelectPath, availablePhpVersions, setPathManuallySet, defaultProjectsPath }) {
  // Use available versions if provided, otherwise fall back to all versions
  const phpVersions = availablePhpVersions && availablePhpVersions.length > 0 
    ? PHP_VERSIONS.filter(v => availablePhpVersions.includes(v))
    : PHP_VERSIONS;
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
              onChange={(e) => {
                setPathManuallySet(true);
                updateFormData({ path: e.target.value });
              }}
              className="input flex-1"
              placeholder={defaultProjectsPath ? `${defaultProjectsPath}${navigator.platform.toLowerCase().includes('win') ? '\\' : '/'}your-project-name` : '/path/to/project'}
            />
            <button onClick={onSelectPath} className="btn-secondary">
              <Folder className="w-4 h-4" />
              Browse
            </button>
          </div>
          {!defaultProjectsPath && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
              Tip: Set a default projects directory in Settings to auto-generate paths
            </p>
          )}
        </div>

        <div>
          <label className="label">PHP Version</label>
          <div className="grid grid-cols-6 gap-2">
            {phpVersions.map((version) => (
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

        {/* Fresh Install Toggle */}
        {(formData.type === 'laravel' || formData.type === 'wordpress') && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.installFresh}
                onChange={(e) => updateFormData({ installFresh: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <span className="font-medium text-gray-900 dark:text-white">
                  Install Fresh {formData.type === 'laravel' ? 'Laravel' : 'WordPress'}
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formData.type === 'laravel' 
                    ? 'Run "composer create-project laravel/laravel" to set up a new Laravel installation'
                    : 'Download and install a fresh WordPress copy'}
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function StepServices({ formData, updateFormData, binariesStatus }) {
  const toggleService = (service) => {
    // For database selection, only allow one at a time
    if (service === 'mysql' || service === 'mariadb') {
      updateFormData({
        services: {
          ...formData.services,
          mysql: service === 'mysql' ? !formData.services.mysql : false,
          mariadb: service === 'mariadb' ? !formData.services.mariadb : false,
        },
      });
    } else {
      updateFormData({
        services: {
          ...formData.services,
          [service]: !formData.services[service],
        },
      });
    }
  };

  // Build services list dynamically based on installed binaries
  const allServices = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'Relational database for data storage',
      icon: '🗄️',
      installed: binariesStatus?.mysql,
      isDatabase: true,
    },
    {
      id: 'mariadb',
      name: 'MariaDB',
      description: 'MySQL-compatible database with extra features',
      icon: '🗃️',
      installed: binariesStatus?.mariadb,
      isDatabase: true,
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'In-memory cache and session storage',
      icon: '⚡',
      installed: binariesStatus?.redis,
    },
    {
      id: 'queue',
      name: 'Queue Worker',
      description: 'Background job processing (Laravel)',
      icon: '⚙️',
      laravelOnly: true,
      installed: true, // Always available if Laravel is selected
    },
  ];

  // Filter to show only installed services
  const services = allServices.filter(service => {
    // Queue worker is always available for Laravel projects
    if (service.id === 'queue') return true;
    // Show service if installed
    return service.installed;
  });

  // Check if any database is available
  const hasDatabaseOptions = binariesStatus?.mysql || binariesStatus?.mariadb;

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Configure Services
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Select the services you need for this project
      </p>

      {/* Database Section */}
      {hasDatabaseOptions && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Database
            <span className="text-xs font-normal text-gray-500">(select one)</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {services.filter(s => s.isDatabase).map((service) => (
              <button
                key={service.id}
                onClick={() => toggleService(service.id)}
                className={clsx(
                  'p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3',
                  formData.services[service.id]
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <div className="text-2xl">{service.icon}</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {service.name}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
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
            ))}
          </div>
        </div>
      )}

      {/* Other Services Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Additional Services
        </h3>
        {services.filter(s => !s.isDatabase).map((service) => {
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

      {/* No services warning */}
      {!hasDatabaseOptions && !binariesStatus?.redis && (
        <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            No database services installed. Visit the <Link to="/binaries" className="underline">Binary Manager</Link> to download MySQL or MariaDB.
          </p>
        </div>
      )}
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

        {/* Fresh Install Notice */}
        {formData.installFresh && (formData.type === 'laravel' || formData.type === 'wordpress') && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2">
              <span className="text-xl">📦</span>
              <div>
                <h3 className="font-medium text-blue-900 dark:text-blue-100">
                  Fresh {formData.type === 'laravel' ? 'Laravel' : 'WordPress'} Installation
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {formData.type === 'laravel' 
                    ? 'Will run "composer create-project", generate app key, and "npm install" to set up a complete Laravel application.'
                    : 'Will download and install a fresh WordPress copy.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreateProject;
