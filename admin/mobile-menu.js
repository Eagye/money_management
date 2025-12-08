// Mobile Menu Toggle Functionality for Admin Pages
// This script should be included in all admin pages that use the sidebar

function initMobileMenu() {
    const menuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarCloseBtn');

    if (!menuToggle || !sidebar) {
        console.warn('Mobile menu elements not found');
        return;
    }

    function openMenu() {
        sidebar.classList.add('mobile-visible');
        if (overlay) overlay.classList.add('show');
        menuToggle.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
        sidebar.classList.remove('mobile-visible');
        if (overlay) overlay.classList.remove('show');
        menuToggle.classList.remove('active');
        document.body.style.overflow = '';
    }

    // Toggle button click
    menuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        if (sidebar.classList.contains('mobile-visible')) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    // Overlay click
    if (overlay) {
        overlay.addEventListener('click', closeMenu);
    }

    // Close button click
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMenu);
    }

    // Close menu when clicking on a menu item (mobile only)
    // Use event delegation to handle clicks without breaking existing listeners
    let menuItemCloseHandler = null;
    
    function setupMenuItemClose() {
        // Remove existing handler if any
        if (menuItemCloseHandler) {
            sidebar.removeEventListener('click', menuItemCloseHandler);
            menuItemCloseHandler = null;
        }
        
        if (window.innerWidth <= 768) {
            // Use event delegation on the sidebar to catch all menu item clicks
            menuItemCloseHandler = function(e) {
                const target = e.target.closest('.sidebar-menu-button, .dropdown-item, .submenu-item, .sidebar-menu a');
                
                if (!target) return;
                
                // Skip the overview button - it toggles the dropdown and should not close the menu
                if (target.id === 'overviewBtn') {
                    return;
                }
                
                // Skip dropdown parent items - they toggle submenus and should not close the menu
                if (target.classList.contains('dropdown-parent')) {
                    return;
                }
                
                // Close menu for submenu items (they navigate to pages)
                // Also close for other navigation items like logout that don't have the submenu-item class
                const isSubmenuItem = target.classList.contains('submenu-item');
                const isNavigationLink = target.tagName === 'A' && target.href && !target.href.includes('#');
                const isLogoutButton = target.id === 'logoutMenuItem';
                
                // Only close menu for items that actually navigate
                if (isSubmenuItem || isNavigationLink || isLogoutButton) {
                    // Small delay to allow navigation
                    setTimeout(closeMenu, 300);
                }
            };
            
            sidebar.addEventListener('click', menuItemCloseHandler);
        }
    }

    // Close menu on window resize if it becomes desktop
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            closeMenu();
        } else {
            setupMenuItemClose();
        }
    });

    // Setup menu item close handlers
    setupMenuItemClose();

    // Close menu on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-visible')) {
            closeMenu();
        }
    });
}

// Initialize mobile menu when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileMenu);
} else {
    initMobileMenu();
}

