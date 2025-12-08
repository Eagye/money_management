const { Client, Transaction, User, AgentDailyStatus, CommissionCycle } = require('./database');
const url = require('url');
const zlib = require('zlib');
const { 
    generateToken, 
    hashPassword, 
    comparePassword, 
    authenticateToken 
} = require('./auth');
const logger = require('./logger');
const { getConfig } = require('./config');
const { sendTransactionMessage, sendWelcomeMessage } = require('./messaging');

// Load environment variables
require('dotenv').config();

const config = getConfig();
const ADMIN_EMAIL = config.adminEmail;

// CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
function setCORSHeaders(req, res) {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (process.env.NODE_ENV === 'development') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// Parse JSON body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Authentication middleware wrapper
function requireAuth(req, res, next) {
    authenticateToken(req, res, () => {
        next();
    });
}

async function ensureAdmin(req, res) {
    if (!req.user) {
        res.writeHead(403);
        res.end(JSON.stringify({ success: false, error: 'Admin privileges required' }));
        return false;
    }
    
    // Get user from database to check is_admin flag
    const user = await User.getByEmail(req.user.email);
    if (!user || !user.is_admin) {
        res.writeHead(403);
        res.end(JSON.stringify({ success: false, error: 'Admin privileges required' }));
        return false;
    }
    
    return true;
}

// API Routes Handler
async function handleAPI(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;
    
    // Set CORS headers
    setCORSHeaders(req, res);

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Set JSON content type
    res.setHeader('Content-Type', 'application/json');
    
    // Helper function to send JSON response with compression
    const sendJSON = (statusCode, data) => {
        const jsonString = JSON.stringify(data);
        const acceptEncoding = req.headers['accept-encoding'] || '';
        
        if (acceptEncoding.includes('gzip')) {
            zlib.gzip(jsonString, (err, compressed) => {
                if (err) {
                    logger.error('Compression error', { error: err.message });
                    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                    res.end(jsonString, 'utf-8');
                } else {
                    res.writeHead(statusCode, {
                        'Content-Type': 'application/json',
                        'Content-Encoding': 'gzip'
                    });
                    res.end(compressed, 'utf-8');
                }
            });
        } else {
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(jsonString, 'utf-8');
        }
    };
    
    // Health check endpoint (no auth required)
    if (path === '/api/health' && method === 'GET') {
        (async () => {
            try {
                const { getDatabase } = require('./database');
                const fs = require('fs');
                const path = require('path');
                const db = getDatabase();
                
                // Check database connectivity
                let dbHealthy = false;
                try {
                    await new Promise((resolve, reject) => {
                        db.get('SELECT 1', (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    dbHealthy = true;
                } catch (dbError) {
                    logger.error('Database health check failed', { error: dbError.message });
                }
                
                // Check disk space (basic check)
                const dbPath = path.join(__dirname, 'lucky_susu.db');
                let dbSize = 0;
                try {
                    const stats = fs.statSync(dbPath);
                    dbSize = stats.size;
                } catch (err) {
                    logger.warn('Could not get database file stats', { error: err.message });
                }
                
                // Get memory usage
                const memoryUsage = process.memoryUsage();
                
                const healthData = {
                    status: dbHealthy ? 'healthy' : 'unhealthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    database: {
                        connected: dbHealthy,
                        size: dbSize
                    },
                    memory: {
                        used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                        total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                        rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB'
                    },
                    version: require('./package.json').version || '1.0.0'
                };
                
                const statusCode = dbHealthy ? 200 : 503;
                sendJSON(statusCode, { success: true, data: healthData });
            } catch (err) {
                logger.error('Health check error', { error: err.message, stack: err.stack });
                sendJSON(503, { success: false, error: 'Health check failed' });
            }
        })();
        return;
    }

    // Apply rate limiting
    const { checkRateLimit } = require('./rateLimiter');
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
    
    // Stricter limits for auth endpoints (but more reasonable)
    if (path.startsWith('/api/auth/')) {
        if (!checkRateLimit(req, res, 900000, 20, 'auth')) {
            return;
        }
    } else if ((path.startsWith('/api/admin/deposits/daily') && method === 'GET') || 
               (path.startsWith('/api/admin/deposits/weekly') && method === 'GET') ||
               (path.startsWith('/api/admin/deposits/monthly') && method === 'GET') ||
               (path.startsWith('/api/admin/deposits/largest') && method === 'GET') ||
               (path.startsWith('/api/admin/deposits/smallest') && method === 'GET') ||
               (path === '/api/admin/accounts/largest' && method === 'GET') ||
               (path === '/api/admin/accounts/smallest' && method === 'GET') ||
               (path === '/api/admin/accounts/dormant' && method === 'GET') ||
               (path.startsWith('/api/admin/accounts/active') && method === 'GET') ||
               (path === '/api/admin/dashboard/stats' && method === 'GET') ||
               (path === '/api/admin/dashboard/today-stats' && method === 'GET') ||
               (path.startsWith('/api/admin/withdrawals/daily') && method === 'GET') ||
               (path.startsWith('/api/admin/withdrawals/weekly') && method === 'GET') ||
               (path.startsWith('/api/admin/withdrawals/monthly') && method === 'GET') ||
               (path.startsWith('/api/admin/commission/daily') && method === 'GET') ||
               (path.startsWith('/api/admin/commission/weekly') && method === 'GET') ||
               (path.startsWith('/api/admin/commission/monthly') && method === 'GET')) {
        // Allow real-time dashboard polling without rate limiting
    } else if (path.startsWith('/api/admin/deposits/daily')) {
        if (!checkRateLimit(req, res, windowMs, 1000, 'admin-daily')) {
            return;
        }
    } else {
        if (!checkRateLimit(req, res, windowMs, maxRequests, 'general')) {
            return;
        }
    }

    try {
        // Clients API - requires authentication
        if (path === '/api/clients' && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const page = parseInt(parsedUrl.query.page) || 1;
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 50, 200); // Max limit 200
                    const includeTotal = parsedUrl.query.includeTotal !== 'false'; // Default true
                    const cursor = parsedUrl.query.cursor || null;
                    const result = await Client.getAll(req.user.id, page, limit, includeTotal, cursor);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
            return;
        }
        
        else if (path === '/api/clients' && method === 'POST') {
            requireAuth(req, res, async () => {
                try {
                    const body = await parseBody(req);
                    const { name, phone, gender, rate } = body;

                    // Validation - All fields required
                    if (!name || !phone || !gender || rate === undefined) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'All fields are required' }));
                        return;
                    }

                    // Sanitize and validate name
                    const sanitizedName = name.trim().replace(/[<>]/g, '');
                    if (sanitizedName.length < 2) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Name must be at least 2 characters' }));
                        return;
                    }

                    // Validate phone - exactly 10 digits
                    const phoneDigits = phone.replace(/\D/g, '');
                    if (phoneDigits.length !== 10) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Phone number must contain exactly 10 digits' }));
                        return;
                    }

                    // Validate gender
                    if (!['Male', 'Female', 'Other'].includes(gender)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid gender selection' }));
                        return;
                    }

                    // Validate rate - minimum 5 cedis
                    const rateValue = parseFloat(rate);
                    if (isNaN(rateValue) || rateValue < 5 || rateValue > 1000000) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Rate must be between ₵5.00 and ₵1,000,000.00' }));
                        return;
                    }

                    const client = await Client.create({ 
                        name: sanitizedName, 
                        phone: phoneDigits,
                        gender, 
                        rate: rateValue,
                        agent_id: req.user.id
                    });

                    // Send welcome message to the new client
                    try {
                        await sendWelcomeMessage({
                            clientId: client.id,
                            clientName: sanitizedName,
                            phoneNumber: phoneDigits,
                            rate: rateValue
                        });
                    } catch (msgError) {
                        // Log error but don't fail the client creation
                        logger.error('Failed to send welcome message', { 
                            error: msgError.message, 
                            clientId: client.id 
                        });
                    }

                    res.writeHead(201);
                    res.end(JSON.stringify({ success: true, data: client }));
                } catch (err) {
                    if (err.message.includes('UNIQUE constraint')) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Phone number already exists' }));
                    } else {
                        logger.error('Client creation error', { error: err.message, stack: err.stack, agentId: req.user.id });
                        res.writeHead(500);
                        res.end(JSON.stringify({ success: false, error: 'Failed to create client' }));
                    }
                }
            });
            return;
        }

        else if (path === '/api/clients/search' && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const searchTerm = parsedUrl.query.q || '';
                    const page = parseInt(parsedUrl.query.page) || 1;
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 50, 200); // Max limit 200
                    const includeTotal = parsedUrl.query.includeTotal !== 'false'; // Default true
                    
                    if (!searchTerm || searchTerm.trim() === '') {
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, data: [], pagination: { page, limit, total: 0, totalPages: 0 } }));
                        return;
                    }
                    
                    // Sanitize search term
                    const sanitizedTerm = searchTerm.trim().replace(/[<>%]/g, '');
                    const result = await Client.search(sanitizedTerm, req.user.id, page, limit, includeTotal);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    logger.error('Search error', { error: err.message, stack: err.stack, searchTerm: sanitizedTerm, agentId: req.user.id });
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Database search failed' }));
                }
            });
            return;
        }

        else if (path === '/api/clients/stats' && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const stats = await Client.getStats(req.user.id);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: stats }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to get statistics' }));
                }
            });
            return;
        }

        else if (path.startsWith('/api/clients/') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const clientId = parseInt(path.split('/')[3]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const client = await Client.getById(clientId, req.user.id);
                    if (client) {
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, data: client }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Client not found' }));
                    }
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to get client' }));
                }
            });
            return;
        }

        // Transactions API - requires authentication
        else if (path === '/api/transactions' && method === 'POST') {
            requireAuth(req, res, async () => {
                try {
                    const body = await parseBody(req);
                    const { client_id, amount, transaction_type, transaction_date, notes } = body;

                    // Validation
                    if (!client_id || !amount || !transaction_date) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Client ID, amount, and date are required' }));
                        return;
                    }

                    // Validate amount
                    const amountValue = parseFloat(amount);
                    if (isNaN(amountValue) || amountValue <= 0 || amountValue > 1000000) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Amount must be between ₵0.01 and ₵1,000,000.00' }));
                        return;
                    }

                    // Check if transaction date is a weekend (Saturday = 6, Sunday = 0)
                    const transactionDate = new Date(transaction_date);
                    const dayOfWeek = transactionDate.getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) {
                        const dayName = transactionDate.toLocaleDateString('en-US', { weekday: 'long' });
                        res.writeHead(400);
                        res.end(JSON.stringify({ 
                            success: false, 
                            error: `Deposits cannot be added on weekends. ${dayName} is not a valid deposit day. Please try again on a weekday (Monday - Friday).` 
                        }));
                        return;
                    }

                    // Sanitize notes
                    const sanitizedNotes = notes ? notes.trim().replace(/[<>]/g, '') : null;

                    // Verify client belongs to this agent
                    const client = await Client.getById(parseInt(client_id), req.user.id);
                    if (!client) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Client not found or access denied' }));
                        return;
                    }

                    await AgentDailyStatus.ensureCanRecord(req.user.id, transaction_date);

                    const transaction = await Transaction.create({
                        client_id: parseInt(client_id),
                        agent_id: req.user.id,
                        amount: amountValue,
                        transaction_type: transaction_type || 'deposit',
                        transaction_date,
                        notes: sanitizedNotes
                    });

                    await AgentDailyStatus.upsertPending(req.user.id, transaction_date);

                    // Send message to client about the deposit
                    try {
                        // Get updated client info with new balance
                        const updatedClient = await Client.getById(parseInt(client_id), req.user.id);
                        if (updatedClient && transaction_type === 'deposit') {
                            await sendTransactionMessage({
                                clientId: parseInt(client_id),
                                transactionId: transaction.id,
                                transactionType: 'deposit',
                                amount: amountValue,
                                clientName: updatedClient.name,
                                phoneNumber: updatedClient.phone,
                                balance: updatedClient.current_balance,
                                date: transaction_date
                            });
                        }
                    } catch (msgError) {
                        // Log error but don't fail the transaction
                        logger.error('Failed to send deposit message', { 
                            error: msgError.message, 
                            clientId: parseInt(client_id),
                            transactionId: transaction.id 
                        });
                    }

                    res.writeHead(201);
                    res.end(JSON.stringify({ success: true, data: transaction }));
                } catch (err) {
                    const clientId = typeof client_id !== 'undefined' ? parseInt(client_id) : null;
                    logger.error('Transaction creation error', { error: err.message, stack: err.stack, clientId, agentId: req.user?.id });
                    
                    // Ensure response is sent even if there was an error
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ success: false, error: 'Failed to create transaction' }));
                    }
                }
            });
            return;
        }

        else if (path.startsWith('/api/transactions/client/') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const clientId = parseInt(path.split('/')[4]);
                    const page = parseInt(parsedUrl.query.page) || 1;
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 50, 200); // Max limit 200
                    const includeTotal = parsedUrl.query.includeTotal !== 'false'; // Default true
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    // Verify client belongs to this agent
                    const client = await Client.getById(clientId, req.user.id);
                    if (!client) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Client not found or access denied' }));
                        return;
                    }

                    const result = await Transaction.getByClientId(clientId, req.user.id, page, limit, includeTotal);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to get transactions' }));
                }
            });
            return;
        }

        else if (path === '/api/transactions/date' && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const date = parsedUrl.query.date;
                    const page = parseInt(parsedUrl.query.page) || 1;
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 100, 200); // Max limit 200
                    const includeTotal = parsedUrl.query.includeTotal !== 'false'; // Default true
                    if (!date) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Date parameter is required' }));
                        return;
                    }
                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }
                    const result = await Transaction.getByDate(date, req.user.id, page, limit, includeTotal);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to get transactions' }));
                }
            });
            return;
        }

        // Admin API endpoints (require authentication)
        // NOTE: Check specific routes BEFORE generic routes
        // Get agent statistics (client count, male/female counts) - MUST be before /api/admin/agents
        else if (path.startsWith('/api/admin/agents/') && path.endsWith('/stats') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const agentId = parseInt(path.split('/')[4]);
                    logger.debug('Fetching stats for agent', { agentId, path });
                    if (isNaN(agentId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid agent ID' }));
                        return;
                    }
                    const stats = await User.getAgentStats(agentId);
                    logger.debug('Agent stats retrieved', { agentId, statsCount: Object.keys(stats).length });
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: stats }));
                } catch (err) {
                    logger.error('Error fetching agent stats', { error: err.message, stack: err.stack, agentId: path.split('/')[4] });
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch agent statistics: ' + err.message }));
                }
            });
            return;
        }

        else if (path === '/api/admin/agents' && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const agents = await User.getAll();
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: agents }));
                } catch (err) {
                    logger.error('Error fetching agents', { error: err.message, stack: err.stack });
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch agents' }));
                }
            });
            return;
        }

        // Approve or reject an agent
        else if (path.startsWith('/api/admin/agents/') && path.endsWith('/approve') && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const agentId = parseInt(path.split('/')[4]);
                    if (isNaN(agentId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid agent ID' }));
                        return;
                    }
                    
                    const body = await parseBody(req);
                    const { action } = body; // 'approve' or 'reject'
                    
                    if (!action || !['approve', 'reject'].includes(action)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Action must be "approve" or "reject"' }));
                        return;
                    }
                    
                    // Check if agent exists and is not an admin
                    const agent = await User.getById(agentId);
                    if (!agent) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Agent not found' }));
                        return;
                    }
                    
                    // Check if user is an admin (cannot approve/reject admins)
                    if (agent.is_admin) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Cannot approve/reject admin users' }));
                        return;
                    }
                    
                    if (action === 'approve') {
                        await User.approveAgent(agentId, req.user.id);
                    } else {
                        await User.rejectAgent(agentId);
                    }
                    
                    // Get updated agent data
                    const updatedAgent = await User.getById(agentId);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ 
                        success: true, 
                        data: {
                            id: updatedAgent.id,
                            name: updatedAgent.name,
                            email: updatedAgent.email,
                            is_approved: updatedAgent.is_approved,
                            action
                        }
                    }));
                } catch (err) {
                    console.error('Error approving/rejecting agent:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to update agent status: ' + err.message }));
                }
            });
            return;
        }

        // Create admin user
        else if (path === '/api/admin/users' && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const body = await parseBody(req);
                    const { name, email, password, contact, validation_card_number, guarantor_number, guarantor_validation_number } = body;

                    // Validate required fields
                    if (!name || !email || !password || !contact || !validation_card_number || !guarantor_number || !guarantor_validation_number) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'All fields are required' }));
                        return;
                    }

                    // Check if user already exists
                    const existingUser = await User.getByEmail(email.toLowerCase());
                    if (existingUser) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'User with this email already exists' }));
                        return;
                    }

                    // Hash password
                    const hashedPassword = await hashPassword(password);

                    // Create admin user (created by admin, so approved and is_admin=true)
                    const userData = {
                        name: name.trim(),
                        email: email.toLowerCase().trim(),
                        password: hashedPassword,
                        contact: contact.replace(/\D/g, ''), // Remove non-digits
                        validation_card_number: validation_card_number.trim().toUpperCase(),
                        guarantor_number: guarantor_number.replace(/\D/g, ''), // Remove non-digits
                        guarantor_validation_number: guarantor_validation_number.trim().toUpperCase(),
                        is_admin: true,
                        is_approved: true,
                        created_by_admin: true
                    };

                    const newUser = await User.create(userData);

                    res.writeHead(201);
                    res.end(JSON.stringify({ 
                        success: true, 
                        data: { 
                            id: newUser.id, 
                            name: newUser.name, 
                            email: newUser.email,
                            contact: newUser.contact
                        } 
                    }));
                } catch (err) {
                    console.error('Error creating admin user:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to create admin user: ' + err.message }));
                }
            });
            return;
        }

        // Get admin dashboard statistics
        else if (path === '/api/admin/dashboard/stats' && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const result = await User.getAdminDashboardStats();
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching admin dashboard stats:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch dashboard stats: ' + err.message }));
                }
            });
            return;
        }

        // Get today's statistics
        else if (path === '/api/admin/dashboard/today-stats' && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    const result = await User.getTodayStats(date);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching today stats:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch today stats: ' + err.message }));
                }
            });
            return;
        }

        // Get all clients for admin
        else if (path === '/api/admin/clients' && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const page = parseInt(parsedUrl.query.page) || 1;
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 100, 200); // Max limit 200
                    const includeTotal = parsedUrl.query.includeTotal !== 'false'; // Default true
                    const result = await Client.getAllForAdmin(page, limit, includeTotal);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    console.error('Error fetching clients:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch clients' }));
                }
            });
            return;
        }

        // Update client info (name and phone) for admin
        // Must check this BEFORE the general /api/admin/clients route
        else if (path.match(/^\/api\/admin\/clients\/\d+\/update$/) && method === 'PUT') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    // Extract client ID from path like /api/admin/clients/123/update
                    const pathParts = path.split('/').filter(p => p);
                    
                    // Find the index of 'clients' and get the next part as clientId
                    const clientsIndex = pathParts.indexOf('clients');
                    const clientId = parseInt(pathParts[clientsIndex + 1]);
                    
                    if (!clientId || isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }

                    const body = await parseBody(req);
                    const { name, phone } = body;

                    if (!name || !phone) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Name and phone are required' }));
                        return;
                    }

                    logger.info('Updating client', { clientId, adminId: req.user.id });
                    const updatedClient = await Client.updateClientInfo(clientId, name, phone);
                    logger.info('Client updated successfully', { clientId });
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: updatedClient }));
                } catch (err) {
                    logger.error('Error updating client', { error: err.message, stack: err.stack, clientId: path.split('/').filter(p => p)[path.split('/').filter(p => p).indexOf('clients') + 1] });
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message || 'Failed to update client' }));
                }
            });
            return;
        }

        // Create withdrawal for admin
        else if (path === '/api/admin/withdrawals' && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const body = await parseBody(req);
                    const { client_id, agent_id, amount, transaction_date, notes, payment_receiver } = body;

                    // Validation
                    if (!client_id || !agent_id || !amount || !transaction_date) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Client ID, Agent ID, amount, and date are required' }));
                        return;
                    }

                    // Validate amount
                    const amountValue = parseFloat(amount);
                    if (isNaN(amountValue) || amountValue <= 0 || amountValue > 1000000) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Amount must be between ₵0.01 and ₵1,000,000.00' }));
                        return;
                    }

                    // Sanitize notes
                    const sanitizedNotes = notes ? notes.trim().replace(/[<>]/g, '') : null;
                    
                    // Build notes with payment receiver info
                    let finalNotes = sanitizedNotes || '';
                    if (payment_receiver) {
                        const receiverInfo = `Payment received by: ${payment_receiver}`;
                        finalNotes = finalNotes ? `${receiverInfo}. ${finalNotes}` : receiverInfo;
                    }

                    // Verify client exists
                    const client = await Client.getById(parseInt(client_id), parseInt(agent_id));
                    if (!client) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Client not found or does not belong to selected agent' }));
                        return;
                    }

                    // Check if client has sufficient balance for withdrawal
                    // Commission will be deducted automatically when cumulative withdrawals reach threshold
                    const currentBalance = parseFloat(client.current_balance) || 0;
                    const clientRate = Math.max(0, parseFloat(client.rate) || 0);
                    
                    // Check worst-case scenario: withdrawal + potential commission
                    // The database function will handle the actual logic based on cumulative withdrawals
                    const maxPossibleDeduction = amountValue + clientRate;
                    if (currentBalance < amountValue) {
                        const errorMessage = `Insufficient balance. Withdrawal requires ₵${amountValue.toFixed(2)}, but client balance is ₵${currentBalance.toFixed(2)}.`;
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: errorMessage }));
                        return;
                    }

                    // Note: Commission will be automatically deducted when cumulative withdrawals reach client's rate (31 boxes)
                    const transaction = await Transaction.createWithdrawalWithCommission({
                        client_id: parseInt(client_id),
                        agent_id: parseInt(agent_id),
                        withdrawal_amount: amountValue,
                        transaction_date,
                        notes: finalNotes || null
                    });

                    // Send message to client about the withdrawal
                    try {
                        // Get updated client info with new balance
                        const updatedClient = await Client.getById(parseInt(client_id), parseInt(agent_id));
                        if (updatedClient && transaction.withdrawal) {
                            await sendTransactionMessage({
                                clientId: parseInt(client_id),
                                transactionId: transaction.withdrawal.id,
                                transactionType: 'withdrawal',
                                amount: transaction.withdrawal_amount || amountValue,
                                clientName: updatedClient.name,
                                phoneNumber: updatedClient.phone,
                                balance: updatedClient.current_balance,
                                date: transaction_date
                            });
                        }
                    } catch (msgError) {
                        // Log error but don't fail the transaction
                        logger.error('Failed to send withdrawal message', { 
                            error: msgError.message, 
                            clientId: parseInt(client_id),
                            transactionId: transaction.withdrawal?.id 
                        });
                    }

                    res.writeHead(201);
                    res.end(JSON.stringify({ success: true, data: transaction }));
                } catch (err) {
                    console.error('Error creating withdrawal:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message || 'Failed to create withdrawal' }));
                }
            });
            return;
        }

        // Get daily commissions for admin
        else if (path.startsWith('/api/admin/commission/daily') && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    const result = await Transaction.getDailyCommissions(date);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching daily commissions:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch daily commissions: ' + err.message }));
                }
            });
            return;
        }

        // Get weekly commissions for admin
        else if (path.startsWith('/api/admin/commission/weekly') && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;

                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }

                    const result = await Transaction.getWeeklyCommissions(startDate, endDate);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching weekly commissions:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch weekly commissions: ' + err.message }));
                }
            });
            return;
        }

        // Get monthly commissions for admin
        else if (path.startsWith('/api/admin/commission/monthly') && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;

                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }

                    const result = await Transaction.getMonthlyCommissions(startDate, endDate);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching monthly commissions:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch monthly commissions: ' + err.message }));
                }
            });
            return;
        }

        // Get commission cycle for a client
        else if (path.startsWith('/api/clients/') && path.includes('/commission-cycle') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const pathParts = path.split('/');
                    const clientId = parseInt(pathParts[3]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const cycle = await CommissionCycle.getByClientIdWithClientInfo(clientId, req.user.id);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: cycle }));
                } catch (err) {
                    console.error('Error fetching commission cycle:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch commission cycle: ' + err.message }));
                }
            });
            return;
        }

        // Get commission history for a client
        else if (path.startsWith('/api/clients/') && path.includes('/commission-history') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const pathParts = path.split('/');
                    const clientId = parseInt(pathParts[3]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const history = await Transaction.getCommissionHistory(clientId, req.user.id);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: history }));
                } catch (err) {
                    console.error('Error fetching commission history:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch commission history: ' + err.message }));
                }
            });
            return;
        }

        // Reverse a withdrawal transaction
        else if (path.startsWith('/api/transactions/') && path.includes('/reverse') && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const pathParts = path.split('/');
                    const transactionId = parseInt(pathParts[3]);
                    if (isNaN(transactionId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid transaction ID' }));
                        return;
                    }
                    const body = await parseBody(req);
                    const { reason } = body;
                    const result = await Transaction.reverseWithdrawal(transactionId, req.user.id, reason);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error reversing withdrawal:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to reverse withdrawal: ' + err.message }));
                }
            });
            return;
        }

        // Update client rate
        else if (path.startsWith('/api/clients/') && path.endsWith('/rate') && method === 'PUT') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const pathParts = path.split('/');
                    const clientId = parseInt(pathParts[3]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const body = await parseBody(req);
                    const { rate, agent_id } = body;
                    if (!rate || !agent_id) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Rate and agent_id are required' }));
                        return;
                    }
                    const result = await Client.updateRate(clientId, rate, parseInt(agent_id));
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error updating client rate:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to update client rate: ' + err.message }));
                }
            });
            return;
        }

        // Admin: Get all pending commission cycles
        else if (path === '/api/admin/commission-cycles/pending' && method === 'GET') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const pending = await CommissionCycle.getAllPending();
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: pending }));
                } catch (err) {
                    console.error('Error fetching pending commission cycles:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch pending cycles: ' + err.message }));
                }
            });
            return;
        }

        // Admin: Reset commission cycle for a client
        else if (path.startsWith('/api/admin/commission-cycles/') && path.endsWith('/reset') && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const pathParts = path.split('/');
                    const clientId = parseInt(pathParts[4]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const result = await CommissionCycle.reset(clientId);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error resetting commission cycle:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to reset commission cycle: ' + err.message }));
                }
            });
            return;
        }

        // Admin: Adjust commission cycle for a client
        else if (path.startsWith('/api/admin/commission-cycles/') && path.endsWith('/adjust') && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const pathParts = path.split('/');
                    const clientId = parseInt(pathParts[4]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }
                    const body = await parseBody(req);
                    const { cumulative_withdrawal } = body;
                    if (cumulative_withdrawal === undefined) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'cumulative_withdrawal is required' }));
                        return;
                    }
                    const result = await CommissionCycle.adjust(clientId, cumulative_withdrawal);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error adjusting commission cycle:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to adjust commission cycle: ' + err.message }));
                }
            });
            return;
        }

        // Get largest accounts by agent (client with highest balance per agent)
        else if (path === '/api/admin/accounts/largest' && method === 'GET') {
            console.log('🔍 Largest accounts route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const result = await Client.getLargestAccountsByAgent();
                    console.log('Largest accounts result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching largest accounts:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch largest accounts: ' + err.message }));
                }
            });
            return;
        }

        else if (path === '/api/admin/accounts/smallest' && method === 'GET') {
            console.log('🔍 Smallest accounts route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const result = await Client.getSmallestAccountsByAgent();
                    console.log('Smallest accounts result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching smallest accounts:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch smallest accounts: ' + err.message }));
                }
            });
            return;
        }

        else if (path === '/api/admin/accounts/dormant' && method === 'GET') {
            console.log('🔍 Dormant accounts route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const result = await Client.getDormantAccountsByAgent();
                    console.log('Dormant accounts result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching dormant accounts:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch dormant accounts: ' + err.message }));
                }
            });
            return;
        }

        else if (path.startsWith('/api/admin/accounts/active') && method === 'GET') {
            console.log('🔍 Active accounts route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;
                    
                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }
                    
                    const result = await Transaction.getActiveAccountsByAgent(startDate, endDate);
                    console.log('Active accounts result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching active accounts:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch active accounts: ' + err.message }));
                }
            });
            return;
        }

        // Get largest deposits by agent for a specific date
        // Must be checked BEFORE /api/admin/deposits/daily to avoid route conflicts
        else if (path.startsWith('/api/admin/deposits/largest') && method === 'GET') {
            console.log('🔍 Largest deposits route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    console.log('Fetching largest deposits for date:', date);
                    
                    const result = await Transaction.getLargestDepositsByAgent(date);
                    console.log('Largest deposits result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching largest deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch largest deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get smallest deposits by agent for a specific date
        else if (path.startsWith('/api/admin/deposits/smallest') && method === 'GET') {
            console.log('🔍 Smallest deposits route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    console.log('Fetching smallest deposits for date:', date);
                    
                    const result = await Transaction.getSmallestDepositsByAgent(date);
                    console.log('Smallest deposits result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching smallest deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch smallest deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get clients who deposited the least for a specific date
        else if (path.startsWith('/api/admin/deposits/smallest-daily') && method === 'GET') {
            console.log('🔍 Smallest daily deposits route matched - Path:', path, 'Method:', method);
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    console.log('Fetching smallest daily deposits for date:', date);
                    
                    const result = await Transaction.getSmallestDailyDeposits(date);
                    console.log('Smallest daily deposits result:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching smallest daily deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch smallest daily deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get daily deposits for admin
        else if (path.startsWith('/api/admin/deposits/daily') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    
                    const result = await Transaction.getDailyDeposits(date);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching daily deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch daily deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get weekly deposits for admin
        else if (path.startsWith('/api/admin/deposits/weekly') && method === 'GET') {
            console.log('✅ Matched weekly deposits route for path:', path);
            // Allow real-time dashboard polling without rate limiting
            requireAuth(req, res, async () => {
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;
                    
                    console.log('Weekly deposits request - startDate:', startDate, 'endDate:', endDate);
                    
                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }
                    
                    const result = await Transaction.getWeeklyDeposits(startDate, endDate);
                    console.log('Weekly deposits retrieved:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching weekly deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch weekly deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get monthly deposits for admin
        else if (path.startsWith('/api/admin/deposits/monthly') && method === 'GET') {
            console.log('✅ Matched monthly deposits route for path:', path);
            // Allow real-time dashboard polling without rate limiting
            requireAuth(req, res, async () => {
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;
                    
                    console.log('Monthly deposits request - startDate:', startDate, 'endDate:', endDate);
                    
                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }
                    
                    const result = await Transaction.getMonthlyDeposits(startDate, endDate);
                    console.log('Monthly deposits retrieved:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching monthly deposits:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch monthly deposits: ' + err.message }));
                }
            });
            return;
        }

        // Get daily withdrawals for admin
        else if (path.startsWith('/api/admin/withdrawals/daily') && method === 'GET') {
            console.log('✅ Matched daily withdrawals route for path:', path);
            // Allow real-time dashboard polling without rate limiting
            requireAuth(req, res, async () => {
                try {
                    const query = parsedUrl.query;
                    const date = query.date || new Date().toISOString().split('T')[0];
                    
                    console.log('Daily withdrawals request - date:', date);
                    
                    const result = await Transaction.getDailyWithdrawals(date);
                    console.log('Daily withdrawals retrieved:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching daily withdrawals:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch daily withdrawals: ' + err.message }));
                }
            });
            return;
        }

        // Get monthly withdrawals for admin
        else if (path.startsWith('/api/admin/withdrawals/monthly') && method === 'GET') {
            console.log('✅ Matched monthly withdrawals route for path:', path);
            // Allow real-time dashboard polling without rate limiting
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;
                    const agentId = query.agent_id;
                    
                    // If agent_id is provided, return client-level withdrawals for that agent
                    if (agentId) {
                        console.log('Agent client withdrawals request (monthly) - agentId:', agentId, 'startDate:', startDate, 'endDate:', endDate);
                        
                        if (!startDate || !endDate) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                            return;
                        }

                        // Validate date format
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                            return;
                        }

                        const agentIdInt = parseInt(agentId);
                        if (isNaN(agentIdInt)) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'Invalid agent_id' }));
                            return;
                        }

                        const clients = await Transaction.getAgentClientWithdrawals(agentIdInt, startDate, endDate);
                        console.log('Agent client withdrawals retrieved (monthly):', clients);
                        
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, data: clients }));
                        return;
                    }
                    
                    // Otherwise, return agent-level summary
                    console.log('Monthly withdrawals request - startDate:', startDate, 'endDate:', endDate);
                    
                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }

                    const result = await Transaction.getMonthlyWithdrawals(startDate, endDate);
                    console.log('Monthly withdrawals retrieved:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching monthly withdrawals:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch monthly withdrawals: ' + err.message }));
                }
            });
            return;
        }

        // Get weekly withdrawals for admin
        else if (path.startsWith('/api/admin/withdrawals/weekly') && method === 'GET') {
            console.log('✅ Matched weekly withdrawals route for path:', path);
            // Allow real-time dashboard polling without rate limiting
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const query = parsedUrl.query;
                    const startDate = query.start_date;
                    const endDate = query.end_date;
                    const agentId = query.agent_id;
                    
                    // If agent_id is provided, return client-level withdrawals for that agent
                    if (agentId) {
                        console.log('Agent client withdrawals request - agentId:', agentId, 'startDate:', startDate, 'endDate:', endDate);
                        
                        if (!startDate || !endDate) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                            return;
                        }

                        // Validate date format
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                            return;
                        }

                        const agentIdInt = parseInt(agentId);
                        if (isNaN(agentIdInt)) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: 'Invalid agent_id' }));
                            return;
                        }

                        const clients = await Transaction.getAgentClientWithdrawals(agentIdInt, startDate, endDate);
                        console.log('Agent client withdrawals retrieved:', clients);
                        
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, data: clients }));
                        return;
                    }
                    
                    // Otherwise, return agent-level summary
                    console.log('Weekly withdrawals request - startDate:', startDate, 'endDate:', endDate);
                    
                    if (!startDate || !endDate) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'start_date and end_date parameters are required' }));
                        return;
                    }

                    // Validate date format
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }));
                        return;
                    }

                    const result = await Transaction.getWeeklyWithdrawals(startDate, endDate);
                    console.log('Weekly withdrawals retrieved:', result);
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    console.error('Error fetching weekly withdrawals:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to fetch weekly withdrawals: ' + err.message }));
                }
            });
            return;
        }

        else if (path === '/api/admin/deposits/daily/status' && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }

                try {
                    const body = await parseBody(req);
                    const agentId = parseInt(body.agent_id);
                    const targetDate = body.date;
                    const action = (body.action || '').toLowerCase();
                    const note = body.note ? String(body.note).trim() : null;

                    if (isNaN(agentId) || !targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Valid agent_id and date (YYYY-MM-DD) are required' }));
                        return;
                    }

                    if (!['approve', 'reject'].includes(action)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Action must be approve or reject' }));
                        return;
                    }

                    if (action === 'approve') {
                        await AgentDailyStatus.approveDay(agentId, targetDate, req.user.id, note);
                    } else {
                        await AgentDailyStatus.rejectDay(agentId, targetDate, req.user.id, note);
                    }

                    const statuses = await AgentDailyStatus.getStatusesByDate(targetDate);

                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
                        data: {
                            agent_id: agentId,
                            date: targetDate,
                            status: statuses[String(agentId)]?.status || action,
                            statuses
                        }
                    }));
                } catch (err) {
                    console.error('Error updating agent daily status:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Failed to update agent daily status: ' + err.message }));
                }
            });
            return;
        }

        // Authentication API (public endpoints with stricter rate limiting)
        else if (path === '/api/auth/register' && method === 'POST') {
            try {
                const body = await parseBody(req);
                const { name, email, password, contact, validation_card_number, guarantor_number, guarantor_validation_number } = body;

                // Validation - All fields required
                if (!name || !email || !password || !contact || !validation_card_number || !guarantor_number || !guarantor_validation_number) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'All fields are required' }));
                    return;
                }

                // Validate name
                if (name.trim().length < 2) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Name must be at least 2 characters long' }));
                    return;
                }

                // Validate email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email.trim())) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Invalid email format' }));
                    return;
                }

                // Validate password length
                if (password.length < 6) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Password must be at least 6 characters long' }));
                    return;
                }

                // Validate phone number (10 digits)
                const contactDigits = contact.replace(/\D/g, '');
                if (contactDigits.length !== 10) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Contact number must contain exactly 10 digits' }));
                    return;
                }

                // Validate guarantor phone number
                const guarantorDigits = guarantor_number.replace(/\D/g, '');
                if (guarantorDigits.length !== 10) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Guarantor contact number must contain exactly 10 digits' }));
                    return;
                }

                // Validate Ghana Card number format: GHA-XXXXXXXXX-X
                // Format: 3 letters (GHA), hyphen, 9 digits, hyphen, 1 check digit
                function validateGhanaCard(cardNumber) {
                    if (!cardNumber || !cardNumber.trim()) {
                        return false;
                    }
                    const cleaned = cardNumber.trim().toUpperCase();
                    const ghanaCardRegex = /^GHA-\d{9}-\d$/;
                    return ghanaCardRegex.test(cleaned);
                }

                // Validate agent's Ghana Card number
                if (!validateGhanaCard(validation_card_number)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'Ghana Card number must be in format: GHA-XXXXXXXXX-X (e.g., GHA-123456789-1)' 
                    }));
                    return;
                }

                // Validate guarantor's Ghana Card number
                if (!validateGhanaCard(guarantor_validation_number)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'Guarantor Ghana Card number must be in format: GHA-XXXXXXXXX-X (e.g., GHA-123456789-1)' 
                    }));
                    return;
                }

                // Check if email already exists
                const existingUser = await User.getByEmail(email.trim().toLowerCase());
                if (existingUser) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Email already registered. Please use a different email or login.' }));
                    return;
                }

                // Hash password with bcrypt
                const hashedPassword = await hashPassword(password);

                // Normalize Ghana Card numbers to uppercase
                const normalizedValidationCard = validation_card_number.trim().toUpperCase().replace(/[<>]/g, '');
                const normalizedGuarantorCard = guarantor_validation_number.trim().toUpperCase().replace(/[<>]/g, '');
                const sanitizedName = name.trim().replace(/[<>]/g, '');

                // Agents registering themselves are not approved by default
                const user = await User.create({
                    name: sanitizedName,
                    email: email.trim().toLowerCase(),
                    password: hashedPassword,
                    contact: contactDigits,
                    validation_card_number: normalizedValidationCard,
                    guarantor_number: guarantorDigits,
                    guarantor_validation_number: normalizedGuarantorCard,
                    is_admin: false,
                    is_approved: false,
                    created_by_admin: false
                });

                // Don't generate token for unapproved users - they need to wait for approval
                // They will get a token after approval when they login

                res.writeHead(201);
                res.end(JSON.stringify({ 
                    success: true, 
                    data: { 
                        id: user.id, 
                        name: user.name,
                        email: user.email,
                        is_approved: false,
                        message: 'Your account has been created and is pending approval. You will be able to login once an administrator approves your account.'
                    } 
                }));
            } catch (err) {
                console.error('Registration error:', err);
                
                if (err.message && err.message.includes('UNIQUE constraint')) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Email already registered. Please use a different email or login.' }));
                } else {
                    res.writeHead(500);
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'Failed to create account. Please try again.' 
                    }));
                }
            }
            return;
        }

        else if (path === '/api/auth/login' && method === 'POST') {
            try {
                const body = await parseBody(req);
                const { email, password } = body;

                // Validation
                if (!email || !password) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: 'Email and password are required' }));
                    return;
                }

                // Get user by email
                const user = await User.getByEmail(email.trim().toLowerCase());
                if (!user) {
                    res.writeHead(401);
                    res.end(JSON.stringify({ success: false, error: 'Invalid email or password' }));
                    return;
                }

                // Compare password with bcrypt
                const passwordMatch = await comparePassword(password, user.password);
                if (!passwordMatch) {
                    res.writeHead(401);
                    res.end(JSON.stringify({ success: false, error: 'Invalid email or password' }));
                    return;
                }

                // Check if user is admin (must have is_admin flag set AND created_by_admin flag)
                const isAdmin = user.is_admin === true || user.is_admin === 1;
                const isCreatedByAdmin = user.created_by_admin === true || user.created_by_admin === 1;
                
                // Security check: Only admins created by admin can sign in as admin
                // Regular agents cannot sign in as admin even if is_admin is somehow set
                if (isAdmin && !isCreatedByAdmin) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'Access denied. Only administrators created by an admin can access admin features.' 
                    }));
                    return;
                }

                // Check if agent is approved (only for non-admin users)
                if (!isAdmin) {
                    const isApproved = user.is_approved === true || user.is_approved === 1;
                    if (!isApproved) {
                        res.writeHead(403);
                        res.end(JSON.stringify({ 
                            success: false, 
                            error: 'Your account is pending approval. Please wait for an administrator to approve your account before accessing the system.' 
                        }));
                        return;
                    }
                }

                // Generate JWT token
                const token = generateToken({ id: user.id, email: user.email });

                // Login successful - return user data with token
                res.writeHead(200);
                res.end(JSON.stringify({ 
                    success: true, 
                    data: { 
                        id: user.id, 
                        name: user.name || 'Agent',
                        email: user.email, 
                        contact: user.contact,
                        token,
                        isAdmin: isAdmin && isCreatedByAdmin,
                        isApproved: isAdmin || (user.is_approved === true || user.is_approved === 1)
                    } 
                }));
            } catch (err) {
                console.error('Login error:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: 'Login failed. Please try again.' }));
            }
            return;
        }

        // 404 for unknown routes
        else {
            logger.warn('Route not found', { method, path, ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown' });
            res.writeHead(404);
            res.end(JSON.stringify({ success: false, error: 'Route not found', path: path, method: method }));
        }

    } catch (err) {
        logger.error('API Error', { error: err.message, stack: err.stack, path, method });
        res.writeHead(500);
        // Don't expose internal error details to clients
        res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
}

module.exports = { handleAPI };

