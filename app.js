// API Client must be loaded first
let allClients = [];

// Format currency
function formatCurrency(amount) {
    return `₵${parseFloat(amount || 0).toFixed(2)}`;
}

// Format phone number (from digits to XXX-XXX-XXXX)
function formatPhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
    return phone; // Return as-is if not 10 digits
}

// Render a single client card
function renderClient(client) {
    return `
        <div class="client-card" data-client-id="${client.id}">
            <div class="client-header">
                <h2 class="client-name">${client.name}</h2>
            </div>
            <div class="client-details">
                <div class="detail-item">
                    <span class="detail-label">Rate:</span>
                    <span class="detail-value">${formatCurrency(client.rate)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Phone:</span>
                    <span class="detail-value">${formatPhone(client.phone)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Gender:</span>
                    <span class="detail-value">${client.gender}</span>
                </div>
            </div>
            <div class="client-balance">
                <div class="balance-label">CURRENT BALANCE</div>
                <div class="balance-amount">${formatCurrency(client.current_balance)}</div>
            </div>
            <div class="client-actions">
                <button class="btn btn-primary btn-sm" onclick="addDeposit(${client.id})">Add Deposit</button>
                <button class="btn btn-primary btn-sm" onclick="viewClient(${client.id})">View</button>
            </div>
        </div>
    `;
}

// Render all clients
function renderClients(clients, isSearch = false) {
    const container = document.getElementById('clientsContainer');
    const loadingMessage = document.getElementById('loadingMessage');
    const emptyMessage = document.getElementById('emptyMessage');

    // Hide loading message
    if (loadingMessage) loadingMessage.style.display = 'none';

    if (!clients || clients.length === 0) {
        // Show empty message
        if (emptyMessage) {
            if (isSearch) {
                // Message is already set in searchClients function
                if (!emptyMessage.textContent) {
                    emptyMessage.textContent = 'No clients found';
                }
                emptyMessage.style.display = 'block';
            } else {
                emptyMessage.textContent = 'No clients registered yet. Click "Register New" to add your first client.';
                emptyMessage.style.display = 'block';
            }
        } else {
            // Create empty message if it doesn't exist
            const msg = document.createElement('div');
            msg.id = 'emptyMessage';
            msg.style.cssText = 'text-align: center; padding: 40px; color: var(--text-secondary);';
            msg.textContent = isSearch ? 'No clients found' : 'No clients registered yet. Click "Register New" to add your first client.';
            container.innerHTML = '';
            container.appendChild(msg);
        }
        return;
    }

    // Hide empty message
    if (emptyMessage) emptyMessage.style.display = 'none';

    // Render clients
    container.innerHTML = clients.map(client => renderClient(client)).join('');
}

// Load clients from API
async function loadClients() {
    try {
        const response = await ClientAPI.getAll();
        if (response.success) {
            // Handle paginated response
            allClients = response.data || response;
            renderClients(allClients);
            await updateStatistics();
        }
    } catch (error) {
        console.error('Error loading clients:', error);
        const container = document.getElementById('clientsContainer');
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) loadingMessage.style.display = 'none';
        
        // Check if it's an auth error
        if (error.message && error.message.includes('Session expired')) {
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Your session has expired. Please login again.', 'Session Expired');
            }
            if (typeof redirectToLogin !== 'undefined') {
                redirectToLogin();
            } else {
                window.location.href = 'index.html';
            }
            return;
        }
        
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--danger-color);">
                Error loading clients. Please refresh the page.
            </div>
        `;
        if (typeof Dialog !== 'undefined') {
            Dialog.error('Failed to load clients. Please check your connection and try again.', 'Loading Error');
        }
    }
}

// Update statistics
async function updateStatistics() {
    try {
        const response = await ClientAPI.getStats();
        if (response.success) {
            const stats = response.data;
            document.getElementById('totalClients').textContent = stats.total_clients || 0;
            document.getElementById('femaleCount').textContent = stats.female_count || 0;
            document.getElementById('maleCount').textContent = stats.male_count || 0;
            document.getElementById('otherCount').textContent = stats.other_count || 0;
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// Search clients
async function searchClients(searchTerm) {
    const trimmedTerm = searchTerm ? searchTerm.trim() : '';
    
    // If search is empty, show all clients
    if (!trimmedTerm) {
        renderClients(allClients, false);
        await updateStatistics();
        return;
    }

    try {
        console.log('🔍 Frontend: Starting search for:', trimmedTerm);
        
        // Simple search: send the search term as-is to the backend
        // The backend will search both name and phone fields using LIKE
        const response = await ClientAPI.search(trimmedTerm);
        
        console.log('📡 Frontend: Received response:', response);
        
        if (!response) {
            throw new Error('No response from server');
        }
        
        if (response.success === false) {
            throw new Error(response.error || 'Search failed');
        }
        
        if (!response.success) {
            // Handle case where success is undefined but data exists
            if (response.data) {
                console.log('⚠️ Response missing success flag but has data');
            } else {
                throw new Error('Invalid response format');
            }
        }
        
        const results = response.data || [];
        console.log('✅ Frontend: Found', results.length, 'clients');
        
        if (results.length === 0) {
            console.log('ℹ️ No results found for:', trimmedTerm);
        } else {
            console.log('📋 Results:', results.map(c => ({ id: c.id, name: c.name, phone: c.phone })));
        }
        
        // Update empty message for search results
        const emptyMessage = document.getElementById('emptyMessage');
        if (emptyMessage) {
            if (results.length === 0) {
                emptyMessage.textContent = `No clients found matching "${trimmedTerm}"`;
            } else {
                emptyMessage.style.display = 'none';
            }
        }
        
        renderClients(results, true);
        
    } catch (error) {
        console.error('❌ Frontend: Search error:', error);
        const errorMessage = error.message || 'Failed to search clients. Please try again.';
        Dialog.error(errorMessage, 'Search Error');
        
        // On error, show all clients
        renderClients(allClients, false);
    }
}

// Refresh clients
async function refreshClients() {
    await loadClients();
}

// Make functions available globally
if (typeof window !== 'undefined') {
    window.refreshClients = refreshClients;
    window.loadClients = loadClients;
}

// Client action functions
async function addDeposit(clientId) {
    try {
        // Get client data to know the rate
        const response = await ClientAPI.getById(clientId);
        if (response && response.success && response.data) {
            const client = response.data;
            DepositDialog.show(clientId, client.rate, client.name);
        } else {
            Dialog.error('Failed to load client information', 'Error');
        }
    } catch (error) {
        console.error('Error loading client:', error);
        Dialog.error('Failed to load client information. Please try again.', 'Error');
    }
}

async function viewClient(clientId) {
    console.log('View client clicked:', clientId);
    console.log('ViewClientDialog available:', typeof ViewClientDialog !== 'undefined');
    console.log('Dialog available:', typeof Dialog !== 'undefined');
    console.log('ClientAPI available:', typeof ClientAPI !== 'undefined');
    
    if (typeof ViewClientDialog !== 'undefined') {
        try {
            await ViewClientDialog.show(clientId);
        } catch (error) {
            console.error('Error showing view dialog:', error);
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Failed to show client details. Please try again.', 'Error');
            } else {
                alert('Failed to show client details: ' + error.message);
            }
        }
    } else {
        console.error('ViewClientDialog is not defined');
        if (typeof Dialog !== 'undefined') {
            Dialog.error('View dialog not loaded. Please refresh the page.', 'Error');
        } else {
            alert('View dialog not loaded. Please refresh the page.');
        }
    }
}

// Make functions globally available
if (typeof window !== 'undefined') {
    window.viewClient = viewClient;
    window.addDeposit = addDeposit;
    
    // Also make day view function available
    window.openDayView = function() {
        const datePicker = document.getElementById('datePicker');
        const selectedDate = datePicker ? datePicker.value : null;
        console.log('openDayView called, selected date:', selectedDate);
        
        if (!selectedDate) {
            if (typeof Dialog !== 'undefined') {
                Dialog.error('Please select a date first', 'Date Required');
            } else {
                alert('Please select a date first');
            }
            return;
        }

        const url = `day_view.html?date=${selectedDate}`;
        console.log('Navigating to:', url);
        window.location.href = url;
    };
}

// Load and display agent name
function setAgentDisplayName(name) {
    const agentNameElement = document.getElementById('agentName');
    const sidebarName = document.getElementById('agentNameSidebar');
    if (agentNameElement) {
        agentNameElement.textContent = name;
    }
    if (sidebarName) {
        sidebarName.textContent = name;
    }
}

function loadAgentName() {
    try {
        const userData = localStorage.getItem('user');
        if (userData) {
            const user = JSON.parse(userData);
            setAgentDisplayName(user.name || 'Agent');
        } else {
            setAgentDisplayName('Guest');
        }
    } catch (error) {
        console.error('Error loading agent name:', error);
        setAgentDisplayName('Agent');
    }
}

function closeAgentMenuIfOpen() {
    if (typeof window.closeAgentMenu === 'function') {
        window.closeAgentMenu();
    }
}

function showSearchDialog() {
    if (typeof Dialog === 'undefined') {
        const term = prompt('Search by name or phone:');
        if (term !== null) {
            searchClients(term);
        }
        return;
    }

    const inputId = 'searchDialogInput';
    Dialog.show({
        title: 'Search Clients',
        message: `<input type="text" id="${inputId}" class="search-dialog-input" placeholder="Search by name or phone" autocomplete="off">`,
        type: 'info',
        confirmText: 'Search',
        cancelText: 'Cancel',
        showCancel: true,
        onConfirm: () => {
            const input = document.getElementById(inputId);
            searchClients(input ? input.value : '');
        }
    });

    setTimeout(() => {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('dialogConfirm')?.click();
            }
        });
    }, 50);
}

if (typeof window !== 'undefined') {
    window.showSearchDialog = showSearchDialog;
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const searchBtn = document.getElementById('searchBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const dayViewBtn = document.getElementById('dayViewBtn');

    // Load and display agent name
    loadAgentName();

    // Set today's date as default
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        const today = new Date().toISOString().split('T')[0];
        datePicker.value = today;
    }

    // Load clients on page load
    loadClients();

    // Register New button
    if (registerBtn) {
        registerBtn.addEventListener('click', function() {
            closeAgentMenuIfOpen();
            window.location.href = 'register_client.html';
        });
    }

    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            closeAgentMenuIfOpen();
            // Clear user session and token
            if (typeof clearToken !== 'undefined') {
                clearToken();
            } else {
                localStorage.removeItem('user');
                sessionStorage.removeItem('user');
            }
            // Redirect to login page
            window.location.href = 'index.html';
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', showSearchDialog);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            refreshClients();
        });
    }

    // Day View button
    if (dayViewBtn) {
        console.log('Day View button found, attaching click handler');
        
        function handleDayViewClick(e) {
            console.log('Day View button clicked!');
            closeAgentMenuIfOpen();

            const datePicker = document.getElementById('datePicker');
            if (!datePicker) {
                console.error('Date picker not found!');
                if (typeof Dialog !== 'undefined') {
                    Dialog.error('Date picker not found. Please refresh the page.', 'Error');
                } else {
                    alert('Date picker not found. Please refresh the page.');
                }
                return false;
            }
            
            const selectedDate = datePicker.value;
            console.log('Selected date:', selectedDate);
            
            if (!selectedDate) {
                console.warn('No date selected');
                if (typeof Dialog !== 'undefined') {
                    Dialog.error('Please select a date first', 'Date Required');
                } else {
                    alert('Please select a date first');
                }
                return false;
            }

            // Navigate to day view page with selected date
            const url = `day_view.html?date=${selectedDate}`;
            console.log('Navigating to:', url);
            console.log('Current location:', window.location.href);
            
            // Direct navigation
            window.location.href = url;
            return false; // Prevent any default behavior
        }
        
        dayViewBtn.addEventListener('click', handleDayViewClick);
        dayViewBtn.onclick = handleDayViewClick;
        
        // Also make it available globally
        if (typeof window !== 'undefined') {
            window.openDayView = handleDayViewClick;
        }
    } else {
        console.error('Day View button not found!');
    }
});
