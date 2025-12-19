import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

const initialState = {
  projects: [],
  services: {},
  resourceUsage: { total: { cpu: 0, memory: 0 }, services: {} },
  settings: {},
  loading: true,
  error: null,
};

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.payload.id ? { ...p, ...action.payload } : p
        ),
      };
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.payload] };
    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.payload),
      };
    case 'SET_SERVICES':
      return { ...state, services: action.payload };
    case 'UPDATE_SERVICE':
      return {
        ...state,
        services: { ...state.services, [action.payload.name]: action.payload },
      };
    case 'SET_RESOURCE_USAGE':
      return { ...state, resourceUsage: action.payload };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Load initial data
  useEffect(() => {
    async function loadInitialData() {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });

        const [projects, services, settings] = await Promise.all([
          window.devbox?.projects.getAll() || [],
          window.devbox?.services.getStatus() || {},
          window.devbox?.settings.getAll() || {},
        ]);

        dispatch({ type: 'SET_PROJECTS', payload: projects });
        dispatch({ type: 'SET_SERVICES', payload: services });
        dispatch({ type: 'SET_SETTINGS', payload: settings });
      } catch (error) {
        console.error('Error loading initial data:', error);
        dispatch({ type: 'SET_ERROR', payload: error.message });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    loadInitialData();
  }, []);

  // Subscribe to events
  useEffect(() => {
    if (!window.devbox) return;

    window.devbox.on('project:statusChanged', (data) => {
      dispatch({ type: 'UPDATE_PROJECT', payload: data });
    });

    window.devbox.on('service:statusChanged', (data) => {
      dispatch({ type: 'UPDATE_SERVICE', payload: data });
    });

    window.devbox.on('resource:update', (data) => {
      dispatch({ type: 'SET_RESOURCE_USAGE', payload: data });
    });
  }, []);

  // Actions
  const refreshProjects = useCallback(async () => {
    try {
      const projects = await window.devbox?.projects.getAll();
      dispatch({ type: 'SET_PROJECTS', payload: projects || [] });
    } catch (error) {
      console.error('Error refreshing projects:', error);
    }
  }, []);

  const refreshServices = useCallback(async () => {
    try {
      const services = await window.devbox?.services.getStatus();
      dispatch({ type: 'SET_SERVICES', payload: services || {} });
    } catch (error) {
      console.error('Error refreshing services:', error);
    }
  }, []);

  const createProject = useCallback(async (config) => {
    const project = await window.devbox?.projects.create(config);
    if (project) {
      dispatch({ type: 'ADD_PROJECT', payload: project });
    }
    return project;
  }, []);

  const deleteProject = useCallback(async (id, deleteFiles = false) => {
    await window.devbox?.projects.delete(id, deleteFiles);
    dispatch({ type: 'REMOVE_PROJECT', payload: id });
  }, []);

  const startProject = useCallback(async (id) => {
    try {
      const result = await window.devbox?.projects.start(id);
      await refreshProjects();
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to start project:', error);
      await refreshProjects();
      return { success: false, error: error.message || 'Failed to start project' };
    }
  }, [refreshProjects]);

  const stopProject = useCallback(async (id) => {
    try {
      await window.devbox?.projects.stop(id);
      await refreshProjects();
      return { success: true };
    } catch (error) {
      console.error('Failed to stop project:', error);
      await refreshProjects();
      return { success: false, error: error.message || 'Failed to stop project' };
    }
  }, [refreshProjects]);

  const startService = useCallback(async (name, version = null) => {
    await window.devbox?.services.start(name, version);
    await refreshServices();
  }, [refreshServices]);

  const stopService = useCallback(async (name, version = null) => {
    await window.devbox?.services.stop(name, version);
    await refreshServices();
  }, [refreshServices]);

  const value = {
    ...state,
    dispatch,
    refreshProjects,
    refreshServices,
    createProject,
    deleteProject,
    startProject,
    stopProject,
    startService,
    stopService,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export default AppContext;
