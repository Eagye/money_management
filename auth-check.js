// Authentication check for protected pages
(function() {
    // Check if user is authenticated and approved
    async function checkAuth() {
        if (typeof window === 'undefined') return;
        
        // Get token from localStorage
        const userData = localStorage.getItem('user');
        if (!userData) {
            redirectToLogin();
            return false;
        }
        
        try {
            const user = JSON.parse(userData);
            if (!user.token) {
                redirectToLogin();
                return false;
            }
            
            // Check if user is admin (admins don't need approval check)
            const isAdmin = user.isAdmin || false;
            
            // For non-admin users, check if they are approved
            if (!isAdmin) {
                const isApproved = user.isApproved !== undefined ? user.isApproved : true; // Default to true for backward compatibility
                if (!isApproved) {
                    // User is not approved, redirect to login with message
                    localStorage.removeItem('user');
                    if (typeof Dialog !== 'undefined') {
                        Dialog.error('Your account is pending approval. Please wait for an administrator to approve your account.', 'Account Pending Approval');
                    } else {
                        alert('Your account is pending approval. Please wait for an administrator to approve your account.');
                    }
                    setTimeout(() => {
                        window.location.href = '/index.html';
                    }, 2000);
                    return false;
                }
            }
            
            // Optional: Verify token is not expired (basic check)
            // Full verification happens on server
            return true;
        } catch (e) {
            redirectToLogin();
            return false;
        }
    }
    
    function redirectToLogin() {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('user');
            // Use absolute path to ensure redirect goes to root
            window.location.href = '/index.html';
        }
    }
    
    // Export for use in other scripts
    if (typeof window !== 'undefined') {
        window.checkAuth = checkAuth;
        window.redirectToLogin = redirectToLogin;
        
        // Auto-check on page load for protected pages
        // Only check if not on login or register pages
        const currentPage = window.location.pathname;
        const publicPages = ['index.html', 'register_agent.html'];
        const isPublicPage = publicPages.some(page => currentPage.includes(page));
        
        if (!isPublicPage) {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => checkAuth());
            } else {
                checkAuth();
            }
        }
    }
})();

