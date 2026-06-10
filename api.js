const { Client, Transaction, User, AgentDailyStatus, Message } = require('./database');
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
const {
    sendTransactionMessage,
    sendWelcomeMessage,
    sendDepositApprovalNotifications,
    sendDepositRejectionNotification,
    buildApprovalNotificationMessage,
    buildRejectionNotificationMessage
} = require('./messaging');

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

async function isAdminUser(req) {
    if (!req.user) {
        return false;
    }
    const user = await User.getByEmail(req.user.email);
    return !!(user && user.is_admin);
}

async function ensureAdmin(req, res) {
    if (!req.user) {
        res.writeHead(403);
        res.end(JSON.stringify({ success: false, error: 'Admin privileges required' }));
        return false;
    }

    if (!(await isAdminUser(req))) {
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
                const { getDbPath } = require('./database');
                const dbPath = getDbPath();
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
    if (path === '/api/webhooks/arkesel/delivery') {
        // Delivery webhooks should not be throttled aggressively
    } else if (path.startsWith('/api/auth/')) {
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
        // Arkesel delivery webhook (public endpoint with optional shared-secret verification)
        if (path === '/api/webhooks/arkesel/delivery' && method === 'POST') {
            const webhookSecret = process.env.ARKESEL_WEBHOOK_SECRET;
            const providedSecret = req.headers['x-webhook-token'] || req.headers['x-arkesel-signature'];
            if (webhookSecret && providedSecret !== webhookSecret) {
                sendJSON(401, { success: false, error: 'Invalid webhook signature' });
                return;
            }

            const body = await parseBody(req);
            const payload = body?.data && typeof body.data === 'object' ? body.data : body;
            const providerMessageId = payload?.id || payload?.message_id || payload?.sms_id;
            const rawStatus = String(payload?.status || payload?.delivery_status || '').toLowerCase();

            if (!providerMessageId) {
                sendJSON(400, { success: false, error: 'Missing provider message id' });
                return;
            }

            let normalizedStatus = rawStatus || 'sent';
            if (normalizedStatus.includes('deliver')) {
                normalizedStatus = 'delivered';
            } else if (normalizedStatus.includes('fail') || normalizedStatus.includes('undeliver') || normalizedStatus.includes('reject')) {
                normalizedStatus = 'failed';
            } else if (['queued', 'processing', 'submitted', 'sent'].includes(normalizedStatus)) {
                normalizedStatus = 'sent';
            }

            const deliveredAt = normalizedStatus === 'delivered'
                ? (payload?.delivered_at || payload?.updated_at || new Date().toISOString())
                : null;
            const failedAt = normalizedStatus === 'failed'
                ? (payload?.failed_at || payload?.updated_at || new Date().toISOString())
                : null;

            const updateResult = await Message.updateByProviderMessageId(providerMessageId, normalizedStatus, {
                deliveredAt,
                failedAt,
                providerResponse: body
            });

            sendJSON(200, {
                success: true,
                data: {
                    provider_message_id: providerMessageId,
                    normalized_status: normalizedStatus,
                    updated_messages: updateResult.updated
                }
            });
            return;
        }

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

        else if (path.includes('/box-account') && path.startsWith('/api/clients/') && method === 'GET') {
            requireAuth(req, res, async () => {
                try {
                    const clientId = parseInt(path.split('/')[3]);
                    if (isNaN(clientId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Invalid client ID' }));
                        return;
                    }

                    const ownerAgentId = await Client.getAgentId(clientId);
                    if (!ownerAgentId) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ success: false, error: 'Client not found' }));
                        return;
                    }

                    const isAdmin = await isAdminUser(req);
                    if (!isAdmin && parseInt(ownerAgentId) !== parseInt(req.user.id)) {
                        res.writeHead(403);
                        res.end(JSON.stringify({ success: false, error: 'Access denied' }));
                        return;
                    }

                    const account = await Transaction.getBoxAccountForClient(clientId, ownerAgentId);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: account }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message || 'Failed to load box account' }));
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

                    // Validate transaction type
                    const effectiveTransactionType = transaction_type || 'deposit';
                    if (!['deposit', 'withdrawal'].includes(effectiveTransactionType)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'transaction_type must be either "deposit" or "withdrawal"' }));
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

                    if (effectiveTransactionType === 'withdrawal') {
                        try {
                            await Transaction.previewWithdrawal(parseInt(client_id), req.user.id, amountValue);
                        } catch (previewErr) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ success: false, error: previewErr.message }));
                            return;
                        }

                        const transaction = await Transaction.createWithdrawal({
                            client_id: parseInt(client_id),
                            agent_id: req.user.id,
                            withdrawal_amount: amountValue,
                            transaction_date,
                            notes: sanitizedNotes
                        });

                        try {
                            const updatedClient = await Client.getById(parseInt(client_id), req.user.id);
                            if (updatedClient && transaction.withdrawal) {
                                await sendTransactionMessage({
                                    clientId: parseInt(client_id),
                                    transactionId: transaction.withdrawal.id,
                                    transactionType: 'withdrawal',
                                    amount: transaction.totals?.withdrawal_amount || amountValue,
                                    clientName: updatedClient.name,
                                    phoneNumber: updatedClient.phone,
                                    balance: updatedClient.current_balance,
                                    date: transaction_date
                                });
                            }
                        } catch (msgError) {
                            logger.error('Failed to send withdrawal message', {
                                error: msgError.message,
                                clientId: parseInt(client_id),
                                transactionId: transaction.withdrawal?.id
                            });
                        }

                        res.writeHead(201);
                        res.end(JSON.stringify({ success: true, data: transaction }));
                        return;
                    }

                    await AgentDailyStatus.ensureCanRecord(req.user.id, transaction_date);

                    const transaction = await Transaction.create({
                        client_id: parseInt(client_id),
                        agent_id: req.user.id,
                        amount: amountValue,
                        transaction_type: effectiveTransactionType,
                        transaction_date,
                        notes: sanitizedNotes
                    });

                    await AgentDailyStatus.upsertPending(req.user.id, transaction_date);

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
                    const limit = Math.min(parseInt(parsedUrl.query.limit) || 500, 1000);
                    const includeTotal = parsedUrl.query.includeTotal !== 'false';
                    const includeSummary = parsedUrl.query.includeSummary !== 'false';
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
                    const result = await Transaction.getByDate(date, req.user.id, page, limit, includeTotal, includeSummary);
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

                    try {
                        const preview = await Transaction.previewWithdrawal(
                            parseInt(client_id),
                            parseInt(agent_id),
                            amountValue
                        );
                        const currentBalance = parseFloat(client.current_balance) || 0;
                        if (currentBalance + 0.001 < preview.withdrawal.total_deduction) {
                            res.writeHead(400);
                            res.end(JSON.stringify({
                                success: false,
                                error: `Insufficient balance. Total deduction would be ₵${preview.withdrawal.total_deduction.toFixed(2)} ` +
                                    `(payout ₵${preview.withdrawal.payout.toFixed(2)} + commission ₵${preview.withdrawal.commission_amount.toFixed(2)}).`
                            }));
                            return;
                        }
                    } catch (previewErr) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: previewErr.message }));
                        return;
                    }

                    const transaction = await Transaction.createWithdrawal({
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
                                amount: transaction.totals?.withdrawal_amount || amountValue,
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

        // Preview withdrawal with box commission rules
        else if (path === '/api/admin/withdrawals/preview' && method === 'POST') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const body = await parseBody(req);
                    const clientId = parseInt(body.client_id);
                    const agentId = parseInt(body.agent_id);
                    const amountValue = parseFloat(body.amount);
                    if (isNaN(clientId) || isNaN(agentId) || isNaN(amountValue) || amountValue <= 0) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'client_id, agent_id, and amount are required' }));
                        return;
                    }
                    const preview = await Transaction.previewWithdrawal(clientId, agentId, amountValue);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: preview }));
                } catch (err) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, error: err.message || 'Failed to preview withdrawal' }));
                }
            });
            return;
        }

        // Toggle deferral request on a client account
        else if (path.includes('/deferral') && path.startsWith('/api/admin/clients/') && method === 'PUT') {
            requireAuth(req, res, async () => {
                if (!(await ensureAdmin(req, res))) {
                    return;
                }
                try {
                    const clientId = parseInt(path.split('/')[4]);
                    const body = await parseBody(req);
                    const agentId = parseInt(body.agent_id);
                    if (isNaN(clientId) || isNaN(agentId)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ success: false, error: 'Valid client_id and agent_id are required' }));
                        return;
                    }
                    const deferralActive = body.deferral_active === true || body.deferral_active === 1 || body.deferral_active === 'true';
                    const result = await Client.setDeferral(clientId, agentId, deferralActive);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, data: result }));
                } catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: err.message || 'Failed to update deferral setting' }));
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

                    let notificationSummary = null;
                    let notificationMessage = '';

                    if (action === 'approve') {
                        await AgentDailyStatus.approveDay(agentId, targetDate, req.user.id, note);
                        try {
                            notificationSummary = await sendDepositApprovalNotifications(agentId, targetDate);
                            notificationMessage = buildApprovalNotificationMessage(notificationSummary);
                        } catch (notifyErr) {
                            logger.error('Deposit approval notifications failed', {
                                error: notifyErr.message,
                                agentId,
                                date: targetDate
                            });
                            notificationMessage = 'Deposits approved, but some notifications could not be sent.';
                        }
                    } else {
                        await AgentDailyStatus.rejectDay(agentId, targetDate, req.user.id, note);
                        try {
                            notificationSummary = await sendDepositRejectionNotification(agentId, targetDate, note);
                            notificationMessage = buildRejectionNotificationMessage(notificationSummary);
                        } catch (notifyErr) {
                            logger.error('Deposit rejection notification failed', {
                                error: notifyErr.message,
                                agentId,
                                date: targetDate
                            });
                            notificationMessage = 'Deposits rejected. Agent notification could not be sent.';
                        }
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
                        },
                        notification: {
                            message: notificationMessage,
                            summary: notificationSummary
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

