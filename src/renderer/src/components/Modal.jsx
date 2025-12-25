import React, { useEffect, useRef } from 'react';
import { X, AlertTriangle, Info, CheckCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Custom Alert Modal - Replaces window.alert() to avoid Electron focus bugs
 * 
 * Usage:
 *   const { showAlert } = useModal();
 *   await showAlert('Something happened!');
 *   await showAlert({ title: 'Error', message: 'Failed to save', type: 'error' });
 */
export function AlertModal({ isOpen, onClose, title, message, type = 'info' }) {
    const buttonRef = useRef(null);

    useEffect(() => {
        if (isOpen && buttonRef.current) {
            buttonRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const icons = {
        info: Info,
        success: CheckCircle,
        warning: AlertTriangle,
        error: AlertCircle,
    };

    const iconColors = {
        info: 'text-blue-500',
        success: 'text-green-500',
        warning: 'text-amber-500',
        error: 'text-red-500',
    };

    const Icon = icons[type] || icons.info;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <Icon className={clsx('w-5 h-5', iconColors[type])} />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex-1">
                        {title || 'Alert'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-4">
                    <p className="text-gray-600 dark:text-gray-400">{message}</p>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                    <button
                        ref={buttonRef}
                        onClick={onClose}
                        className="btn-primary"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Custom Confirm Modal - Replaces window.confirm() to avoid Electron focus bugs
 * 
 * Usage:
 *   const { showConfirm } = useModal();
 *   const confirmed = await showConfirm('Are you sure?');
 *   const confirmed = await showConfirm({ 
 *     title: 'Delete Item', 
 *     message: 'This action cannot be undone',
 *     confirmText: 'Delete',
 *     confirmStyle: 'danger'
 *   });
 */
export function ConfirmModal({
    isOpen,
    onConfirm,
    onCancel,
    title,
    message,
    detail,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmStyle = 'primary', // 'primary', 'danger', 'warning'
    type = 'question' // 'question', 'warning', 'danger'
}) {
    const confirmButtonRef = useRef(null);

    useEffect(() => {
        if (isOpen && confirmButtonRef.current) {
            confirmButtonRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onCancel();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const icons = {
        question: Info,
        warning: AlertTriangle,
        danger: AlertCircle,
    };

    const iconColors = {
        question: 'text-blue-500',
        warning: 'text-amber-500',
        danger: 'text-red-500',
    };

    const buttonStyles = {
        primary: 'btn-primary',
        danger: 'btn-danger',
        warning: 'px-4 py-2 rounded-lg font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors inline-flex items-center gap-2',
    };

    const Icon = icons[type] || icons.question;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onCancel}
            />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <Icon className={clsx('w-5 h-5', iconColors[type])} />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex-1">
                        {title || 'Confirm'}
                    </h3>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-4">
                    <p className="text-gray-600 dark:text-gray-400">{message}</p>
                    {detail && (
                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">{detail}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="btn-secondary"
                    >
                        {cancelText}
                    </button>
                    <button
                        ref={confirmButtonRef}
                        onClick={onConfirm}
                        className={buttonStyles[confirmStyle] || buttonStyles.primary}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default { AlertModal, ConfirmModal };
