import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';
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
  Server,
  Layers,
  Code,
  GitBranch,
  Key,
  Copy,
  Lock,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';

// Framework icons as SVG components
const LaravelIcon = ({ className }) => (
  <svg viewBox="0 0 50 52" className={className} fill="currentColor">
    <path d="M49.626 11.564a.809.809 0 0 1 .028.209v10.972a.8.8 0 0 1-.402.694l-9.209 5.302V39.25c0 .286-.152.55-.4.694L20.42 51.01c-.044.025-.092.041-.14.058-.018.006-.035.017-.054.022a.805.805 0 0 1-.41 0c-.022-.006-.042-.018-.063-.026-.044-.016-.09-.03-.132-.054L.402 39.944A.801.801 0 0 1 0 39.25V6.334c0-.072.01-.142.028-.21.006-.023.02-.044.028-.067.015-.042.029-.085.051-.124.015-.026.037-.047.055-.071.023-.032.044-.065.071-.093.023-.023.053-.04.079-.06.029-.024.055-.05.088-.069h.001l9.61-5.533a.802.802 0 0 1 .8 0l9.61 5.533h.002c.032.02.059.045.088.068.026.02.055.038.078.06.028.029.048.062.072.094.017.024.04.045.054.071.023.04.036.082.052.124.008.023.022.044.028.068a.809.809 0 0 1 .028.209v20.559l8.008-4.611v-10.51c0-.07.01-.141.028-.208.007-.024.02-.045.028-.068.016-.042.03-.085.052-.124.015-.026.037-.047.054-.071.024-.032.044-.065.072-.093.023-.023.052-.04.078-.06.03-.024.056-.05.088-.069h.001l9.611-5.533a.801.801 0 0 1 .8 0l9.61 5.533c.034.02.06.045.09.068.025.02.054.038.077.06.028.029.048.062.072.094.018.024.04.045.054.071.023.039.036.082.052.124.009.023.022.044.028.068zm-1.574 10.718v-9.124l-3.363 1.936-4.646 2.675v9.124l8.01-4.611zm-9.61 16.505v-9.13l-4.57 2.61-13.05 7.448v9.216l17.62-10.144zM1.602 7.719v31.068L19.22 48.93v-9.214l-9.204-5.209-.003-.002-.004-.002c-.031-.018-.057-.044-.086-.066-.025-.02-.054-.036-.076-.058l-.002-.003c-.026-.025-.044-.056-.066-.084-.02-.027-.044-.05-.06-.078l-.001-.003c-.018-.03-.029-.066-.042-.1-.013-.03-.03-.058-.038-.09v-.001c-.01-.038-.012-.078-.016-.117-.004-.03-.012-.06-.012-.09v-.002-21.481L4.965 9.654 1.602 7.72zm8.81-5.994L2.405 6.334l8.005 4.609 8.006-4.61-8.006-4.608zm4.164 28.764l4.645-2.674V7.719l-3.363 1.936-4.646 2.675v20.096l3.364-1.937zM39.243 7.164l-8.006 4.609 8.006 4.609 8.005-4.61-8.005-4.608zm-.801 10.605l-4.646-2.675-3.363-1.936v9.124l4.645 2.674 3.364 1.937v-9.124zM20.02 38.33l11.743-6.704 5.87-3.35-8-4.606-9.211 5.303-8.395 4.833 7.993 4.524z" />
  </svg>
);

const SymfonyIcon = ({ className }) => (
  <svg viewBox="0 0 512 512" className={className} fill="currentColor">
    <path d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8zm133.74 143.54c-11.47.41-19.4-6.45-19.77-16.87-.27-9.18 6.68-13.44 6.53-18.85-.23-6.55-10.16-6.82-12.87-6.67-39.78 1.29-48.59 57-58.89 113.85 21.43 3.15 36.65-.72 45.14-6.22 12-7.75-3.34-15.72-1.42-24.56 4-18.16 32.55-19 32 5.3-.36 17.86-25.92 41.81-77.6 35.7-10.76 59.52-18.35 115-58.2 161.72-29 34.46-58.4 39.82-71.58 40.26-24.65.85-41-12.31-41.58-29.84-.56-17 14.45-26.26 24.31-26.59 21.89-.75 30.12 25.67 14.88 34-12.09 9.71.11 12.61 2.05 12.55 10.42-.36 17.34-5.51 22.18-9 24-17.56 43.1-71.07 51.58-107.34-32.48-4.94-43.32-31.5-43.1-53.86.17-17.88 9.77-57.39 93.88-57.39 14.27 0 25.59 1.64 34.51 4.06 9.61-59.95 19-82.3 63.24-82.8 21.73-.25 33.67 9.52 33.83 25.06.33 31.55-50.83 34.9-50.24.03z" />
  </svg>
);

const WordPressIcon = ({ className }) => (
  <svg viewBox="0 0 512 512" className={className} fill="currentColor">
    <path d="M61.7 169.4l101.5 278C92.2 413 43.3 340.2 43.3 256c0-30.9 6.6-60.1 18.4-86.6zm337.9 75.9c0-26.3-9.4-44.5-17.5-58.7-10.8-17.5-20.9-32.4-20.9-49.9 0-19.6 14.8-37.8 35.7-37.8.9 0 1.8.1 2.8.2-37.9-34.7-88.3-55.9-143.7-55.9-74.3 0-139.7 38.1-177.8 95.9 5 .2 9.7.3 13.7.3 22.2 0 56.7-2.7 56.7-2.7 11.5-.7 12.8 16.2 1.4 17.5 0 0-11.5 1.3-24.3 2l77.5 230.4L249.8 247l-33.1-90.8c-11.5-.7-22.3-2-22.3-2-11.5-.7-10.1-18.2 1.3-17.5 0 0 35.1 2.7 56 2.7 22.2 0 56.7-2.7 56.7-2.7 11.5-.7 12.8 16.2 1.4 17.5 0 0-11.5 1.3-24.3 2l76.9 228.7 21.2-70.9c9-29.4 16-50.5 16-68.7zm-139.9 29.3l-63.8 185.5c19.1 5.6 39.2 8.7 60.1 8.7 24.8 0 48.5-4.3 70.6-12.1-.6-.9-1.1-1.9-1.5-2.9l-65.4-179.2zm183-120.7c.9 6.8 1.4 14 1.4 21.9 0 21.6-4 45.8-16.2 76.2l-65 187.9C426.2 403 468.7 334.5 468.7 256c0-37-9.4-71.8-26-102.1zM504 256c0 136.8-111.3 248-248 248C119.2 504 8 392.7 8 256 8 119.2 119.2 8 256 8c136.7 0 248 111.2 248 248zm-11.4 0c0-130.5-106.2-236.6-236.6-236.6C125.5 19.4 19.4 125.5 19.4 256S125.6 492.6 256 492.6c130.5 0 236.6-106.1 236.6-236.6z" />
  </svg>
);

const PhpIcon = ({ className }) => (
  <svg viewBox="0 0 640 512" className={className} fill="currentColor">
    <path d="M320 104.5c171.4 0 303.2 72.2 303.2 151.5S491.3 407.5 320 407.5c-171.4 0-303.2-72.2-303.2-151.5S148.7 104.5 320 104.5m0-16.8C143.3 87.7 0 163 0 256s143.3 168.3 320 168.3S640 349 640 256 496.7 87.7 320 87.7zM218.2 242.5c-7.9 40.5-35.8 36.3-70.1 36.3l13.7-70.6c38 0 63.8-4.1 56.4 34.3zM97.4 350.3h36.7l8.7-44.8c41.1 0 66.6 3 90.2-19.1 26.1-24 32.9-66.7 14.3-88.1-9.7-11.2-25.3-16.7-46.5-16.7h-70.7L97.4 350.3zm185.7-213.6h36.5l-8.7 44.8c31.5 0 60.7-2.3 74.8 10.7 14.8 13.6 7.7 31-8.3 113.1h-37c15.4-79.4 18.3-86 12.7-92-5.4-5.8-17.7-4.6-47.4-4.6l-18.8 96.6h-36.5l32.7-168.6zM505 242.5c-8 41.1-36.7 36.3-70.1 36.3l13.7-70.6c38.2 0 63.8-4.1 56.4 34.3zM384.2 350.3H421l8.7-44.8c43.2 0 67.1 2.5 90.2-19.1 26.1-24 32.9-66.7 14.3-88.1-9.7-11.2-25.3-16.7-46.5-16.7H417l-32.8 168.7z" />
  </svg>
);

const NodeJsIcon = ({ className }) => (
  <svg viewBox="0 0 448 512" className={className} fill="currentColor">
    <path d="M224 508c-6.7 0-13.5-1.8-19.4-5.2l-61.7-36.5c-9.2-5.2-4.7-7-1.7-8 12.3-4.3 14.8-5.2 27.9-12.7 1.4-.8 3.2-.5 4.6.4l47.4 28.1c1.7 1 4.1 1 5.7 0l184.7-106.6c1.7-1 2.8-3 2.8-5V149.3c0-2.1-1.1-4-2.9-5.1L226.8 37.7c-1.7-1-4-1-5.7 0L36.6 144.3c-1.8 1-2.9 3-2.9 5.1v213.1c0 2 1.1 4 2.9 4.9l50.6 29.2c27.5 13.7 44.3-2.4 44.3-18.7V167.5c0-3 2.4-5.3 5.4-5.3h23.4c2.9 0 5.4 2.3 5.4 5.3V378c0 36.6-20 57.6-54.7 57.6-10.7 0-19.1 0-42.5-11.6l-48.4-27.9C8.1 389.2.7 376.3.7 362.4V149.3c0-13.8 7.4-26.8 19.4-33.7L204.6 8.9c11.7-6.6 27.2-6.6 38.8 0l184.7 106.7c12 6.9 19.4 19.8 19.4 33.7v213.1c0 13.8-7.4 26.7-19.4 33.7L243.4 502.8c-5.9 3.4-12.6 5.2-19.4 5.2zm149.1-210.1c0-39.9-27-50.5-83.7-58-57.4-7.6-63.2-11.5-63.2-24.9 0-11.1 4.9-25.9 47.4-25.9 37.9 0 51.9 8.2 57.7 33.8.5 2.4 2.7 4.2 5.2 4.2h24c1.5 0 2.9-.6 3.9-1.7s1.5-2.6 1.4-4.1c-3.7-44.1-33-64.6-92.2-64.6-52.7 0-84.1 22.2-84.1 59.5 0 40.4 31.3 51.6 81.8 56.6 60.5 5.9 65.2 14.8 65.2 26.7 0 20.6-16.6 29.4-55.5 29.4-48.9 0-59.6-12.3-63.2-36.6-.4-2.6-2.6-4.5-5.3-4.5h-23.9c-3 0-5.3 2.4-5.3 5.3 0 31.1 16.9 68.2 97.8 68.2 58.4-.1 92-23.2 92-63.4z" />
  </svg>
);

const PROJECT_TYPES = [
  {
    id: 'laravel',
    name: 'Laravel',
    description: 'Full-stack PHP framework with Eloquent ORM',
    icon: LaravelIcon,
    iconColor: 'text-red-500',
    features: ['Artisan CLI', 'Queue Workers', 'Scheduler'],
  },
  {
    id: 'symfony',
    name: 'Symfony',
    description: 'Professional PHP framework for web applications',
    icon: SymfonyIcon,
    iconColor: 'text-yellow-500',
    features: ['Console Commands', 'Doctrine ORM'],
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Popular CMS for websites and blogs',
    icon: WordPressIcon,
    iconColor: 'text-blue-500',
    features: ['WP-CLI Support', 'Multisite Ready'],
  },
  {
    id: 'custom',
    name: 'Custom PHP',
    description: 'Any PHP application or framework',
    icon: PhpIcon,
    iconColor: 'text-indigo-500',
    features: ['Flexible Configuration'],
  },
];

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
  const [serviceConfig, setServiceConfig] = useState({
    versions: { php: [], mysql: [], mariadb: [], redis: [], nginx: [], apache: [], nodejs: [] },
    portOffsets: {},
    defaultPorts: {},
  });
  const [binariesStatus, setBinariesStatus] = useState({
    loading: true,
    php: [],
    nginx: false,
    apache: false,
    mysql: false,
    mariadb: false,
    redis: false,
    nodejs: [],
    git: false, // Track Git availability
  });
  const [gitStatus, setGitStatus] = useState({ available: false, source: null, checking: true });
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    type: 'laravel',
    phpVersion: '8.4',
    installFresh: true, // Install fresh Laravel/WordPress
    services: {
      mysql: true,
      mysqlVersion: '8.4',
      mariadb: false,
      mariadbVersion: '11.4',
      redis: false,
      redisVersion: '7.4',
      nodejs: false,
      nodejsVersion: '20',
      queue: false,
    },
    domain: '',
    ssl: true,
    webServer: 'nginx', // 'nginx' or 'apache'
    webServerVersion: '1.28',
    // Git clone options
    projectSource: 'new', // 'new' or 'clone'
    repositoryUrl: '',
    authType: 'public', // 'public', 'token', 'ssh'
    accessToken: '',
  });
  const [compatibilityWarnings, setCompatibilityWarnings] = useState([]);
  const [sshKeyInfo, setSshKeyInfo] = useState({ exists: false, publicKey: '' });
  const [testingAuth, setTestingAuth] = useState(false);
  const [authTestResult, setAuthTestResult] = useState(null);
  const [generatingSshKey, setGeneratingSshKey] = useState(false);
  const [sshKeyError, setSshKeyError] = useState(null);

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
        // Error loading settings
      }
    };
    loadDefaultPath();
  }, []);

  // Load service configuration
  useEffect(() => {
    const loadServiceConfig = async () => {
      try {
        const config = await window.devbox?.binaries.getServiceConfig();
        if (config) {
          setServiceConfig(config);
        }
      } catch (error) {
        // Error loading service config
      }
    };
    loadServiceConfig();
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
          // PHP versions
          const phpVersions = Object.entries(status.php || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);

          // MySQL versions
          const mysqlVersions = Object.entries(status.mysql || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);

          // MariaDB versions
          const mariadbVersions = Object.entries(status.mariadb || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);

          // Redis versions
          const redisVersions = Object.entries(status.redis || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);

          // Node.js versions
          const nodejsVersions = Object.entries(status.nodejs || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version);

          // Nginx versions - sorted descending (latest first)
          const nginxVersions = Object.entries(status.nginx || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version)
            .sort((a, b) => parseFloat(b) - parseFloat(a));

          // Apache versions - sorted descending (latest first)
          const apacheVersions = Object.entries(status.apache || {})
            .filter(([_, info]) => info.installed)
            .map(([version]) => version)
            .sort((a, b) => parseFloat(b) - parseFloat(a));

          setBinariesStatus({
            loading: false,
            php: phpVersions,
            mysql: mysqlVersions,
            mariadb: mariadbVersions,
            redis: redisVersions,
            nodejs: nodejsVersions,
            nginx: nginxVersions,
            apache: apacheVersions,
            git: status.git || false,
          });

          // Set default versions to first available
          const updates = {};
          if (phpVersions.length > 0 && !phpVersions.includes(formData.phpVersion)) {
            updates.phpVersion = phpVersions[0];
          }
          if (mysqlVersions.length > 0 && !mysqlVersions.includes(formData.services.mysqlVersion)) {
            updates.services = { ...formData.services, mysqlVersion: mysqlVersions[0] };
          }
          if (nginxVersions.length > 0 && !nginxVersions.includes(formData.webServerVersion) && formData.webServer === 'nginx') {
            updates.webServerVersion = nginxVersions[0];
          }
          if (Object.keys(updates).length > 0) {
            updateFormData(updates);
          }
        } else {
          setBinariesStatus(prev => ({ ...prev, loading: false }));
        }
      } catch (error) {
        // Error checking binaries
        setBinariesStatus(prev => ({ ...prev, loading: false }));
      }
    };
    checkBinaries();
  }, []);

  // Check Git availability (system or portable)
  useEffect(() => {
    const checkGit = async () => {
      try {
        const result = await window.devbox?.git?.isAvailable();
        setGitStatus({
          available: result?.available || false,
          source: result?.source || null,
          version: result?.version || null,
          checking: false,
        });

        // Also check for existing SSH key
        if (result?.available) {
          const sshResult = await window.devbox?.git?.getSshPublicKey();
          if (sshResult?.exists) {
            setSshKeyInfo({ exists: true, publicKey: sshResult.publicKey });
          }
        }
      } catch (error) {
        setGitStatus({ available: false, source: null, checking: false });
      }
    };
    checkGit();
  }, []);

  // Check compatibility when form changes
  useEffect(() => {
    const checkCompat = async () => {
      try {
        const config = {
          phpVersion: formData.phpVersion,
          mysqlVersion: formData.services.mysql ? formData.services.mysqlVersion : null,
          mariadbVersion: formData.services.mariadb ? formData.services.mariadbVersion : null,
          redisVersion: formData.services.redis ? formData.services.redisVersion : null,
          nodeVersion: formData.services.nodejs ? formData.services.nodejsVersion : null,
          webServer: formData.webServer,
          webServerVersion: formData.webServerVersion,
          projectType: formData.type,
        };
        const result = await window.devbox?.projects.checkCompatibility(config);
        if (result?.warnings) {
          setCompatibilityWarnings(result.warnings);
        } else {
          setCompatibilityWarnings([]);
        }
      } catch (error) {
        // Error checking compatibility
      }
    };
    checkCompat();
  }, [formData.phpVersion, formData.services, formData.type]);

  // Check if required binaries are available
  const hasRequiredBinaries = () => {
    return binariesStatus.php.length > 0 && (binariesStatus.nginx.length > 0 || binariesStatus.apache.length > 0);
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
        // Require name, path, and at least one PHP version installed
        return !!formData.name && !!formData.path && binariesStatus.php.length > 0;
      case 2:
        return true;
      case 3:
        // Require at least one web server installed
        return (binariesStatus.nginx && binariesStatus.nginx.length > 0) ||
          (binariesStatus.apache && binariesStatus.apache.length > 0);
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

    // Reset and show installation progress if installing fresh OR cloning from repository
    const shouldShowProgress =
      (formData.installFresh && (formData.type === 'laravel' || formData.type === 'wordpress')) ||
      (formData.projectSource === 'clone' && formData.repositoryUrl);

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
        // Ensure clone config is explicitly passed
        projectSource: formData.projectSource,
        repositoryUrl: formData.repositoryUrl,
        authType: formData.authType,
        accessToken: formData.accessToken,
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
      // Error creating project
      if (shouldShowProgress) {
        setInstallOutput((prev) => [...prev, { text: `Error: ${error.message}`, type: 'error' }]);
        setInstallComplete(true);
        setInstallError(true);
      } else {
        // Note: Can't use useModal here since this is in the parent component
        // For now we show the error in the install progress modal
        setInstallOutput((prev) => [...prev, { text: `Error: ${error.message}`, type: 'error' }]);
        setShowInstallProgress(true);
        setInstallComplete(true);
        setInstallError(true);
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

  const handleFixManually = () => {
    setShowInstallProgress(false);
    if (createdProject) {
      // Navigate to the project so user can fix it manually
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
        projectName={formData.name}
        onClose={handleInstallClose}
        onFixManually={createdProject ? handleFixManually : null}
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
                serviceConfig={serviceConfig}
                gitStatus={gitStatus}
                sshKeyInfo={sshKeyInfo}
                setSshKeyInfo={setSshKeyInfo}
                testingAuth={testingAuth}
                setTestingAuth={setTestingAuth}
                authTestResult={authTestResult}
                setAuthTestResult={setAuthTestResult}
                generatingSshKey={generatingSshKey}
                sshKeyError={sshKeyError}
                setGeneratingSshKey={setGeneratingSshKey}
                setSshKeyError={setSshKeyError}
              />
            )}
            {currentStep === 2 && (
              <StepServices
                formData={formData}
                updateFormData={updateFormData}
                binariesStatus={binariesStatus}
                serviceConfig={serviceConfig}
              />
            )}
            {currentStep === 3 && (
              <StepDomain
                formData={formData}
                updateFormData={updateFormData}
                binariesStatus={binariesStatus}
                serviceConfig={serviceConfig}
              />
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
        {PROJECT_TYPES.map((type) => {
          const IconComponent = type.icon;
          return (
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
              <div className="mb-3">
                <IconComponent className={clsx('w-10 h-10', type.iconColor)} />
              </div>
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
          );
        })}
      </div>
    </div>
  );
}

function StepDetails({
  formData,
  updateFormData,
  onSelectPath,
  availablePhpVersions,
  setPathManuallySet,
  defaultProjectsPath,
  serviceConfig,
  gitStatus,
  sshKeyInfo,
  setSshKeyInfo,
  testingAuth,
  setTestingAuth,
  authTestResult,
  setAuthTestResult,
  generatingSshKey,
  sshKeyError,
  setGeneratingSshKey,
  setSshKeyError,
}) {
  const { showConfirm } = useModal();

  // Use available (installed) versions - these already include custom imported versions
  // Sort them in descending order (newest first)
  const phpVersions = (availablePhpVersions || []).slice().sort((a, b) => {
    const aNum = parseFloat(a) || 0;
    const bNum = parseFloat(b) || 0;
    return bNum - aNum;
  });
  const hasNoPhpInstalled = phpVersions.length === 0;

  // Handle repository URL change with auto-extraction of project name
  const handleRepoUrlChange = (url) => {
    updateFormData({ repositoryUrl: url });
    setAuthTestResult(null);

    // Try to extract project name from URL
    if (url && !formData.name) {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) {
        const projectName = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        updateFormData({ name: projectName, repositoryUrl: url });
      }
    }
  };

  // Handle test connection
  const handleTestConnection = async () => {
    if (!formData.repositoryUrl) return;

    setTestingAuth(true);
    setAuthTestResult(null);

    try {
      const result = await window.devbox?.git?.testAuth(formData.repositoryUrl, {
        authType: formData.authType,
        accessToken: formData.accessToken,
      });
      setAuthTestResult(result);
    } catch (error) {
      setAuthTestResult({ success: false, error: error.message });
    } finally {
      setTestingAuth(false);
    }
  };

  // Handle SSH key generation
  const handleGenerateSshKey = async () => {
    setGeneratingSshKey(true);
    setSshKeyError(null);

    try {
      const result = await window.devbox?.git?.generateSshKey();
      if (result?.success) {
        setSshKeyInfo({ exists: true, publicKey: result.publicKey });
      } else {
        setSshKeyError(result?.error || 'Failed to generate SSH key');
      }
    } catch (error) {
      setSshKeyError(error.message || 'Failed to generate SSH key');
    } finally {
      setGeneratingSshKey(false);
    }
  };

  // Handle copy SSH key to clipboard
  const handleCopySshKey = () => {
    if (sshKeyInfo.publicKey) {
      navigator.clipboard.writeText(sshKeyInfo.publicKey);
    }
  };

  // Handle regenerate SSH key
  const handleRegenerateSshKey = async () => {
    // Use custom modal instead of window.confirm() to avoid Electron focus issues
    const confirmed = await showConfirm({
      type: 'warning',
      title: 'Regenerate SSH Key',
      message: 'Are you sure you want to generate a new SSH key?',
      detail: 'You will need to update your Git provider with the new public key.',
      confirmText: 'Regenerate',
      confirmStyle: 'warning',
    });

    if (!confirmed) {
      return;
    }

    setGeneratingSshKey(true);
    setSshKeyError(null);

    try {
      const result = await window.devbox?.git?.regenerateSshKey();
      if (result?.success) {
        setSshKeyInfo({ exists: true, publicKey: result.publicKey });
      } else {
        setSshKeyError(result?.error || 'Failed to regenerate SSH key');
      }
    } catch (error) {
      setSshKeyError(error.message || 'Failed to regenerate SSH key');
    } finally {
      setGeneratingSshKey(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Project Details
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Configure the basic settings for your project
      </p>

      <div className="space-y-6">
        {/* Project Source Selection - Only for Laravel/custom projects */}
        {(formData.type === 'laravel' || formData.type === 'custom') && (
          <div>
            <label className="label">Project Source</label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => updateFormData({ projectSource: 'new', repositoryUrl: '', authType: 'public' })}
                className={clsx(
                  'p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3',
                  formData.projectSource === 'new'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <Plus className="w-6 h-6 text-primary-500" />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Create New</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Start a fresh project</p>
                </div>
              </button>
              <button
                onClick={() => updateFormData({ projectSource: 'clone', installFresh: false })}
                disabled={gitStatus?.checking}
                className={clsx(
                  'p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3',
                  formData.projectSource === 'clone'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                  gitStatus?.checking && 'opacity-50 cursor-not-allowed'
                )}
              >
                <GitBranch className="w-6 h-6 text-green-500" />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Clone Repository</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {gitStatus?.checking ? 'Checking Git...' : 'From GitHub, GitLab, etc.'}
                  </p>
                </div>
              </button>
            </div>

            {/* Git not available warning */}
            {formData.projectSource === 'clone' && !gitStatus?.available && !gitStatus?.checking && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Git is not installed</span>
                </div>
                <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                  Install Git from the Binary Manager or ensure it's in your system PATH.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Repository URL input - only shown for clone */}
        {formData.projectSource === 'clone' && gitStatus?.available && (
          <>
            <div>
              <label className="label">Repository URL</label>
              <input
                type="text"
                value={formData.repositoryUrl}
                onChange={(e) => handleRepoUrlChange(e.target.value)}
                className="input"
                placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Enter the full URL to clone the repository
              </p>
            </div>

            {/* Authentication Type */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <label className="label mb-3">Authentication</label>
              <div className="space-y-3">
                {/* Public */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.authType === 'public'}
                    onChange={() => updateFormData({ authType: 'public', accessToken: '' })}
                    className="w-4 h-4 text-primary-600"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900 dark:text-white">Public Repository</span>
                    <p className="text-sm text-gray-500 dark:text-gray-400">No authentication required</p>
                  </div>
                </label>

                {/* Access Token */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.authType === 'token'}
                    onChange={() => updateFormData({ authType: 'token' })}
                    className="w-4 h-4 text-primary-600 mt-1"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900 dark:text-white">Personal Access Token</span>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">For private repositories (HTTPS)</p>
                    {formData.authType === 'token' && (
                      <input
                        type="password"
                        value={formData.accessToken}
                        onChange={(e) => updateFormData({ accessToken: e.target.value })}
                        className="input w-full"
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      />
                    )}
                  </div>
                </label>

                {/* SSH */}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.authType === 'ssh'}
                    onChange={() => updateFormData({ authType: 'ssh' })}
                    className="w-4 h-4 text-primary-600 mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white">SSH Key</span>
                      <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                        More Secure
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">For private repositories (SSH)</p>
                    {formData.authType === 'ssh' && (
                      <div className="space-y-2">
                        {sshKeyInfo.exists ? (
                          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Public Key (add this to your Git provider)
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleCopySshKey}
                                  className="btn-sm btn-secondary"
                                  title="Copy to clipboard"
                                >
                                  <Copy className="w-4 h-4" />
                                  Copy
                                </button>
                                <button
                                  onClick={handleRegenerateSshKey}
                                  disabled={generatingSshKey}
                                  className="btn-sm btn-secondary"
                                  title="Generate a new SSH key"
                                >
                                  {generatingSshKey ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-4 h-4" />
                                  )}
                                  New Key
                                </button>
                              </div>
                            </div>
                            <code className="text-xs text-gray-600 dark:text-gray-400 break-all block">
                              {sshKeyInfo.publicKey}
                            </code>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <button
                              onClick={handleGenerateSshKey}
                              disabled={generatingSshKey}
                              className="btn-secondary"
                            >
                              {generatingSshKey ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Key className="w-4 h-4" />
                                  Generate SSH Key
                                </>
                              )}
                            </button>
                            {sshKeyError && (
                              <p className="text-sm text-red-600 dark:text-red-400">
                                {sshKeyError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {/* Test Connection Button */}
              {formData.repositoryUrl && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleTestConnection}
                      disabled={testingAuth}
                      className="btn-secondary"
                    >
                      {testingAuth ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Test Connection
                        </>
                      )}
                    </button>
                    {authTestResult && (
                      <span className={clsx(
                        'text-sm font-medium',
                        authTestResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      )}>
                        {authTestResult.success ? '✓ Connected successfully!' : `✗ ${authTestResult.error}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

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
          {hasNoPhpInstalled ? (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-medium">No PHP versions installed</span>
              </div>
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                Please install at least one PHP version from the Binary Manager before creating a project.
              </p>
            </div>
          ) : (
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
          )}
        </div>

        {/* Fresh Install Toggle - only for new projects */}
        {formData.projectSource === 'new' && (formData.type === 'laravel' || formData.type === 'wordpress') && (
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
    // For database services (mysql/mariadb), make selection mutually exclusive
    if (service === 'mysql' || service === 'mariadb') {
      const otherDb = service === 'mysql' ? 'mariadb' : 'mysql';
      const isEnabling = !formData.services[service];

      updateFormData({
        services: {
          ...formData.services,
          [service]: isEnabling,
          // If enabling this database, disable the other one
          ...(isEnabling ? { [otherDb]: false } : {}),
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

  const updateServiceVersion = (service, version) => {
    updateFormData({
      services: {
        ...formData.services,
        [`${service}Version`]: version,
      },
    });
  };

  // Build services list dynamically based on installed binaries
  const allServices = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'Relational database for data storage',
      icon: '🗄️',
      versions: binariesStatus?.mysql || [],
      isDatabase: true,
    },
    {
      id: 'mariadb',
      name: 'MariaDB',
      description: 'MySQL-compatible database with extra features',
      icon: '🗃️',
      versions: binariesStatus?.mariadb || [],
      isDatabase: true,
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'In-memory cache and session storage',
      icon: '⚡',
      versions: binariesStatus?.redis || [],
    },
    {
      id: 'nodejs',
      name: 'Node.js',
      description: 'JavaScript runtime for frontend builds',
      icon: <NodeJsIcon className="w-6 h-6 text-green-600" />,
      versions: binariesStatus?.nodejs || [],
    },
    {
      id: 'queue',
      name: 'Queue Worker',
      description: 'Background job processing (Laravel)',
      icon: '⚙️',
      laravelOnly: true,
      versions: ['enabled'], // Always available if Laravel is selected
    },
  ];

  // Filter to show only services with at least one version installed
  const services = allServices.filter(service => {
    // Queue worker is always available for Laravel projects
    if (service.id === 'queue') return true;
    // Show service if any versions installed
    return service.versions && service.versions.length > 0;
  });

  // Check if any database is available
  const hasDatabaseOptions = (binariesStatus?.mysql?.length > 0) || (binariesStatus?.mariadb?.length > 0);

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Configure Services
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        Select the services and versions you need for this project
      </p>

      {/* Database Section */}
      {hasDatabaseOptions && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Database
            <span className="text-xs font-normal text-gray-500">(select one)</span>
          </h3>
          <div className="grid gap-3">
            {services.filter(s => s.isDatabase).map((service) => (
              <div
                key={service.id}
                className={clsx(
                  'p-4 rounded-xl border-2 transition-all',
                  formData.services[service.id]
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                )}
              >
                <button
                  onClick={() => toggleService(service.id)}
                  className="w-full flex items-center gap-3 text-left"
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
                {/* Version selector - shown when service is enabled */}
                {formData.services[service.id] && service.versions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <label className="text-xs text-gray-500 mb-2 block">Version</label>
                    <div className="flex gap-2 flex-wrap">
                      {service.versions.map(version => (
                        <button
                          key={version}
                          onClick={(e) => { e.stopPropagation(); updateServiceVersion(service.id, version); }}
                          className={clsx(
                            'px-3 py-1 rounded text-sm font-medium transition-all',
                            formData.services[`${service.id}Version`] === version
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          )}
                        >
                          {version}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
            <div
              key={service.id}
              className={clsx(
                'p-4 rounded-xl border-2 transition-all',
                disabled
                  ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700'
                  : formData.services[service.id]
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <button
                onClick={() => !disabled && toggleService(service.id)}
                disabled={disabled}
                className="w-full flex items-center gap-4 text-left"
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
              {/* Version selector for Redis */}
              {service.id === 'redis' && formData.services[service.id] && service.versions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <label className="text-xs text-gray-500 mb-2 block">Version</label>
                  <div className="flex gap-2 flex-wrap">
                    {service.versions.map(version => (
                      <button
                        key={version}
                        onClick={(e) => { e.stopPropagation(); updateServiceVersion(service.id, version); }}
                        className={clsx(
                          'px-3 py-1 rounded text-sm font-medium transition-all',
                          formData.services[`${service.id}Version`] === version
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        )}
                      >
                        {version}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Version selector for Node.js */}
              {service.id === 'nodejs' && formData.services[service.id] && service.versions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <label className="text-xs text-gray-500 mb-2 block">Version</label>
                  <div className="flex gap-2 flex-wrap">
                    {service.versions.map(version => (
                      <button
                        key={version}
                        onClick={(e) => { e.stopPropagation(); updateServiceVersion(service.id, version); }}
                        className={clsx(
                          'px-3 py-1 rounded text-sm font-medium transition-all',
                          formData.services[`${service.id}Version`] === version
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        )}
                      >
                        {version}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* No services warning */}
      {!hasDatabaseOptions && !(binariesStatus?.redis?.length > 0) && (
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

function StepDomain({ formData, updateFormData, binariesStatus, serviceConfig }) {
  const suggestedDomain = formData.name
    ? `${formData.name.toLowerCase().replace(/\s+/g, '-')}.test`
    : '';

  // Check if web servers are installed
  const nginxInstalled = binariesStatus.nginx && binariesStatus.nginx.length > 0;
  const apacheInstalled = binariesStatus.apache && binariesStatus.apache.length > 0;

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
              onClick={() => nginxInstalled && updateFormData({
                webServer: 'nginx',
                webServerVersion: binariesStatus.nginx?.[0] || '1.28'
              })}
              disabled={!nginxInstalled}
              className={clsx(
                'p-4 rounded-xl border-2 text-left transition-all',
                !nginxInstalled && 'opacity-50 cursor-not-allowed',
                formData.webServer === 'nginx'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <div className="flex items-center gap-3">
                <Server className="w-6 h-6 text-green-500" />
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Nginx</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    High performance, low memory usage
                  </p>
                </div>
              </div>
              {!nginxInstalled ? (
                <div className="mt-2 flex items-center gap-1 text-amber-600 dark:text-amber-400 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Not installed
                </div>
              ) : formData.webServer === 'nginx' ? (
                <div className="mt-2 flex items-center gap-1 text-primary-600 dark:text-primary-400 text-sm">
                  <Check className="w-4 h-4" />
                  Selected
                </div>
              ) : null}
            </button>

            <button
              onClick={() => apacheInstalled && updateFormData({
                webServer: 'apache',
                webServerVersion: binariesStatus.apache?.[0] || '2.4'
              })}
              disabled={!apacheInstalled}
              className={clsx(
                'p-4 rounded-xl border-2 text-left transition-all',
                !apacheInstalled && 'opacity-50 cursor-not-allowed',
                formData.webServer === 'apache'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              )}
            >
              <div className="flex items-center gap-3">
                <Layers className="w-6 h-6 text-orange-500" />
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Apache</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    .htaccess support, flexibility
                  </p>
                </div>
              </div>
              {!apacheInstalled ? (
                <div className="mt-2 flex items-center gap-1 text-amber-600 dark:text-amber-400 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Not installed
                </div>
              ) : formData.webServer === 'apache' ? (
                <div className="mt-2 flex items-center gap-1 text-primary-600 dark:text-primary-400 text-sm">
                  <Check className="w-4 h-4" />
                  Selected
                </div>
              ) : null}
            </button>
          </div>

          {/* Version selector for selected web server */}
          {formData.webServer === 'nginx' && binariesStatus.nginx?.length > 1 && (
            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <label className="text-xs text-gray-600 dark:text-gray-400 mb-2 block">Nginx Version</label>
              <div className="flex gap-2 flex-wrap">
                {binariesStatus.nginx.map(version => (
                  <button
                    key={version}
                    onClick={() => updateFormData({ webServerVersion: version })}
                    className={clsx(
                      'px-3 py-1.5 rounded text-sm font-medium transition-all',
                      formData.webServerVersion === version
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    )}
                  >
                    {version}
                  </button>
                ))}
              </div>
            </div>
          )}

          {formData.webServer === 'apache' && binariesStatus.apache?.length > 1 && (
            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <label className="text-xs text-gray-600 dark:text-gray-400 mb-2 block">Apache Version</label>
              <div className="flex gap-2 flex-wrap">
                {binariesStatus.apache.map(version => (
                  <button
                    key={version}
                    onClick={() => updateFormData({ webServerVersion: version })}
                    className={clsx(
                      'px-3 py-1.5 rounded text-sm font-medium transition-all',
                      formData.webServerVersion === version
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    )}
                  >
                    {version}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Warning if no web servers installed */}
          {!nginxInstalled && !apacheInstalled && (
            <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>No web server installed. Please install Nginx or Apache from the Binary Manager.</span>
              </div>
            </div>
          )}
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
              {formData.webServer === 'nginx' ? 'Nginx' : 'Apache'}
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
                    ? `Will run "composer create-project" and generate app key${formData.services.nodejs ? ', then "npm install"' : ''} to set up a complete Laravel application.`
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
