// Custom Dialog Component
class Dialog {
    static show(options) {
        const {
            title = 'Notification',
            message = '',
            type = 'info', // 'success', 'error', 'info'
            confirmText = 'OK',
            cancelText = 'Cancel',
            showCancel = false,
            onConfirm = null,
            onCancel = null
        } = options;

        // Remove existing dialog if any
        const existingDialog = document.getElementById('dialogOverlay');
        if (existingDialog) {
            existingDialog.remove();
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.id = 'dialogOverlay';

        // Create dialog box
        const dialogBox = document.createElement('div');
        dialogBox.className = 'dialog-box';

        // Icon mapping
        const icons = {
            success: '✓',
            error: '✗',
            info: 'ℹ'
        };

        // Create dialog HTML
        dialogBox.innerHTML = `
            <div class="dialog-header">
                <div class="dialog-icon ${type}">
                    ${icons[type] || icons.info}
                </div>
                <h3 class="dialog-title">${title}</h3>
            </div>
            <div class="dialog-body">
                ${message}
            </div>
            <div class="dialog-footer">
                ${showCancel ? `<button class="dialog-btn dialog-btn-secondary" id="dialogCancel">${cancelText}</button>` : ''}
                <button class="dialog-btn dialog-btn-primary" id="dialogConfirm">${confirmText}</button>
            </div>
        `;

        overlay.appendChild(dialogBox);
        document.body.appendChild(overlay);

        // Show dialog with animation
        setTimeout(() => {
            overlay.classList.add('show');
        }, 10);

        // Handle confirm button
        const confirmBtn = document.getElementById('dialogConfirm');
        confirmBtn.addEventListener('click', () => {
            Dialog.close();
            if (onConfirm) {
                onConfirm();
            }
        });

        // Handle cancel button
        if (showCancel) {
            const cancelBtn = document.getElementById('dialogCancel');
            cancelBtn.addEventListener('click', () => {
                Dialog.close();
                if (onCancel) {
                    onCancel();
                }
            });
        }

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                Dialog.close();
                if (onCancel) {
                    onCancel();
                }
            }
        });

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                Dialog.close();
                if (onCancel) {
                    onCancel();
                }
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    static close() {
        const overlay = document.getElementById('dialogOverlay');
        if (overlay) {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
            }, 300);
        }
    }

    // Convenience methods
    static success(message, title = 'Success') {
        Dialog.show({
            title,
            message,
            type: 'success'
        });
    }

    static error(message, title = 'Error') {
        Dialog.show({
            title,
            message,
            type: 'error'
        });
    }

    static info(message, title = 'Information') {
        Dialog.show({
            title,
            message,
            type: 'info'
        });
    }

    static warning(message, title = 'Warning') {
        Dialog.show({
            title,
            message,
            type: 'error' // Use error styling for warnings
        });
    }

    static confirm(message, title = 'Confirm', onConfirm = null, onCancel = null) {
        Dialog.show({
            title,
            message,
            type: 'info',
            showCancel: true,
            onConfirm,
            onCancel
        });
    }
}

// Make Dialog available globally
if (typeof window !== 'undefined') {
    window.Dialog = Dialog;
}

