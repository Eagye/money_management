// System toast notifications (non-blocking, auto-dismiss)
class Toast {
    static ensureContainer() {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-atomic', 'true');
            document.body.appendChild(container);
        }
        return container;
    }

    static show(message, type = 'success', duration = 5000) {
        const container = Toast.ensureContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', 'status');

        const icons = {
            success: '✓',
            error: '✗',
            warning: '!',
            info: 'i'
        };

        toast.innerHTML = `
            <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
            <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>
        `;

        const dismiss = () => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        };

        toast.querySelector('.toast-close').addEventListener('click', dismiss);
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }

        return dismiss;
    }

    static success(message, duration) {
        return Toast.show(message, 'success', duration);
    }

    static error(message, duration) {
        return Toast.show(message, 'error', duration);
    }

    static warning(message, duration) {
        return Toast.show(message, 'warning', duration);
    }

    static info(message, duration) {
        return Toast.show(message, 'info', duration);
    }
}

if (typeof window !== 'undefined') {
    window.Toast = Toast;
}
