// API Client for frontend
// Use relative path for API (works in both development and production)
// Can be overridden with window.API_BASE_URL for custom deployments
const API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) || 
                     (typeof window !== 'undefined' ? '/api' : 'http://localhost:3000/api');

// Get JWT token from localStorage
function getToken() {
    if (typeof window !== 'undefined') {
        const userData = localStorage.getItem('user');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                return user.token || null;
            } catch (e) {
                return null;
            }
        }
    }
    return null;
}

// Set token in localStorage
function setToken(token, userData) {
    if (typeof window !== 'undefined') {
        const user = { ...userData, token };
        localStorage.setItem('user', JSON.stringify(user));
        sessionStorage.removeItem('logoutReason');
        if (typeof window.resetIdleSessionTimer === 'function') {
            window.resetIdleSessionTimer();
        }
        if (typeof window.startIdleSessionWatch === 'function') {
            window.startIdleSessionWatch();
        }
    }
}

// Clear token
function clearToken() {
    if (typeof window !== 'undefined') {
        localStorage.removeItem('user');
    }
}

async function apiRequest(endpoint, options = {}) {
    if (typeof window.resetIdleSessionTimer === 'function') {
        window.resetIdleSessionTimer();
    }

    const fullUrl = `${API_BASE_URL}${endpoint}`;
    console.log('🌐 API Request:', options.method || 'GET', fullUrl);
    
    // Get token and add to headers
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    try {
        const response = await fetch(fullUrl, {
            headers,
            ...options
        });

        console.log('📥 API Response Status:', response.status, response.statusText);

        // Check if response is ok before parsing JSON
        if (!response.ok) {
            let errorMessage = 'Request failed';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
                console.error('❌ API Error Response:', errorData);
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                console.error('❌ API Error (non-JSON):', errorMessage);
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('✅ API Response Data:', data);
        
        // Handle 401 Unauthorized - token expired or invalid
        if (response.status === 401 || response.status === 403) {
            clearToken();
            if (typeof window !== 'undefined') {
                // Use absolute path for admin pages
                const isAdminPage = window.location.pathname.includes('/admin/');
                window.location.href = isAdminPage ? '/index.html' : 'index.html';
            }
            throw new Error('Session expired. Please login again.');
        }
        
        return data;
    } catch (error) {
        console.error('❌ API Request Error:', error);
        // Re-throw with a more user-friendly message if it's a network error
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error('Unable to connect to server. Please check your connection.');
        }
        throw error;
    }
}

// Client API
const ClientAPI = {
    getAll: () => apiRequest('/clients', { method: 'GET' }),
    
    getById: (id) => apiRequest(`/clients/${id}`, { method: 'GET' }),
    
    create: (clientData) => apiRequest('/clients', {
        method: 'POST',
        body: JSON.stringify(clientData)
    }),
    
    search: (searchTerm) => apiRequest(`/clients/search?q=${encodeURIComponent(searchTerm)}`, { method: 'GET' }),
    
    getStats: () => apiRequest('/clients/stats', { method: 'GET' }),
    
    getCommissionCycle: (id) => apiRequest(`/clients/${id}/commission-cycle`, { method: 'GET' }),
    
    getCommissionHistory: (id) => apiRequest(`/clients/${id}/commission-history`, { method: 'GET' }),
    
    updateRate: (id, rate, agentId) => apiRequest(`/clients/${id}/rate`, {
        method: 'PUT',
        body: JSON.stringify({ rate, agent_id: agentId })
    })
};

// Transaction API
const TransactionAPI = {
    create: (transactionData) => apiRequest('/transactions', {
        method: 'POST',
        body: JSON.stringify(transactionData)
    }),
    
    getByClientId: (clientId) => apiRequest(`/transactions/client/${clientId}`, { method: 'GET' }),
    
    getByDate: (date, options = {}) => {
        const params = new URLSearchParams({ date });
        if (options.limit != null) params.set('limit', String(options.limit));
        if (options.page != null) params.set('page', String(options.page));
        if (options.includeSummary === false) params.set('includeSummary', 'false');
        return apiRequest(`/transactions/date?${params.toString()}`, { method: 'GET' });
    },
    
    reverse: (transactionId, reason) => apiRequest(`/transactions/${transactionId}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason })
    })
};

// User/Auth API
const UserAPI = {
    register: (userData) => apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData)
    }),
    
    login: (credentials) => apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
    })
};

// Admin API
const AdminAPI = {
    getAgents: () => apiRequest('/admin/agents', { method: 'GET' }),
    getAgentStats: (agentId) => apiRequest(`/admin/agents/${agentId}/stats`, { method: 'GET' }),
    getAllClients: () => apiRequest('/admin/clients', { method: 'GET' }),
    updateClient: (clientId, name, phone) => apiRequest(`/admin/clients/${clientId}/update`, {
        method: 'PUT',
        body: JSON.stringify({ name, phone })
    }),
    getLargestDepositsByAgent: (date) => apiRequest(`/admin/deposits/largest?date=${date}`, { method: 'GET' }),
    getSmallestDepositsByAgent: (date) => apiRequest(`/admin/deposits/smallest?date=${date}`, { method: 'GET' }),
    getSmallestDailyDeposits: (date) => apiRequest(`/admin/deposits/smallest-daily?date=${date}`, { method: 'GET' }),
    getLargestAccountsByAgent: () => apiRequest('/admin/accounts/largest', { method: 'GET' }),
    getSmallestAccountsByAgent: () => apiRequest('/admin/accounts/smallest', { method: 'GET' }),
    getDormantAccountsByAgent: () => apiRequest('/admin/accounts/dormant', { method: 'GET' }),
    getActiveAccountsByAgent: (startDate, endDate) => apiRequest(`/admin/accounts/active?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getDailyDeposits: (date) => apiRequest(`/admin/deposits/daily?date=${date}`, { method: 'GET' }),
    getWeeklyDeposits: (startDate, endDate) => apiRequest(`/admin/deposits/weekly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getMonthlyDeposits: (startDate, endDate) => apiRequest(`/admin/deposits/monthly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getDailyWithdrawals: (date) => apiRequest(`/admin/withdrawals/daily?date=${date}`, { method: 'GET' }),
    getWeeklyWithdrawals: (startDate, endDate) => apiRequest(`/admin/withdrawals/weekly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getMonthlyWithdrawals: (startDate, endDate) => apiRequest(`/admin/withdrawals/monthly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getAgentClientWithdrawals: (agentId, startDate, endDate) => apiRequest(`/admin/withdrawals/weekly?agent_id=${agentId}&start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getAgentClientWithdrawalsMonthly: (agentId, startDate, endDate) => apiRequest(`/admin/withdrawals/monthly?agent_id=${agentId}&start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    createWithdrawal: (withdrawalData) => apiRequest('/admin/withdrawals', {
        method: 'POST',
        body: JSON.stringify(withdrawalData)
    }),
    updateDailyStatus: (payload) => apiRequest('/admin/deposits/daily/status', {
        method: 'POST',
        body: JSON.stringify(payload)
    }),
    getDailyCommission: (date) => apiRequest(`/admin/commission/daily?date=${date}`, { method: 'GET' }),
    getWeeklyCommission: (startDate, endDate) => apiRequest(`/admin/commission/weekly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getMonthlyCommission: (startDate, endDate) => apiRequest(`/admin/commission/monthly?start_date=${startDate}&end_date=${endDate}`, { method: 'GET' }),
    getPendingCommissionCycles: () => apiRequest('/admin/commission-cycles/pending', { method: 'GET' }),
    getDashboardStats: () => apiRequest('/admin/dashboard/stats', { method: 'GET' }),
    getTodayStats: (date) => apiRequest(`/admin/dashboard/today-stats${date ? `?date=${date}` : ''}`, { method: 'GET' }),
    resetCommissionCycle: (clientId) => apiRequest(`/admin/commission-cycles/${clientId}/reset`, { method: 'POST' }),
    adjustCommissionCycle: (clientId, cumulativeWithdrawal) => apiRequest(`/admin/commission-cycles/${clientId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ cumulative_withdrawal: cumulativeWithdrawal })
    }),
    createAdmin: (adminData) => apiRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify(adminData)
    })
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.ClientAPI = ClientAPI;
    window.TransactionAPI = TransactionAPI;
    window.UserAPI = UserAPI;
    window.AdminAPI = AdminAPI;
    window.getToken = getToken;
    window.setToken = setToken;
    window.clearToken = clearToken;
}

// Auto logout after 5 minutes of inactivity (agent + admin pages)
(function initIdleSessionTimeout() {
    if (typeof window === 'undefined') {
        return;
    }

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    const MOUSEMOVE_THROTTLE_MS = 2000;
    const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'];

    let idleTimer = null;
    let isLoggingOut = false;
    let lastMouseReset = 0;
    let listenersAttached = false;

    function isPublicPage() {
        const path = window.location.pathname.toLowerCase();
        return path === '/' ||
            path.endsWith('/index.html') ||
            path.endsWith('index.html') ||
            path.endsWith('/register_agent.html') ||
            path.endsWith('register_agent.html');
    }

    function hasActiveSession() {
        return !!getToken();
    }

    function redirectToLoginAfterIdle() {
        const loginPath = '/index.html';
        if (window.location.pathname.toLowerCase().endsWith('index.html') ||
            window.location.pathname === '/') {
            return;
        }
        window.location.href = loginPath;
    }

    function logoutDueToIdle() {
        if (isLoggingOut || !hasActiveSession()) {
            return;
        }
        isLoggingOut = true;
        clearTimeout(idleTimer);
        clearToken();
        sessionStorage.removeItem('user');
        sessionStorage.setItem('logoutReason', 'idle');
        redirectToLoginAfterIdle();
    }

    function resetIdleTimer() {
        if (isPublicPage() || !hasActiveSession() || isLoggingOut) {
            return;
        }
        clearTimeout(idleTimer);
        idleTimer = setTimeout(logoutDueToIdle, IDLE_TIMEOUT_MS);
    }

    function onActivity(event) {
        if (event && event.type === 'mousemove') {
            const now = Date.now();
            if (now - lastMouseReset < MOUSEMOVE_THROTTLE_MS) {
                return;
            }
            lastMouseReset = now;
        }
        resetIdleTimer();
    }

    function attachActivityListeners() {
        if (listenersAttached) {
            return;
        }
        listenersAttached = true;
        ACTIVITY_EVENTS.forEach((eventName) => {
            window.addEventListener(eventName, onActivity, { passive: true, capture: true });
        });
        window.addEventListener('mousemove', onActivity, { passive: true, capture: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                resetIdleTimer();
            }
        });
    }

    function startIdleWatch() {
        if (isPublicPage() || !hasActiveSession()) {
            return;
        }
        attachActivityListeners();
        resetIdleTimer();
    }

    function bootstrap() {
        startIdleWatch();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

    window.resetIdleSessionTimer = resetIdleTimer;
    window.startIdleSessionWatch = startIdleWatch;
})();
