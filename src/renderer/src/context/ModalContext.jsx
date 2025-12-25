import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertModal, ConfirmModal } from '../components/Modal';

const ModalContext = createContext(null);

/**
 * ModalProvider - Provides modal functionality throughout the app
 * 
 * Wrap your app with this provider to use showAlert and showConfirm hooks.
 * These replace window.alert() and window.confirm() which cause focus bugs in Electron.
 */
export function ModalProvider({ children }) {
    // Alert state
    const [alertState, setAlertState] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'info',
        resolve: null,
    });

    // Confirm state
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        title: '',
        message: '',
        detail: '',
        type: 'question',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        confirmStyle: 'primary',
        resolve: null,
    });

    /**
     * Show an alert modal
     * @param {string|object} options - Message string or options object
     * @returns {Promise<void>} - Resolves when user clicks OK
     * 
     * Usage:
     *   await showAlert('Something happened!');
     *   await showAlert({ title: 'Error', message: 'Failed to save', type: 'error' });
     */
    const showAlert = useCallback((options) => {
        return new Promise((resolve) => {
            if (typeof options === 'string') {
                setAlertState({
                    isOpen: true,
                    title: 'Alert',
                    message: options,
                    type: 'info',
                    resolve,
                });
            } else {
                setAlertState({
                    isOpen: true,
                    title: options.title || 'Alert',
                    message: options.message || '',
                    type: options.type || 'info',
                    resolve,
                });
            }
        });
    }, []);

    /**
     * Show a confirm modal
     * @param {string|object} options - Message string or options object
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
     * 
     * Usage:
     *   const confirmed = await showConfirm('Are you sure?');
     *   const confirmed = await showConfirm({
     *     title: 'Delete Item',
     *     message: 'Are you sure you want to delete this item?',
     *     detail: 'This action cannot be undone.',
     *     confirmText: 'Delete',
     *     confirmStyle: 'danger',
     *     type: 'warning'
     *   });
     */
    const showConfirm = useCallback((options) => {
        return new Promise((resolve) => {
            if (typeof options === 'string') {
                setConfirmState({
                    isOpen: true,
                    title: 'Confirm',
                    message: options,
                    detail: '',
                    type: 'question',
                    confirmText: 'Confirm',
                    cancelText: 'Cancel',
                    confirmStyle: 'primary',
                    resolve,
                });
            } else {
                setConfirmState({
                    isOpen: true,
                    title: options.title || 'Confirm',
                    message: options.message || '',
                    detail: options.detail || '',
                    type: options.type || 'question',
                    confirmText: options.confirmText || 'Confirm',
                    cancelText: options.cancelText || 'Cancel',
                    confirmStyle: options.confirmStyle || 'primary',
                    resolve,
                });
            }
        });
    }, []);

    const handleAlertClose = useCallback(() => {
        alertState.resolve?.();
        setAlertState(prev => ({ ...prev, isOpen: false }));
    }, [alertState.resolve]);

    const handleConfirm = useCallback(() => {
        confirmState.resolve?.(true);
        setConfirmState(prev => ({ ...prev, isOpen: false }));
    }, [confirmState.resolve]);

    const handleCancel = useCallback(() => {
        confirmState.resolve?.(false);
        setConfirmState(prev => ({ ...prev, isOpen: false }));
    }, [confirmState.resolve]);

    return (
        <ModalContext.Provider value={{ showAlert, showConfirm }}>
            {children}

            <AlertModal
                isOpen={alertState.isOpen}
                onClose={handleAlertClose}
                title={alertState.title}
                message={alertState.message}
                type={alertState.type}
            />

            <ConfirmModal
                isOpen={confirmState.isOpen}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                title={confirmState.title}
                message={confirmState.message}
                detail={confirmState.detail}
                type={confirmState.type}
                confirmText={confirmState.confirmText}
                cancelText={confirmState.cancelText}
                confirmStyle={confirmState.confirmStyle}
            />
        </ModalContext.Provider>
    );
}

/**
 * Hook to access modal functions
 * @returns {{ showAlert: Function, showConfirm: Function }}
 */
export function useModal() {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error('useModal must be used within a ModalProvider');
    }
    return context;
}

export default ModalProvider;
