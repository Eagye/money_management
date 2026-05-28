// Mobile sidebar menu for agent pages (same pattern as admin)

function initAgentMobileMenu() {
    const menuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('agentSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarCloseBtn');

    if (!menuToggle || !sidebar) {
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

    menuToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (sidebar.classList.contains('mobile-visible')) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    if (overlay) {
        overlay.addEventListener('click', closeMenu);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeMenu);
    }

    sidebar.addEventListener('click', function (e) {
        const target = e.target.closest('.sidebar-menu-button');
        if (!target || window.innerWidth > 768) {
            return;
        }
        setTimeout(closeMenu, 200);
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > 768) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-visible')) {
            closeMenu();
        }
    });

    window.closeAgentMenu = closeMenu;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAgentMobileMenu);
} else {
    initAgentMobileMenu();
}
