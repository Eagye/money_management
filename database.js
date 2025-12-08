const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'lucky_susu.db');

// Single persistent database connection (connection pooling)
let dbInstance = null;

// Initialize database and create tables
function initDatabase() {
    return new Promise((resolve, reject) => {
        dbInstance = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database');
        });

        // Performance optimizations for SQLite
        dbInstance.serialize(() => {
            // Enable foreign keys
            dbInstance.run('PRAGMA foreign_keys = ON');
            
            // Enable WAL mode for better concurrency (Write-Ahead Logging)
            // This allows multiple readers and one writer simultaneously
            dbInstance.run('PRAGMA journal_mode = WAL', (err) => {
                if (err) {
                    console.warn('Warning: Could not enable WAL mode:', err.message);
                } else {
                    console.log('WAL mode enabled for better performance');
                }
            });
            
            // Increase cache size (in pages, default 2000 pages ~8MB, setting to -64000 = 256MB)
            // Negative values are in KB, so -64000 = 64MB (more reasonable)
            dbInstance.run('PRAGMA cache_size = -64000', (err) => {
                if (err) {
                    console.warn('Warning: Could not set cache size:', err.message);
                }
            });
            
            // Enable query planner optimizations
            dbInstance.run('PRAGMA optimize', (err) => {
                if (err) {
                    console.warn('Warning: Could not optimize:', err.message);
                }
            });
            
            // Set synchronous mode to NORMAL (faster than FULL, still safe with WAL)
            dbInstance.run('PRAGMA synchronous = NORMAL', (err) => {
                if (err) {
                    console.warn('Warning: Could not set synchronous mode:', err.message);
                }
            });
        });

        // Create clients table
        dbInstance.serialize(() => {
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS clients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    gender TEXT NOT NULL,
                    rate REAL NOT NULL,
                    current_balance REAL DEFAULT 0.00,
                    agent_id INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating clients table:', err);
                    reject(err);
                } else {
                    console.log('Clients table ready');
                }
            });

            // Create transactions table
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id INTEGER NOT NULL,
                    agent_id INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    transaction_type TEXT NOT NULL DEFAULT 'deposit',
                    transaction_date DATE NOT NULL,
                    notes TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                    FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating transactions table:', err);
                    reject(err);
                } else {
                    console.log('Transactions table ready');
                }
            });

            // Create agent daily status table
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS agent_daily_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id INTEGER NOT NULL,
                    transaction_date DATE NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
                    decided_by INTEGER,
                    decided_at DATETIME,
                    note TEXT,
                    UNIQUE(agent_id, transaction_date),
                    FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating agent_daily_status table:', err);
                    reject(err);
                } else {
                    console.log('Agent daily status table ready');
                }
            });

            // Create commission cycle tracking table
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS commission_cycles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id INTEGER NOT NULL UNIQUE,
                    cumulative_withdrawal REAL DEFAULT 0.00,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating commission_cycles table:', err);
                    reject(err);
                } else {
                    console.log('Commission cycles table ready');
                }
            });

            // Create users table for authentication
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    contact TEXT NOT NULL,
                    validation_card_number TEXT NOT NULL,
                    guarantor_number TEXT NOT NULL,
                    guarantor_validation_number TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating users table:', err);
                    reject(err);
                } else {
                    console.log('Users table ready');
                }
            });

            // Create messages table for client notifications
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id INTEGER NOT NULL,
                    transaction_id INTEGER,
                    message_type TEXT NOT NULL DEFAULT 'transaction',
                    message TEXT NOT NULL,
                    phone_number TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    sent_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating messages table:', err);
                    reject(err);
                } else {
                    console.log('Messages table ready');
                    
                    // Create indexes for performance and ensure schema updates
                    createIndexes()
                        .then(() => ensureSchemaUpdates())
                        .then(() => {
                            resolve(dbInstance);
                        })
                        .catch(reject);
                }
            });
        });
    });
}

// Create database indexes for performance
function createIndexes() {
    return new Promise((resolve, reject) => {
        const indexes = [
            // Unique index: phone must be unique per agent (not globally)
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone_agent ON clients(phone, agent_id)',
            // Regular indexes for performance
            'CREATE INDEX IF NOT EXISTS idx_clients_agent_id ON clients(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)',
            // Composite indexes for optimized pagination queries
            'CREATE INDEX IF NOT EXISTS idx_clients_agent_created ON clients(agent_id, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_clients_agent_name ON clients(agent_id, name)',
            'CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id)',
            'CREATE INDEX IF NOT EXISTS idx_transactions_agent_id ON transactions(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)',
            // Composite indexes for transaction pagination
            'CREATE INDEX IF NOT EXISTS idx_transactions_client_date ON transactions(client_id, transaction_date DESC, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_transactions_agent_date ON transactions(agent_id, transaction_date DESC, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
            'CREATE INDEX IF NOT EXISTS idx_agent_status_date ON agent_daily_status(transaction_date)',
            'CREATE INDEX IF NOT EXISTS idx_agent_status_agent ON agent_daily_status(agent_id)',
            'CREATE INDEX IF NOT EXISTS idx_commission_cycles_client ON commission_cycles(client_id)',
            'CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id)',
            'CREATE INDEX IF NOT EXISTS idx_messages_transaction_id ON messages(transaction_id)',
            'CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)'
        ];

        let completed = 0;
        indexes.forEach((indexSQL, i) => {
            dbInstance.run(indexSQL, (err) => {
                if (err) {
                    console.error(`Error creating index ${i}:`, err);
                    reject(err);
                } else {
                    completed++;
                    if (completed === indexes.length) {
                        console.log('Database indexes created');
                        resolve();
                    }
                }
            });
        });
    });
}

// Ensure schema stays up-to-date when new columns are introduced
function ensureSchemaUpdates() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        // Check and add related_transaction_id column if missing
        db.all(`PRAGMA table_info(transactions)`, (err, columns) => {
            if (err) {
                reject(err);
                return;
            }

            const hasRelatedColumn = (columns || []).some((column) => column.name === 'related_transaction_id');
            if (!hasRelatedColumn) {
                db.run(`ALTER TABLE transactions ADD COLUMN related_transaction_id INTEGER`, (alterErr) => {
                    if (alterErr && !String(alterErr.message).includes('duplicate column name')) {
                        reject(alterErr);
                        return;
                    }
                });
            }

            // Check and add user table columns if missing
            db.all(`PRAGMA table_info(users)`, (userErr, userColumns) => {
                if (userErr) {
                    reject(userErr);
                    return;
                }

                const hasIsApproved = (userColumns || []).some((column) => column.name === 'is_approved');
                if (!hasIsApproved) {
                    db.run(`ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0`, (alterErr) => {
                        if (alterErr && !String(alterErr.message).includes('duplicate column name')) {
                            console.error('Error adding is_approved column:', alterErr);
                        }
                    });
                }

                const hasIsAdmin = (userColumns || []).some((column) => column.name === 'is_admin');
                if (!hasIsAdmin) {
                    db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, (alterErr) => {
                        if (alterErr && !String(alterErr.message).includes('duplicate column name')) {
                            console.error('Error adding is_admin column:', alterErr);
                        }
                    });
                }

                const hasCreatedByAdmin = (userColumns || []).some((column) => column.name === 'created_by_admin');
                if (!hasCreatedByAdmin) {
                    db.run(`ALTER TABLE users ADD COLUMN created_by_admin INTEGER DEFAULT 0`, (alterErr) => {
                        if (alterErr && !String(alterErr.message).includes('duplicate column name')) {
                            console.error('Error adding created_by_admin column:', alterErr);
                        }
                    });
                }

                const hasIsRejected = (userColumns || []).some((column) => column.name === 'is_rejected');
                if (!hasIsRejected) {
                    db.run(`ALTER TABLE users ADD COLUMN is_rejected INTEGER DEFAULT 0`, (alterErr) => {
                        if (alterErr && !String(alterErr.message).includes('duplicate column name')) {
                            console.error('Error adding is_rejected column:', alterErr);
                        }
                    });
                }

                // Set existing admin user (by email) to is_admin=1 and is_approved=1
                const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@luckysusu.com').toLowerCase();
                db.run(`UPDATE users SET is_admin = 1, is_approved = 1 WHERE email = ?`, [ADMIN_EMAIL], (updateErr) => {
                    if (updateErr) {
                        console.error('Error updating admin user:', updateErr);
                    }
                });
            });

            // Check if commission_cycles table exists, create if missing
            db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='commission_cycles'`, (tableErr, tables) => {
                if (tableErr) {
                    reject(tableErr);
                    return;
                }

                if (!tables || tables.length === 0) {
                    // Table doesn't exist, create it
                    db.run(`
                        CREATE TABLE IF NOT EXISTS commission_cycles (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            client_id INTEGER NOT NULL UNIQUE,
                            cumulative_withdrawal REAL DEFAULT 0.00,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
                        )
                    `, (createErr) => {
                        if (createErr) {
                            reject(createErr);
                            return;
                        }
                        
                        // Create index
                        db.run(`CREATE INDEX IF NOT EXISTS idx_commission_cycles_client ON commission_cycles(client_id)`, (indexErr) => {
                            if (indexErr) {
                                reject(indexErr);
                            } else {
                                // Check if messages table exists, create if missing
                                checkMessagesTable(db, resolve, reject);
                            }
                        });
                    });
                } else {
                    // Check if messages table exists, create if missing
                    checkMessagesTable(db, resolve, reject);
                }
            });
        });
    });
}

// Helper function to check and create messages table
function checkMessagesTable(db, resolve, reject) {
    db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'`, (msgTableErr, msgTables) => {
        if (msgTableErr) {
            reject(msgTableErr);
            return;
        }

        if (!msgTables || msgTables.length === 0) {
            // Messages table doesn't exist, create it
            db.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id INTEGER NOT NULL,
                    transaction_id INTEGER,
                    message_type TEXT NOT NULL DEFAULT 'transaction',
                    message TEXT NOT NULL,
                    phone_number TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    sent_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
                )
            `, (createMsgErr) => {
                if (createMsgErr) {
                    reject(createMsgErr);
                    return;
                }
                
                // Create indexes for messages table
                db.run(`CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id)`, (idxErr1) => {
                    if (idxErr1) {
                        reject(idxErr1);
                        return;
                    }
                    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_transaction_id ON messages(transaction_id)`, (idxErr2) => {
                        if (idxErr2) {
                            reject(idxErr2);
                            return;
                        }
                        db.run(`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)`, (idxErr3) => {
                            if (idxErr3) {
                                reject(idxErr3);
                            } else {
                                resolve();
                            }
                        });
                    });
                });
            });
        } else {
            resolve();
        }
    });
}

// Get database instance (single persistent connection)
function getDatabase() {
    if (!dbInstance) {
        dbInstance = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    // Logger might not be available during init, use console as fallback
                    if (typeof require !== 'undefined') {
                        try {
                            const logger = require('./logger');
                            logger.error('Error opening database', { error: err.message });
                        } catch (e) {
                            console.error('Error opening database:', err);
                        }
                    } else {
                        console.error('Error opening database:', err);
                    }
                }
        });
    }
    return dbInstance;
}

function normalizeDateInput(dateInput) {
    if (!dateInput) return null;
    const date = new Date(dateInput);
    if (isNaN(date)) return null;
    return date.toISOString().split('T')[0];
}

function getPreviousDate(dateInput) {
    const date = new Date(dateInput);
    if (isNaN(date)) return null;
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

// Client operations
const Client = {
    // Create a new client
    create: (clientData) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const { name, phone, gender, rate, agent_id } = clientData;
            
            if (!agent_id) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            db.run(
                `INSERT INTO clients (name, phone, gender, rate, current_balance, agent_id) 
                 VALUES (?, ?, ?, ?, 0.00, ?)`,
                [name, phone, gender, rate, agent_id],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ id: this.lastID, ...clientData, current_balance: 0.00 });
                    }
                }
            );
        });
    },

    // Get all clients with pagination (filtered by agent_id)
    // Optimized: Parallel queries, cursor-based pagination option, max offset limit
    getAll: (agentId, page = 1, limit = 50, includeTotal = true, cursor = null) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            // Limit maximum offset to prevent extremely slow queries (max 10,000 offset = page 200 with limit 50)
            const maxOffset = 10000;
            const offset = (page - 1) * limit;
            if (offset > maxOffset) {
                // Use cursor-based pagination for deep pages
                if (!cursor) {
                    // Get cursor for current page
                    db.get(
                        `SELECT id FROM clients WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?`,
                        [agentId, offset],
                        (err, cursorRow) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            if (!cursorRow) {
                                resolve({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
                                return;
                            }
                            // Retry with cursor
                            Client.getAll(agentId, 1, limit, includeTotal, cursorRow.id).then(resolve).catch(reject);
                        }
                    );
                    return;
                }
            }
            
            // Execute count and data queries in parallel for better performance
            let countResult = null;
            let dataResult = null;
            let countDone = !includeTotal;
            let dataDone = false;
            
            const checkComplete = () => {
                if (countDone && dataDone) {
                    const total = includeTotal ? (countResult?.total || 0) : null;
                    resolve({
                        data: dataResult || [],
                        pagination: {
                            page,
                            limit,
                            total: total,
                            totalPages: total !== null ? Math.ceil(total / limit) : null,
                            hasMore: (dataResult?.length || 0) === limit,
                            nextCursor: dataResult && dataResult.length > 0 ? dataResult[dataResult.length - 1].id : null
                        }
                    });
                }
            };
            
            // Get total count in parallel (if needed)
            if (includeTotal) {
                db.get('SELECT COUNT(*) as total FROM clients WHERE agent_id = ?', [agentId], (err, countRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    countResult = countRow;
                    countDone = true;
                    checkComplete();
                });
            }
            
            // Build query with cursor support for deep pagination
            let query, params;
            if (cursor && offset > maxOffset) {
                // Cursor-based pagination (faster for deep pages)
                query = `SELECT * FROM clients WHERE agent_id = ? AND (created_at < (SELECT created_at FROM clients WHERE id = ?) OR (created_at = (SELECT created_at FROM clients WHERE id = ?) AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`;
                params = [agentId, cursor, cursor, cursor, limit];
            } else {
                // Standard OFFSET pagination (faster for first pages)
                query = `SELECT * FROM clients WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
                params = [agentId, limit, offset];
            }
            
            // Get paginated results
            db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                dataResult = rows || [];
                dataDone = true;
                checkComplete();
            });
        });
    },

    // Get all clients for admin (no agent filter) with pagination
    getAllForAdmin: (page = 1, limit = 100, includeTotal = true) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            // Limit maximum offset to prevent extremely slow queries
            const maxOffset = 10000;
            const offset = (page - 1) * limit;
            if (offset > maxOffset) {
                resolve({ 
                    data: [], 
                    pagination: { 
                        page, 
                        limit, 
                        total: null, 
                        totalPages: null,
                        error: 'Pagination limit reached.' 
                    } 
                });
                return;
            }
            
            // Execute count and data queries in parallel
            let countResult = null;
            let dataResult = null;
            let countDone = !includeTotal;
            let dataDone = false;
            
            const checkComplete = () => {
                if (countDone && dataDone) {
                    const total = includeTotal ? (countResult?.total || 0) : null;
                    resolve({
                        data: dataResult || [],
                        pagination: {
                            page,
                            limit,
                            total: total,
                            totalPages: total !== null ? Math.ceil(total / limit) : null,
                            hasMore: (dataResult?.length || 0) === limit
                        }
                    });
                }
            };
            
            // Get total count in parallel (if needed)
            if (includeTotal) {
                db.get('SELECT COUNT(*) as total FROM clients', [], (err, countRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    countResult = countRow;
                    countDone = true;
                    checkComplete();
                });
            }
            
            // Get paginated results
            db.all(
                `SELECT c.*, u.name as agent_name 
                 FROM clients c
                 JOIN users u ON c.agent_id = u.id
                 ORDER BY c.created_at DESC, c.id DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    dataResult = rows || [];
                    dataDone = true;
                    checkComplete();
                }
            );
        });
    },

    // Get client with largest balance per agent
    getLargestAccountsByAgent: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    c.id,
                    c.name,
                    c.phone,
                    c.gender,
                    c.rate,
                    c.current_balance,
                    c.created_at,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM clients c
                 JOIN users u ON c.agent_id = u.id
                 WHERE c.current_balance = (
                     SELECT MAX(c2.current_balance)
                     FROM clients c2
                     WHERE c2.agent_id = c.agent_id
                 )
                 ORDER BY c.current_balance DESC, u.name ASC`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Group by agent to get only one per agent (in case of ties, get the first one)
                        const agentMap = {};
                        (rows || []).forEach(row => {
                            if (!agentMap[row.agent_id]) {
                                agentMap[row.agent_id] = row;
                            }
                        });
                        resolve(Object.values(agentMap).sort((a, b) => parseFloat(b.current_balance) - parseFloat(a.current_balance)));
                    }
                }
            );
        });
    },

    getSmallestAccountsByAgent: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    c.id,
                    c.name,
                    c.phone,
                    c.gender,
                    c.rate,
                    c.current_balance,
                    c.created_at,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM clients c
                 JOIN users u ON c.agent_id = u.id
                 WHERE c.current_balance = (
                     SELECT MIN(c2.current_balance)
                     FROM clients c2
                     WHERE c2.agent_id = c.agent_id
                 )
                 ORDER BY c.current_balance ASC, u.name ASC`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Group by agent to get only one per agent (in case of ties, get the first one)
                        const agentMap = {};
                        (rows || []).forEach(row => {
                            if (!agentMap[row.agent_id]) {
                                agentMap[row.agent_id] = row;
                            }
                        });
                        resolve(Object.values(agentMap).sort((a, b) => parseFloat(a.current_balance) - parseFloat(b.current_balance)));
                    }
                }
            );
        });
    },

    // Get dormant accounts (clients with no deposits in the last 30 days) grouped by agent
    getDormantAccountsByAgent: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    c.id,
                    c.name,
                    c.phone,
                    c.gender,
                    c.rate,
                    c.current_balance,
                    c.created_at,
                    u.id as agent_id,
                    u.name as agent_name,
                    COALESCE(
                        (SELECT MAX(transaction_date) 
                         FROM transactions 
                         WHERE client_id = c.id 
                         AND transaction_type = 'deposit'), 
                        c.created_at
                    ) as last_deposit_date,
                    CASE 
                        WHEN (SELECT MAX(transaction_date) 
                               FROM transactions 
                               WHERE client_id = c.id 
                               AND transaction_type = 'deposit') IS NULL THEN 
                            CAST(julianday('now') - julianday(c.created_at) AS INTEGER)
                        ELSE 
                            CAST(julianday('now') - julianday(
                                (SELECT MAX(transaction_date) 
                                 FROM transactions 
                                 WHERE client_id = c.id 
                                 AND transaction_type = 'deposit')
                            ) AS INTEGER)
                    END as days_since_deposit
                 FROM clients c
                 JOIN users u ON c.agent_id = u.id
                 WHERE NOT EXISTS (
                     SELECT 1 
                     FROM transactions t2 
                     WHERE t2.client_id = c.id 
                     AND t2.transaction_type = 'deposit'
                     AND t2.transaction_date >= date('now', '-30 days')
                 )
                 ORDER BY u.name ASC, days_since_deposit DESC, c.name ASC`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    },

    // Get client by ID (filtered by agent_id for security)
    getById: (id, agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            db.get(
                `SELECT * FROM clients WHERE id = ? AND agent_id = ?`,
                [id, agentId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    },

    // Search clients by name or phone (filtered by agent_id)
    // Optimized: Parallel queries, max offset limit
    search: (searchTerm, agentId, page = 1, limit = 50, includeTotal = true) => {
        return new Promise((resolve, reject) => {
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            if (!searchTerm || searchTerm.trim() === '') {
                resolve({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
                return;
            }
            
            const db = getDatabase();
            const trimmedTerm = searchTerm.trim();
            const searchPattern = `%${trimmedTerm}%`;
            
            // Limit maximum offset to prevent extremely slow queries
            const maxOffset = 10000;
            const offset = (page - 1) * limit;
            if (offset > maxOffset) {
                resolve({ 
                    data: [], 
                    pagination: { 
                        page, 
                        limit, 
                        total: null, 
                        totalPages: null,
                        error: 'Pagination limit reached. Please refine your search.' 
                    } 
                });
                return;
            }
            
            // Extract digits only for phone number search (phone is stored as digits only)
            const phoneDigits = trimmedTerm.replace(/\D/g, '');
            const phonePattern = phoneDigits.length > 0 ? `%${phoneDigits}%` : searchPattern;
            
            console.log('🔎 Database search - Term:', trimmedTerm, 'Agent ID:', agentId, 'Name pattern:', searchPattern, 'Phone pattern:', phonePattern);
            
            // Execute count and data queries in parallel
            let countResult = null;
            let dataResult = null;
            let countDone = !includeTotal;
            let dataDone = false;
            
            const checkComplete = () => {
                if (countDone && dataDone) {
                    const total = includeTotal ? (countResult?.total || 0) : null;
                    resolve({
                        data: dataResult || [],
                        pagination: {
                            page,
                            limit,
                            total: total,
                            totalPages: total !== null ? Math.ceil(total / limit) : null,
                            hasMore: (dataResult?.length || 0) === limit
                        }
                    });
                }
            };
            
            // Get total count in parallel (if needed)
            if (includeTotal) {
                db.get(
                    `SELECT COUNT(*) as total FROM clients 
                     WHERE agent_id = ? AND (LOWER(name) LIKE LOWER(?) OR phone LIKE ?)`,
                    [agentId, searchPattern, phonePattern],
                    (err, countRow) => {
                        if (err) {
                            console.error('❌ Database search count error:', err);
                            reject(err);
                            return;
                        }
                        countResult = countRow;
                        countDone = true;
                        checkComplete();
                    }
                );
            }
            
            // Get paginated results
            db.all(
                `SELECT * FROM clients 
                 WHERE agent_id = ? AND (LOWER(name) LIKE LOWER(?) OR phone LIKE ?)
                 ORDER BY created_at DESC, id DESC
                 LIMIT ? OFFSET ?`,
                [agentId, searchPattern, phonePattern, limit, offset],
                (err, rows) => {
                    if (err) {
                        console.error('❌ Database search error:', err);
                        reject(err);
                        return;
                    }
                    console.log('📊 Database returned', rows?.length || 0, 'rows');
                    dataResult = rows || [];
                    dataDone = true;
                    checkComplete();
                }
            );
        });
    },

    // Update client rate (with commission cycle handling)
    updateRate: (id, newRate, agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            const rateValue = parseFloat(newRate);
            if (isNaN(rateValue) || rateValue < 5) {
                reject(new Error('Rate must be at least ₵5.00'));
                return;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Get current client info
                db.get(
                    'SELECT rate FROM clients WHERE id = ? AND agent_id = ?',
                    [id, agentId],
                    (err, client) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!client) {
                            db.run('ROLLBACK');
                            reject(new Error('Client not found or access denied'));
                            return;
                        }

                        const oldRate = parseFloat(client.rate || 0);

                        // Update client rate
                        db.run(
                            `UPDATE clients SET rate = ?, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = ? AND agent_id = ?`,
                            [rateValue, id, agentId],
                            (updateErr) => {
                                if (updateErr) {
                                    db.run('ROLLBACK');
                                    reject(updateErr);
                                    return;
                                }

                                // Get current commission cycle
                                db.get(
                                    'SELECT cumulative_withdrawal FROM commission_cycles WHERE client_id = ?',
                                    [id],
                                    (cycleErr, cycle) => {
                                        if (cycleErr) {
                                            db.run('ROLLBACK');
                                            reject(cycleErr);
                                            return;
                                        }

                                        const currentCumulative = parseFloat(cycle?.cumulative_withdrawal || 0);
                                        
                                        // Policy: If new rate is lower and cumulative exceeds new rate, deduct commission
                                        // Otherwise, continue with existing cumulative
                                        let newCumulative = currentCumulative;
                                        let commissionDeducted = false;
                                        
                                        if (rateValue < oldRate && currentCumulative >= rateValue) {
                                            // New rate is lower and cumulative exceeds it, deduct commission
                                            newCumulative = currentCumulative - rateValue;
                                            commissionDeducted = true;
                                        }
                                        // If new rate is higher, just continue tracking (no change needed)

                                        // Update commission cycle if needed
                                        if (commissionDeducted) {
                                            db.run(
                                                `INSERT INTO commission_cycles (client_id, cumulative_withdrawal, updated_at)
                                                 VALUES (?, ?, CURRENT_TIMESTAMP)
                                                 ON CONFLICT(client_id) DO UPDATE SET
                                                    cumulative_withdrawal = excluded.cumulative_withdrawal,
                                                    updated_at = CURRENT_TIMESTAMP`,
                                                [id, newCumulative],
                                                (cycleUpdateErr) => {
                                                    if (cycleUpdateErr) {
                                                        db.run('ROLLBACK');
                                                        reject(cycleUpdateErr);
                                                        return;
                                                    }
                                                    db.run('COMMIT');
                                                    resolve({
                                                        id,
                                                        old_rate: oldRate,
                                                        new_rate: rateValue,
                                                        cumulative_adjusted: commissionDeducted,
                                                        new_cumulative: newCumulative
                                                    });
                                                }
                                            );
                                        } else {
                                            db.run('COMMIT');
                                            resolve({
                                                id,
                                                old_rate: oldRate,
                                                new_rate: rateValue,
                                                cumulative_adjusted: false
                                            });
                                        }
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    },

    // Update client name and phone (admin only)
    updateClientInfo: (id, name, phone) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            if (!id || !name || !phone) {
                reject(new Error('Client ID, name, and phone are required'));
                return;
            }
            
            // Validate phone - exactly 10 digits
            const phoneDigits = phone.replace(/\D/g, '');
            if (phoneDigits.length !== 10) {
                reject(new Error('Phone number must contain exactly 10 digits'));
                return;
            }
            
            // Sanitize name
            const sanitizedName = name.trim().replace(/[<>]/g, '');
            if (sanitizedName.length < 2) {
                reject(new Error('Name must be at least 2 characters'));
                return;
            }
            
            db.run(
                `UPDATE clients SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [sanitizedName, phoneDigits, id],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        if (this.changes === 0) {
                            reject(new Error('Client not found'));
                        } else {
                            // Get updated client
                            db.get('SELECT * FROM clients WHERE id = ?', [id], (err, row) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(row);
                                }
                            });
                        }
                    }
                }
            );
        });
    },

    // Update client balance (filtered by agent_id for security)
    updateBalance: (id, newBalance, agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            db.run(
                `UPDATE clients SET current_balance = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ? AND agent_id = ?`,
                [newBalance, id, agentId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        if (this.changes === 0) {
                            reject(new Error('Client not found or access denied'));
                        } else {
                            resolve({ id, current_balance: newBalance });
                        }
                    }
                }
            );
        });
    },

    // Get client statistics (filtered by agent_id)
    getStats: (agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            db.get(
                `SELECT 
                    COUNT(*) as total_clients,
                    SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) as female_count,
                    SUM(CASE WHEN gender = 'Male' THEN 1 ELSE 0 END) as male_count,
                    SUM(CASE WHEN gender NOT IN ('Male', 'Female') THEN 1 ELSE 0 END) as other_count,
                    SUM(current_balance) as total_balance
                 FROM clients
                 WHERE agent_id = ?`,
                [agentId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || {
                            total_clients: 0,
                            male_count: 0,
                            female_count: 0,
                            other_count: 0,
                            total_balance: 0
                        });
                    }
                }
            );
        });
    }
};

// Transaction operations
const Transaction = {
    // Create a new transaction (with transaction wrapper for data integrity)
    create: (transactionData) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const { client_id, amount, transaction_type, transaction_date, notes, agent_id, related_transaction_id } = transactionData;
            
            if (!agent_id) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            // Use transaction to ensure atomicity
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                // Insert transaction
                db.run(
                    `INSERT INTO transactions (client_id, agent_id, amount, transaction_type, transaction_date, notes, related_transaction_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [client_id, agent_id, amount, transaction_type || 'deposit', transaction_date, notes || null, related_transaction_id || null],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        
                        const transactionId = this.lastID;
                        
                        // Get current balance (verify client belongs to agent)
                        db.get('SELECT current_balance FROM clients WHERE id = ? AND agent_id = ?', [client_id, agent_id], (err, client) => {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            
                            if (!client) {
                                db.run('ROLLBACK');
                                reject(new Error('Client not found'));
                                return;
                            }
                            
                            // Update balance - add for deposits, subtract for withdrawals
                            const transactionType = (transaction_type || 'deposit').toLowerCase();
                            const amountValue = parseFloat(amount);
                            // For withdrawals, amount should be negative, so we add it directly
                            // For deposits, amount is positive, so we add it directly
                            const newBalance = (client.current_balance || 0) + amountValue;
                            
                            // For withdrawals/commissions, ensure balance doesn't go negative
                            const restrictedTypes = ['withdrawal', 'commission'];
                            if (restrictedTypes.includes(transactionType) && newBalance < 0) {
                                db.run('ROLLBACK');
                                reject(new Error('Insufficient balance for withdrawal'));
                                return;
                            }
                            
                            db.run(
                                `UPDATE clients SET current_balance = ?, updated_at = CURRENT_TIMESTAMP 
                                 WHERE id = ? AND agent_id = ?`,
                                [newBalance, client_id, agent_id],
                                function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        reject(err);
                                    } else {
                                        db.run('COMMIT');
                                        resolve({ id: transactionId, ...transactionData });
                                    }
                                }
                            );
                        });
                    }
                );
            });
        });
    },

    // Reverse a withdrawal transaction and adjust commission cycle
    reverseWithdrawal: (transactionId, agentId, reason) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Get the withdrawal transaction
                db.get(
                    `SELECT t.*, c.rate as client_rate 
                     FROM transactions t
                     JOIN clients c ON t.client_id = c.id
                     WHERE t.id = ? AND t.agent_id = ? AND t.transaction_type = 'withdrawal'`,
                    [transactionId, agentId],
                    (err, withdrawal) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!withdrawal) {
                            db.run('ROLLBACK');
                            reject(new Error('Withdrawal transaction not found'));
                            return;
                        }

                        const withdrawalAmount = Math.abs(parseFloat(withdrawal.amount));
                        const clientId = withdrawal.client_id;
                        const transactionDate = withdrawal.transaction_date;

                        // Get related commission transaction if exists
                        db.get(
                            `SELECT * FROM transactions 
                             WHERE related_transaction_id = ? AND transaction_type = 'commission'`,
                            [transactionId],
                            (commErr, commission) => {
                                if (commErr) {
                                    db.run('ROLLBACK');
                                    reject(commErr);
                                    return;
                                }

                                const commissionAmount = commission ? Math.abs(parseFloat(commission.amount)) : 0;
                                const commissionId = commission?.id;

                                // Get current client balance
                                db.get(
                                    'SELECT current_balance, rate FROM clients WHERE id = ? AND agent_id = ?',
                                    [clientId, agentId],
                                    (clientErr, client) => {
                                        if (clientErr) {
                                            db.run('ROLLBACK');
                                            reject(clientErr);
                                            return;
                                        }

                                        if (!client) {
                                            db.run('ROLLBACK');
                                            reject(new Error('Client not found'));
                                            return;
                                        }

                                        const currentBalance = parseFloat(client.current_balance || 0);
                                        const clientRate = parseFloat(client.rate || 0);

                                        // Restore balance (add back withdrawal and commission)
                                        const restoredBalance = currentBalance + withdrawalAmount + commissionAmount;

                                        // Get current commission cycle
                                        db.get(
                                            'SELECT cumulative_withdrawal FROM commission_cycles WHERE client_id = ?',
                                            [clientId],
                                            (cycleErr, cycle) => {
                                                if (cycleErr) {
                                                    db.run('ROLLBACK');
                                                    reject(cycleErr);
                                                    return;
                                                }

                                                const currentCumulative = parseFloat(cycle?.cumulative_withdrawal || 0);
                                                
                                                // Calculate threshold for this client
                                                const COMMISSION_THRESHOLD = 31 * clientRate;
                                                
                                                // Adjust cumulative: reverse the page-by-page processing
                                                // With new logic: commission is only deducted when full pages are completed
                                                let newCumulative = currentCumulative;
                                                
                                                if (commissionId && commissionAmount > 0 && clientRate > 0) {
                                                    // Commission was deducted, meaning full pages were completed
                                                    // Number of full pages completed = commissionAmount / clientRate
                                                    const fullPagesCompleted = commissionAmount / clientRate;
                                                    
                                                    // Amount that completed those full pages = fullPagesCompleted × COMMISSION_THRESHOLD
                                                    const amountThatCompletedFullPages = fullPagesCompleted * COMMISSION_THRESHOLD;
                                                    
                                                    // The withdrawal amount = amount that completed full pages + amount added to new cumulative
                                                    // So: amount added to new cumulative = withdrawalAmount - amountThatCompletedFullPages
                                                    const amountAddedToNewCumulative = withdrawalAmount - amountThatCompletedFullPages;
                                                    
                                                    // To reverse: 
                                                    // 1. Current cumulative is what's left in the new incomplete page
                                                    // 2. Subtract the amount that was added to this new cumulative
                                                    // 3. This gives us the cumulative after completing full pages (which should be 0)
                                                    // 4. Then we need to restore what was in the completed pages before
                                                    // 5. Since we don't store that, we estimate: subtract withdrawal, add back full pages
                                                    
                                                    // Start with current cumulative and work backwards
                                                    let tempCumulative = currentCumulative;
                                                    
                                                    // Subtract the amount that was added to the new cumulative
                                                    tempCumulative -= amountAddedToNewCumulative;
                                                    
                                                    // Now we're at the point after completing full pages (should be 0 or close)
                                                    // To get back to before the withdrawal, we need to:
                                                    // - Add back what was in the completed pages (we don't know exactly)
                                                    // - Subtract the withdrawal amount
                                                    
                                                    // Heuristic: assume the completed pages had some amount in them
                                                    // The amount in completed pages = amountThatCompletedFullPages - (withdrawalAmount - amountAddedToNewCumulative)
                                                    // But this is just: amountThatCompletedFullPages - amountThatCompletedFullPages = 0
                                                    // That means we're assuming pages started empty, which may not be true
                                                    
                                                    // Better heuristic: the cumulative before = currentCumulative - withdrawalAmount
                                                    // But if that's negative, we need to add back full pages
                                                    tempCumulative = currentCumulative - withdrawalAmount;
                                                    
                                                    // If negative, add back full pages (uncomplete them)
                                                    while (tempCumulative < 0 && fullPagesCompleted > 0) {
                                                        tempCumulative += COMMISSION_THRESHOLD;
                                                    }
                                                    
                                                    newCumulative = Math.max(0, tempCumulative);
                                                } else {
                                                    // No commission was deducted, just subtract withdrawal amount from cumulative
                                                    newCumulative = Math.max(0, currentCumulative - withdrawalAmount);
                                                }

                                                // Create reversal transaction
                                                const reversalNote = `Reversal of withdrawal #${transactionId}. ${reason || 'Transaction reversed'}`;
                                                db.run(
                                                    `INSERT INTO transactions (client_id, agent_id, amount, transaction_type, transaction_date, notes, related_transaction_id)
                                                     VALUES (?, ?, ?, 'deposit', ?, ?, ?)`,
                                                    [clientId, agentId, withdrawalAmount, transactionDate, reversalNote, transactionId],
                                                    function(revErr) {
                                                        if (revErr) {
                                                            db.run('ROLLBACK');
                                                            reject(revErr);
                                                            return;
                                                        }

                                                        const reversalId = this.lastID;

                                                        // If commission was deducted, create reversal for it too
                                                        const finalize = (commissionReversalId = null) => {
                                                            // Update client balance
                                                            db.run(
                                                                `UPDATE clients SET current_balance = ?, updated_at = CURRENT_TIMESTAMP 
                                                                 WHERE id = ? AND agent_id = ?`,
                                                                [restoredBalance, clientId, agentId],
                                                                (updateErr) => {
                                                                    if (updateErr) {
                                                                        db.run('ROLLBACK');
                                                                        reject(updateErr);
                                                                        return;
                                                                    }

                                                                    // Update commission cycle
                                                                    db.run(
                                                                        `INSERT INTO commission_cycles (client_id, cumulative_withdrawal, updated_at)
                                                                         VALUES (?, ?, CURRENT_TIMESTAMP)
                                                                         ON CONFLICT(client_id) DO UPDATE SET
                                                                            cumulative_withdrawal = excluded.cumulative_withdrawal,
                                                                            updated_at = CURRENT_TIMESTAMP`,
                                                                        [clientId, newCumulative],
                                                                        (cycleUpdateErr) => {
                                                                            if (cycleUpdateErr) {
                                                                                db.run('ROLLBACK');
                                                                                reject(cycleUpdateErr);
                                                                                return;
                                                                            }

                                                                            db.run('COMMIT');
                                                                            resolve({
                                                                                reversal: {
                                                                                    id: reversalId,
                                                                                    client_id: clientId,
                                                                                    amount: withdrawalAmount,
                                                                                    transaction_type: 'deposit',
                                                                                    notes: reversalNote
                                                                                },
                                                                                commission_reversal: commissionReversalId ? {
                                                                                    id: commissionReversalId,
                                                                                    amount: commissionAmount
                                                                                } : null,
                                                                                updated_balance: restoredBalance,
                                                                                updated_cumulative: newCumulative
                                                                            });
                                                                        }
                                                                    );
                                                                }
                                                            );
                                                        };

                                                        if (commissionId && commissionAmount > 0) {
                                                            const commissionReversalNote = `Reversal of commission #${commissionId} (related to withdrawal #${transactionId})`;
                                                            db.run(
                                                                `INSERT INTO transactions (client_id, agent_id, amount, transaction_type, transaction_date, notes, related_transaction_id)
                                                                 VALUES (?, ?, ?, 'deposit', ?, ?, ?)`,
                                                                [clientId, agentId, commissionAmount, transactionDate, commissionReversalNote, commissionId],
                                                                function(commRevErr) {
                                                                    if (commRevErr) {
                                                                        db.run('ROLLBACK');
                                                                        reject(commRevErr);
                                                                        return;
                                                                    }
                                                                    finalize(this.lastID);
                                                                }
                                                            );
                                                        } else {
                                                            finalize();
                                                        }
                                                    }
                                                );
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    },

    // Get commission history for a client
    getCommissionHistory: (clientId, agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            db.all(
                `SELECT 
                    t.id,
                    t.amount,
                    t.transaction_date,
                    t.created_at,
                    t.notes,
                    t.related_transaction_id,
                    w.amount as withdrawal_amount,
                    w.transaction_date as withdrawal_date
                 FROM transactions t
                 LEFT JOIN transactions w ON w.id = t.related_transaction_id
                 WHERE t.client_id = ? AND t.agent_id = ? AND t.transaction_type = 'commission'
                 ORDER BY t.created_at DESC`,
                [clientId, agentId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    },

    createWithdrawalWithCommission: (data) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const {
                client_id,
                agent_id,
                withdrawal_amount,
                transaction_date,
                notes
            } = data;

            if (!agent_id) {
                reject(new Error('agent_id is required'));
                return;
            }

            const withdrawalAmount = parseFloat(withdrawal_amount);

            if (!client_id || isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
                reject(new Error('Valid client_id and withdrawal_amount are required'));
                return;
            }

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Get client info - get client first to retrieve their actual agent_id
                db.get(
                    'SELECT current_balance, rate, agent_id FROM clients WHERE id = ?',
                    [client_id],
                    (err, client) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!client) {
                            db.run('ROLLBACK');
                            reject(new Error('Client not found'));
                            return;
                        }

                        // Verify agent_id matches (authorization check)
                        // Use the client's actual agent_id for the transaction
                        const actualAgentId = client.agent_id;
                        if (agent_id && parseInt(actualAgentId) !== parseInt(agent_id)) {
                            db.run('ROLLBACK');
                            reject(new Error('Client does not belong to the specified agent'));
                            return;
                        }

                        const startingBalance = parseFloat(client.current_balance) || 0;
                        const clientRate = parseFloat(client.rate) || 0;

                        // Validate client rate is positive
                        if (clientRate <= 0) {
                            db.run('ROLLBACK');
                            reject(new Error('Client rate must be greater than 0'));
                            return;
                        }

                        // Check if client has sufficient balance for withdrawal
                        if (startingBalance < withdrawalAmount) {
                            db.run('ROLLBACK');
                            reject(new Error('Insufficient balance for withdrawal'));
                            return;
                        }

                        // Get or create commission cycle record
                        db.get(
                            'SELECT cumulative_withdrawal FROM commission_cycles WHERE client_id = ?',
                            [client_id],
                            (cycleErr, cycle) => {
                                if (cycleErr) {
                                    db.run('ROLLBACK');
                                    reject(cycleErr);
                                    return;
                                }

                                // Get current cumulative withdrawal amount (amount already in current incomplete page)
                                let currentCumulative = parseFloat(cycle?.cumulative_withdrawal || 0);
                                
                                // Commission threshold: 31 boxes = 31 × client rate (one full page)
                                const COMMISSION_THRESHOLD = 31 * clientRate;
                                
                                // Edge case: If cumulative is already at or exceeds threshold, it shouldn't happen
                                // but if it does (due to data inconsistency), reset it to start a new page
                                // This ensures the system can recover from data inconsistencies
                                if (currentCumulative >= COMMISSION_THRESHOLD) {
                                    // Calculate how many full pages are already completed
                                    const fullPagesAlreadyCompleted = Math.floor(currentCumulative / COMMISSION_THRESHOLD);
                                    // Reset to the remainder (amount in current incomplete page)
                                    currentCumulative = currentCumulative % COMMISSION_THRESHOLD;
                                    // Log this for debugging (could be added to error log)
                                    console.warn(`Warning: Client ${client_id} had cumulative (${cycle?.cumulative_withdrawal}) >= threshold (${COMMISSION_THRESHOLD}). Reset to ${currentCumulative}.`);
                                }
                                
                                // Check if client is withdrawing all or most of their balance
                                // Commission should be deducted if balance after withdrawal is <= client rate
                                // This ensures commission is deducted when client withdraws all or most of their money
                                const balanceAfterWithdrawal = startingBalance - withdrawalAmount;
                                const isWithdrawingAllOrMost = balanceAfterWithdrawal <= clientRate;
                                
                                // Process withdrawal page by page
                                // Commission is ONLY deducted when a FULL page (31 boxes) is completed
                                let remainingWithdrawal = withdrawalAmount;
                                let currentPageAmount = currentCumulative; // Amount already accumulated in current incomplete page
                                let totalCommission = 0;
                                let totalGivenToClient = 0;
                                
                                // Process each page until withdrawal is fully processed
                                while (remainingWithdrawal > 0 && clientRate > 0) {
                                    // How much is needed to complete the current page?
                                    const neededForFullPage = COMMISSION_THRESHOLD - currentPageAmount;
                                    
                                    if (remainingWithdrawal >= neededForFullPage) {
                                        // This withdrawal completes the current page (full page)
                                        // Deduct commission for this completed full page
                                        totalCommission += clientRate;
                                        
                                        // Client gets: (amount already in page) + (needed for full page - commission)
                                        // From this page, client gets: currentPageAmount + (neededForFullPage - clientRate)
                                        const clientGetsFromThisPage = currentPageAmount + (neededForFullPage - clientRate);
                                        totalGivenToClient += clientGetsFromThisPage;
                                        
                                        // Update remaining withdrawal
                                        remainingWithdrawal -= neededForFullPage;
                                        
                                        // Move to next page (starts empty)
                                        currentPageAmount = 0;
                                    } else {
                                        // This withdrawal doesn't complete the current page
                                        // Check if this is a full withdrawal - if so, deduct commission even for incomplete page
                                        if (isWithdrawingAllOrMost && remainingWithdrawal > 0) {
                                            // Full withdrawal: commission is deducted from remaining balance, not from withdrawal amount
                                            // Client gets the full withdrawal amount, commission comes from what's left in account
                                            totalCommission += clientRate;
                                            
                                            // Client gets the FULL withdrawal amount (not reduced by commission)
                                            // Commission will be deducted from the remaining balance in the account
                                            const clientGetsFromThisPage = currentPageAmount + remainingWithdrawal;
                                            totalGivenToClient += clientGetsFromThisPage;
                                            
                                            // No remaining withdrawal or cumulative (full withdrawal)
                                            remainingWithdrawal = 0;
                                            currentPageAmount = 0;
                                        } else {
                                            // Normal withdrawal: no commission for incomplete page
                                            currentPageAmount += remainingWithdrawal;
                                            totalGivenToClient += remainingWithdrawal;
                                            remainingWithdrawal = 0;
                                        }
                                    }
                                }
                                
                                // Final values
                                const actualWithdrawalAmount = totalGivenToClient;
                                const commissionToDeduct = totalCommission;
                                const remainingCumulative = currentPageAmount; // Amount left in current incomplete page
                                const shouldDeductCommission = commissionToDeduct > 0;
                                
                                // For full withdrawals, cumulative should always be reset to 0
                                const finalRemainingCumulative = isWithdrawingAllOrMost ? 0 : remainingCumulative;

                                // Calculate total deduction
                                const totalDeduction = actualWithdrawalAmount + commissionToDeduct;

                                // Log commission calculation details for debugging/audit
                                try {
                                    const logger = require('./logger');
                                    logger.info('Commission calculation', {
                                        client_id,
                                        requested_withdrawal: withdrawalAmount,
                                        actual_withdrawal: actualWithdrawalAmount,
                                        commission: commissionToDeduct,
                                        full_pages_completed: commissionToDeduct / clientRate,
                                        cumulative_before: currentCumulative,
                                        cumulative_after: finalRemainingCumulative,
                                        is_full_withdrawal: isWithdrawingAllOrMost,
                                        threshold: COMMISSION_THRESHOLD
                                    });
                                } catch (logErr) {
                                    // Logger might not be available, use console as fallback
                                    console.log(`Commission calculation - Client: ${client_id}, Requested: ₵${withdrawalAmount}, Actual: ₵${actualWithdrawalAmount}, Commission: ₵${commissionToDeduct}, Pages: ${commissionToDeduct / clientRate}`);
                                }

                                // Check if client has sufficient balance for withdrawal + commission (if needed)
                                if (startingBalance < totalDeduction) {
                                    db.run('ROLLBACK');
                                    const shortfall = totalDeduction - startingBalance;
                                    const errorMessage = shouldDeductCommission
                                        ? `Insufficient balance. Withdrawal of ₵${actualWithdrawalAmount.toFixed(2)} plus commission of ₵${commissionToDeduct.toFixed(2)} requires ₵${totalDeduction.toFixed(2)} total, but client balance is only ₵${startingBalance.toFixed(2)}. Shortfall: ₵${shortfall.toFixed(2)}.`
                                        : `Insufficient balance. Withdrawal of ₵${actualWithdrawalAmount.toFixed(2)} exceeds available balance of ₵${startingBalance.toFixed(2)}.`;
                                    reject(new Error(errorMessage));
                                    return;
                                }

                                // Insert withdrawal transaction (use actual withdrawal amount)
                                db.run(
                                    `INSERT INTO transactions (client_id, agent_id, amount, transaction_type, transaction_date, notes, related_transaction_id)
                                     VALUES (?, ?, ?, 'withdrawal', ?, ?, NULL)`,
                                    [client_id, actualAgentId, -actualWithdrawalAmount, transaction_date, notes || null],
                                    function(insertErr) {
                                        if (insertErr) {
                                            db.run('ROLLBACK');
                                            reject(insertErr);
                                            return;
                                        }

                                        const withdrawalTransactionId = this.lastID;

                                        // Function to finalize the transaction
                                        const finalize = (commissionTransactionId = null) => {
                                            const finalBalance = startingBalance - totalDeduction;
                                            
                                            // Update client balance
                                            db.run(
                                                `UPDATE clients SET current_balance = ?, updated_at = CURRENT_TIMESTAMP 
                                                 WHERE id = ? AND agent_id = ?`,
                                                [finalBalance, client_id, actualAgentId],
                                                (updateErr) => {
                                                    if (updateErr) {
                                                        db.run('ROLLBACK');
                                                        reject(updateErr);
                                                        return;
                                                    }

                                                    // Update or insert commission cycle
                                                    db.run(
                                                        `INSERT INTO commission_cycles (client_id, cumulative_withdrawal, updated_at)
                                                         VALUES (?, ?, CURRENT_TIMESTAMP)
                                                         ON CONFLICT(client_id) DO UPDATE SET
                                                            cumulative_withdrawal = excluded.cumulative_withdrawal,
                                                            updated_at = CURRENT_TIMESTAMP`,
                                                        [client_id, finalRemainingCumulative],
                                                        (cycleUpdateErr) => {
                                                            if (cycleUpdateErr) {
                                                                db.run('ROLLBACK');
                                                                reject(cycleUpdateErr);
                                                                return;
                                                            }

                                                            db.run('COMMIT');
                                                            resolve({
                                                                withdrawal: {
                                                                    id: withdrawalTransactionId,
                                                                    client_id,
                                                                    agent_id: actualAgentId,
                                                                    amount: -actualWithdrawalAmount,
                                                                    transaction_type: 'withdrawal',
                                                                    transaction_date,
                                                                    notes: notes || null
                                                                },
                                                                commission: commissionTransactionId
                                                                    ? {
                                                                        id: commissionTransactionId,
                                                                        client_id,
                                                                        agent_id: actualAgentId,
                                                                        amount: -commissionToDeduct,
                                                                        transaction_type: 'commission',
                                                                        transaction_date,
                                                                        notes: `Auto commission (31st box) - cumulative withdrawals reached threshold`
                                                                    }
                                                                    : null,
                                                                totals: {
                                                                    withdrawal_amount: actualWithdrawalAmount,
                                                                    requested_amount: withdrawalAmount,
                                                                    commission_amount: commissionToDeduct,
                                                                    total_deduction: totalDeduction,
                                                                    remaining_balance: finalBalance,
                                                                    client_rate: clientRate,
                                                                    cumulative_before: currentCumulative,
                                                                    cumulative_after: finalRemainingCumulative,
                                                                    commission_deducted: shouldDeductCommission,
                                                                    full_withdrawal: isWithdrawingAllOrMost
                                                                }
                                                            });
                                                        }
                                                    );
                                                }
                                            );
                                        };

                                        // If commission should be deducted, create commission transaction
                                        if (shouldDeductCommission && commissionToDeduct > 0) {
                                            let commissionNote;
                                            if (isWithdrawingAllOrMost) {
                                                commissionNote = `Auto commission (31st box) - deducted due to full/complete withdrawal (client withdrawing all/most of balance)`;
                                            } else {
                                                // Calculate how many full pages were completed
                                                // Each full page gives 1 × clientRate commission
                                                const fullPagesCompleted = commissionToDeduct / clientRate;
                                                const pagesText = fullPagesCompleted === 1 ? 'page' : 'pages';
                                                commissionNote = `Auto commission (31st box) - ${fullPagesCompleted} full ${pagesText} completed (threshold: ₵${COMMISSION_THRESHOLD.toFixed(2)} = 31 boxes per page)`;
                                            }
                                            db.run(
                                                `INSERT INTO transactions (client_id, agent_id, amount, transaction_type, transaction_date, notes, related_transaction_id)
                                                 VALUES (?, ?, ?, 'commission', ?, ?, ?)`,
                                                [client_id, actualAgentId, -commissionToDeduct, transaction_date, commissionNote, withdrawalTransactionId],
                                                function(commissionErr) {
                                                    if (commissionErr) {
                                                        db.run('ROLLBACK');
                                                        reject(commissionErr);
                                                        return;
                                                    }

                                                    finalize(this.lastID);
                                                }
                                            );
                                        } else {
                                            // No commission deducted, just update cycle
                                            finalize();
                                        }
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    },

    // Get transactions for a client
    // Optimized: Parallel queries, max offset limit
    getByClientId: (clientId, agentId, page = 1, limit = 50, includeTotal = true) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            // Limit maximum offset to prevent extremely slow queries
            const maxOffset = 10000;
            const offset = (page - 1) * limit;
            if (offset > maxOffset) {
                resolve({ 
                    data: [], 
                    pagination: { 
                        page, 
                        limit, 
                        total: null, 
                        totalPages: null,
                        error: 'Pagination limit reached. Please refine your search.' 
                    } 
                });
                return;
            }
            
            // Execute count and data queries in parallel
            let countResult = null;
            let dataResult = null;
            let countDone = !includeTotal;
            let dataDone = false;
            
            const checkComplete = () => {
                if (countDone && dataDone) {
                    const total = includeTotal ? (countResult?.total || 0) : null;
                    resolve({
                        data: dataResult || [],
                        pagination: {
                            page,
                            limit,
                            total: total,
                            totalPages: total !== null ? Math.ceil(total / limit) : null,
                            hasMore: (dataResult?.length || 0) === limit
                        }
                    });
                }
            };
            
            // Get total count in parallel (if needed)
            if (includeTotal) {
                db.get('SELECT COUNT(*) as total FROM transactions WHERE client_id = ? AND agent_id = ?', [clientId, agentId], (err, countRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    countResult = countRow;
                    countDone = true;
                    checkComplete();
                });
            }
            
            // Get paginated results (using composite index for optimal performance)
            db.all(
                `SELECT * FROM transactions 
                 WHERE client_id = ? AND agent_id = ? 
                 ORDER BY transaction_date DESC, created_at DESC, id DESC
                 LIMIT ? OFFSET ?`,
                [clientId, agentId, limit, offset],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    dataResult = rows || [];
                    dataDone = true;
                    checkComplete();
                }
            );
        });
    },

    // Get transactions by date (filtered by agent_id)
    // Optimized: Parallel queries, max offset limit, better JOIN optimization
    getByDate: (date, agentId, page = 1, limit = 100, includeTotal = true) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            
            // Limit maximum offset to prevent extremely slow queries
            const maxOffset = 10000;
            const offset = (page - 1) * limit;
            if (offset > maxOffset) {
                resolve({ 
                    data: [], 
                    pagination: { 
                        page, 
                        limit, 
                        total: null, 
                        totalPages: null,
                        error: 'Pagination limit reached. Please refine your search.' 
                    } 
                });
                return;
            }
            
            // Execute count and data queries in parallel
            let countResult = null;
            let dataResult = null;
            let countDone = !includeTotal;
            let dataDone = false;
            
            const checkComplete = () => {
                if (countDone && dataDone) {
                    const total = includeTotal ? (countResult?.total || 0) : null;
                    resolve({
                        data: dataResult || [],
                        pagination: {
                            page,
                            limit,
                            total: total,
                            totalPages: total !== null ? Math.ceil(total / limit) : null,
                            hasMore: (dataResult?.length || 0) === limit
                        }
                    });
                }
            };
            
            // Get total count in parallel (if needed) - optimized query without JOIN
            if (includeTotal) {
                db.get(
                    `SELECT COUNT(*) as total 
                     FROM transactions t
                     WHERE t.transaction_date = ? AND t.agent_id = ?`,
                    [date, agentId],
                    (err, countRow) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        countResult = countRow;
                        countDone = true;
                        checkComplete();
                    }
                );
            }
            
            // Get paginated results - JOIN only for data query (using composite index)
            db.all(
                `SELECT t.*, c.name as client_name, c.phone as client_phone 
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 WHERE t.transaction_date = ? AND t.agent_id = ? AND c.agent_id = ?
                 ORDER BY t.created_at DESC, t.id DESC
                 LIMIT ? OFFSET ?`,
                [date, agentId, agentId, limit, offset],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    dataResult = rows || [];
                    dataDone = true;
                    checkComplete();
                }
            );
        });
    },

    // Get largest deposit per agent for a specific date
    getLargestDepositsByAgent: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    t.id,
                    t.amount,
                    t.transaction_type,
                    t.transaction_date,
                    t.notes,
                    t.created_at,
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date = ? 
                   AND t.transaction_type = 'deposit'
                   AND t.amount = (
                       SELECT MAX(t2.amount)
                       FROM transactions t2
                       WHERE t2.agent_id = t.agent_id
                         AND t2.transaction_date = t.transaction_date
                         AND t2.transaction_type = 'deposit'
                   )
                 ORDER BY t.amount DESC, u.name ASC`,
                [date],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Group by agent to get only one per agent (in case of ties, get the first one)
                        const agentMap = {};
                        (rows || []).forEach(row => {
                            if (!agentMap[row.agent_id]) {
                                agentMap[row.agent_id] = row;
                            }
                        });
                        resolve(Object.values(agentMap).sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)));
                    }
                }
            );
        });
    },

    // Get smallest deposit per agent for a specific date
    getSmallestDepositsByAgent: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    t.id,
                    t.amount,
                    t.transaction_type,
                    t.transaction_date,
                    t.notes,
                    t.created_at,
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date = ? 
                   AND t.transaction_type = 'deposit'
                   AND t.amount = (
                       SELECT MIN(t2.amount)
                       FROM transactions t2
                       WHERE t2.agent_id = t.agent_id
                         AND t2.transaction_date = t.transaction_date
                         AND t2.transaction_type = 'deposit'
                   )
                 ORDER BY t.amount ASC, u.name ASC`,
                [date],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Group by agent to get only one per agent (in case of ties, get the first one)
                        const agentMap = {};
                        (rows || []).forEach(row => {
                            if (!agentMap[row.agent_id]) {
                                agentMap[row.agent_id] = row;
                            }
                        });
                        resolve(Object.values(agentMap).sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount)));
                    }
                }
            );
        });
    },

    // Get clients who deposited the least for a specific date (all clients with minimum deposit amount)
    getSmallestDailyDeposits: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            // First, find the minimum deposit amount for the day
            db.get(
                `SELECT MIN(amount) as min_amount
                 FROM transactions
                 WHERE transaction_date = ? AND transaction_type = 'deposit'`,
                [date],
                (err, minRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    if (!minRow || minRow.min_amount === null) {
                        resolve([]);
                        return;
                    }
                    
                    // Then get all clients who made deposits of that minimum amount
                    db.all(
                        `SELECT 
                            t.id,
                            t.amount,
                            t.transaction_type,
                            t.transaction_date,
                            t.notes,
                            t.created_at,
                            c.id as client_id,
                            c.name as client_name,
                            c.phone as client_phone,
                            u.id as agent_id,
                            u.name as agent_name
                         FROM transactions t
                         JOIN clients c ON t.client_id = c.id
                         JOIN users u ON t.agent_id = u.id
                         WHERE t.transaction_date = ? 
                           AND t.transaction_type = 'deposit'
                           AND t.amount = ?
                         ORDER BY t.created_at ASC, u.name ASC`,
                        [date, minRow.min_amount],
                        (err2, rows) => {
                            if (err2) {
                                reject(err2);
                            } else {
                                resolve(rows || []);
                            }
                        }
                    );
                }
            );
        });
    },

    // Get all daily deposits for admin (no agent filter)
    getDailyDeposits: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    t.id,
                    t.amount,
                    t.transaction_type,
                    t.transaction_date,
                    t.notes,
                    t.created_at,
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    u.id as agent_id,
                    u.name as agent_name,
                    ads.status as agent_status,
                    ads.decided_by,
                    ads.decided_at
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 JOIN users u ON t.agent_id = u.id
                 LEFT JOIN agent_daily_status ads 
                    ON ads.agent_id = t.agent_id 
                    AND ads.transaction_date = t.transaction_date
                 WHERE t.transaction_date = ? AND t.transaction_type = 'deposit'
                 ORDER BY t.created_at DESC`,
                [date],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    db.all(
                        `SELECT agent_id, status, decided_by, decided_at, note 
                         FROM agent_daily_status 
                         WHERE transaction_date = ?`,
                        [date],
                        (statusErr, statusRows) => {
                            if (statusErr) {
                                reject(statusErr);
                                return;
                            }

                            const totalAmount = (rows || []).reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
                            const statusMap = {};
                            (statusRows || []).forEach((row) => {
                                statusMap[String(row.agent_id)] = {
                                    status: row.status,
                                    decided_by: row.decided_by,
                                    decided_at: row.decided_at,
                                    note: row.note
                                };
                            });

                            resolve({
                                transactions: rows || [],
                                total_amount: totalAmount,
                                date: date,
                                statuses: statusMap
                            });
                        }
                    );
                }
            );
        });
    },

    deleteAgentTransactionsForDate: (agentId, date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.all(
                    `SELECT id, client_id, amount 
                     FROM transactions 
                     WHERE agent_id = ? AND transaction_date = ? AND transaction_type = 'deposit'`,
                    [agentId, date],
                    (err, rows) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        const transactions = rows || [];
                        const adjustNext = (index) => {
                            if (index >= transactions.length) {
                                db.run(
                                    `DELETE FROM transactions WHERE agent_id = ? AND transaction_date = ? AND transaction_type = 'deposit'`,
                                    [agentId, date],
                                    (deleteErr) => {
                                        if (deleteErr) {
                                            db.run('ROLLBACK');
                                            reject(deleteErr);
                                        } else {
                                            db.run('COMMIT');
                                            resolve(transactions.length);
                                        }
                                    }
                                );
                                return;
                            }

                            const tx = transactions[index];
                            const delta = parseFloat(tx.amount) || 0;
                            db.run(
                                `UPDATE clients 
                                 SET current_balance = current_balance - ?, updated_at = CURRENT_TIMESTAMP 
                                 WHERE id = ? AND agent_id = ?`,
                                [delta, tx.client_id, agentId],
                                (updateErr) => {
                                    if (updateErr) {
                                        db.run('ROLLBACK');
                                        reject(updateErr);
                                    } else {
                                        adjustNext(index + 1);
                                    }
                                }
                            );
                        };

                        adjustNext(0);
                    }
                );
            });
        });
    },

    // Get active accounts - clients who received deposits on at least 3 days in a week, grouped by agent
    getActiveAccountsByAgent: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            // Find clients who have deposits on at least 3 distinct days in the week
            db.all(
                `SELECT 
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    c.gender,
                    c.rate,
                    c.current_balance,
                    u.id as agent_id,
                    u.name as agent_name,
                    COUNT(DISTINCT t.transaction_date) as deposit_days,
                    MIN(t.transaction_date) as first_deposit_date,
                    MAX(t.transaction_date) as last_deposit_date,
                    SUM(t.amount) as total_deposits
                 FROM clients c
                 JOIN users u ON c.agent_id = u.id
                 JOIN transactions t ON t.client_id = c.id
                 WHERE t.transaction_type = 'deposit'
                   AND t.transaction_date >= ?
                   AND t.transaction_date <= ?
                 GROUP BY c.id, c.name, c.phone, c.gender, c.rate, c.current_balance, u.id, u.name
                 HAVING COUNT(DISTINCT t.transaction_date) >= 3
                 ORDER BY u.name ASC, deposit_days DESC, c.name ASC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Group by agent
                        const accountsByAgent = {};
                        (rows || []).forEach(row => {
                            const agentId = row.agent_id;
                            if (!accountsByAgent[agentId]) {
                                accountsByAgent[agentId] = {
                                    agent_id: agentId,
                                    agent_name: row.agent_name,
                                    clients: []
                                };
                            }
                            accountsByAgent[agentId].clients.push({
                                client_id: row.client_id,
                                client_name: row.client_name,
                                client_phone: row.client_phone,
                                gender: row.gender,
                                rate: row.rate,
                                current_balance: row.current_balance,
                                deposit_days: row.deposit_days,
                                first_deposit_date: row.first_deposit_date,
                                last_deposit_date: row.last_deposit_date,
                                total_deposits: row.total_deposits
                            });
                        });
                        
                        // Convert to array and sort by agent name
                        resolve(Object.values(accountsByAgent).sort((a, b) => 
                            a.agent_name.localeCompare(b.agent_name)
                        ));
                    }
                }
            );
        });
    },

    // Get weekly deposits grouped by agent
    getWeeklyDeposits: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(t.amount) as total_amount,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as transaction_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ? 
                   AND t.transaction_type = 'deposit'
                 GROUP BY u.id, u.name
                 ORDER BY total_amount DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate overall total
                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);

                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    },

    // Get monthly deposits grouped by agent
    getMonthlyDeposits: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(t.amount) as total_amount,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as transaction_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ? 
                   AND t.transaction_type = 'deposit'
                 GROUP BY u.id, u.name
                 ORDER BY total_amount DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate overall total
                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);

                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    },

    // Get all daily withdrawals for admin (no agent filter)
    getDailyWithdrawals: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    t.id,
                    t.amount,
                    t.transaction_type,
                    t.transaction_date,
                    t.notes,
                    t.created_at,
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date = ? AND t.transaction_type = 'withdrawal'
                 ORDER BY t.created_at DESC`,
                [date],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate total amount withdrawn (use absolute value since withdrawals are negative)
                    const totalAmount = Math.abs((rows || []).reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0));

                    resolve({
                        transactions: rows || [],
                        total_amount: totalAmount,
                        date: date
                    });
                }
            );
        });
    },

    // Get weekly withdrawals grouped by agent
    getWeeklyWithdrawals: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(ABS(t.amount)) as total_amount,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as transaction_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ? 
                   AND t.transaction_type = 'withdrawal'
                 GROUP BY u.id, u.name
                 ORDER BY total_amount DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate overall total (use absolute value since withdrawals are negative)
                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);

                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    },

    // Get client withdrawals for a specific agent within a date range
    getAgentClientWithdrawals: (agentId, startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    SUM(ABS(t.amount)) as total_withdrawn,
                    COUNT(t.id) as transaction_count,
                    MIN(t.transaction_date) as first_withdrawal,
                    MAX(t.transaction_date) as last_withdrawal
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 WHERE t.agent_id = ? 
                   AND t.transaction_date >= ? 
                   AND t.transaction_date <= ? 
                   AND t.transaction_type = 'withdrawal'
                 GROUP BY c.id, c.name, c.phone
                 ORDER BY total_withdrawn DESC`,
                [agentId, startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(rows || []);
                }
            );
        });
    },

    // Get monthly withdrawals grouped by agent
    getMonthlyWithdrawals: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(ABS(t.amount)) as total_amount,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as transaction_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ? 
                   AND t.transaction_type = 'withdrawal'
                 GROUP BY u.id, u.name
                 ORDER BY total_amount DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Calculate overall total (use absolute value since withdrawals are negative)
                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);

                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    },

    getDailyCommissions: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();

            db.all(
                `SELECT 
                    t.id as commission_id,
                    ABS(t.amount) as commission_amount,
                    t.transaction_date,
                    t.created_at,
                    t.notes as commission_notes,
                    w.id as withdrawal_id,
                    ABS(w.amount) as withdrawal_amount,
                    w.created_at as withdrawal_created_at,
                    c.id as client_id,
                    c.name as client_name,
                    c.phone as client_phone,
                    c.rate as client_rate,
                    u.id as agent_id,
                    u.name as agent_name
                 FROM transactions t
                 JOIN clients c ON t.client_id = c.id
                 JOIN users u ON t.agent_id = u.id
                 LEFT JOIN transactions w ON w.id = t.related_transaction_id
                 WHERE t.transaction_date = ? AND t.transaction_type = 'commission'
                 ORDER BY t.created_at DESC`,
                [date],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const totalAmount = (rows || []).reduce((sum, row) => sum + (parseFloat(row.commission_amount) || 0), 0);
                    resolve({
                        commissions: rows || [],
                        total_amount: totalAmount,
                        date
                    });
                }
            );
        });
    },

    getWeeklyCommissions: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();

            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(ABS(t.amount)) as total_commission,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as commission_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ?
                   AND t.transaction_type = 'commission'
                 GROUP BY u.id, u.name
                 ORDER BY total_commission DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_commission) || 0), 0);
                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    },

    getMonthlyCommissions: (startDate, endDate) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();

            db.all(
                `SELECT 
                    u.id as agent_id,
                    u.name as agent_name,
                    SUM(ABS(t.amount)) as total_commission,
                    COUNT(DISTINCT t.client_id) as unique_clients,
                    COUNT(t.id) as commission_count
                 FROM transactions t
                 JOIN users u ON t.agent_id = u.id
                 WHERE t.transaction_date >= ? AND t.transaction_date <= ?
                   AND t.transaction_type = 'commission'
                 GROUP BY u.id, u.name
                 ORDER BY total_commission DESC`,
                [startDate, endDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const overallTotal = (rows || []).reduce((sum, row) => sum + (parseFloat(row.total_commission) || 0), 0);
                    resolve({
                        agents: rows || [],
                        overall_total: overallTotal,
                        start_date: startDate,
                        end_date: endDate
                    });
                }
            );
        });
    }
};

const AgentDailyStatus = {
    ensureCanRecord: (agentId, targetDate) => {
        return new Promise((resolve, reject) => {
            const normalizedDate = normalizeDateInput(targetDate);
            if (!normalizedDate) {
                resolve();
                return;
            }

            const db = getDatabase();

            // First, check if the target date (today) is already approved
            // If approved, agent cannot add more deposits for that day
            db.get(
                `SELECT status FROM agent_daily_status WHERE agent_id = ? AND transaction_date = ?`,
                [agentId, normalizedDate],
                (targetStatusErr, targetStatusRow) => {
                    if (targetStatusErr) {
                        reject(targetStatusErr);
                        return;
                    }

                    if (targetStatusRow && targetStatusRow.status === 'approved') {
                        reject(new Error('This day has already been approved by admin. You cannot add more deposits for this day.'));
                        return;
                    }

                    // Now check if the previous day was approved (required to proceed with today)
                    const previousDate = getPreviousDate(normalizedDate);
                    if (!previousDate) {
                        resolve();
                        return;
                    }

                    db.get(
                        `SELECT status FROM agent_daily_status WHERE agent_id = ? AND transaction_date = ?`,
                        [agentId, previousDate],
                        (statusErr, statusRow) => {
                            if (statusErr) {
                                reject(statusErr);
                                return;
                            }

                            if (statusRow) {
                                if (statusRow.status !== 'approved') {
                                    reject(new Error('Awaiting admin approval for the previous day. Please wait for approval before recording the next day.'));
                                } else {
                                    resolve();
                                }
                                return;
                            }

                            // If no status record exists, check if there are transactions for previous day
                            // If there are transactions but no status, it means pending approval
                            db.get(
                                `SELECT COUNT(*) as total 
                                 FROM transactions 
                                 WHERE agent_id = ? AND transaction_date = ? AND transaction_type = 'deposit'`,
                                [agentId, previousDate],
                                (err, row) => {
                                    if (err) {
                                        reject(err);
                                    } else if (row && row.total > 0) {
                                        reject(new Error('Awaiting admin approval for the previous day. Please wait for approval before recording the next day.'));
                                    } else {
                                        resolve();
                                    }
                                }
                            );
                        }
                    );
                }
            );
        });
    },

    upsertPending: (agentId, date) => {
        return new Promise((resolve, reject) => {
            const normalizedDate = normalizeDateInput(date);
            if (!normalizedDate) {
                resolve();
                return;
            }
            const db = getDatabase();
            db.run(
                `INSERT INTO agent_daily_status (agent_id, transaction_date, status)
                 VALUES (?, ?, 'pending')
                 ON CONFLICT(agent_id, transaction_date) DO UPDATE SET 
                    status = 'pending',
                    decided_by = NULL,
                    decided_at = NULL,
                    note = NULL`,
                [agentId, normalizedDate],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    },

    setStatus: (agentId, date, status, decidedBy, note) => {
        return new Promise((resolve, reject) => {
            const normalizedDate = normalizeDateInput(date);
            if (!normalizedDate) {
                reject(new Error('Invalid date'));
                return;
            }
            const db = getDatabase();
            db.run(
                `INSERT INTO agent_daily_status (agent_id, transaction_date, status, decided_by, decided_at, note)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                 ON CONFLICT(agent_id, transaction_date) DO UPDATE SET
                    status = excluded.status,
                    decided_by = excluded.decided_by,
                    decided_at = CURRENT_TIMESTAMP,
                    note = excluded.note`,
                [agentId, normalizedDate, status, decidedBy || null, note || null],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    },

    getStatusesByDate: (date) => {
        return new Promise((resolve, reject) => {
            const normalizedDate = normalizeDateInput(date);
            if (!normalizedDate) {
                resolve({});
                return;
            }
            const db = getDatabase();
            db.all(
                `SELECT agent_id, status, decided_by, decided_at, note
                 FROM agent_daily_status
                 WHERE transaction_date = ?`,
                [normalizedDate],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const result = {};
                        (rows || []).forEach(row => {
                            result[String(row.agent_id)] = {
                                status: row.status,
                                decided_by: row.decided_by,
                                decided_at: row.decided_at,
                                note: row.note
                            };
                        });
                        resolve(result);
                    }
                }
            );
        });
    },

    approveDay: (agentId, date, decidedBy, note) => {
        return AgentDailyStatus.setStatus(agentId, date, 'approved', decidedBy, note);
    },

    rejectDay: async (agentId, date, decidedBy, note) => {
        await Transaction.deleteAgentTransactionsForDate(agentId, date);
        await AgentDailyStatus.setStatus(agentId, date, 'rejected', decidedBy, note);
    }
};

// User operations
const User = {
    // Create a new user (agent or admin)
    create: (userData) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const { 
                name, 
                email, 
                password, 
                contact, 
                validation_card_number, 
                guarantor_number, 
                guarantor_validation_number,
                is_admin = false,
                is_approved = false,
                created_by_admin = false
            } = userData;
            
            // For agents registering themselves: is_approved = false, is_admin = false, created_by_admin = false
            // For admins created by admin: is_admin = true, is_approved = true, created_by_admin = true
            db.run(
                `INSERT INTO users (name, email, password, contact, validation_card_number, guarantor_number, guarantor_validation_number, is_admin, is_approved, created_by_admin) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name, 
                    email, 
                    password, 
                    contact, 
                    validation_card_number, 
                    guarantor_number, 
                    guarantor_validation_number,
                    is_admin ? 1 : 0,
                    is_approved ? 1 : 0,
                    created_by_admin ? 1 : 0
                ],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ 
                            id: this.lastID, 
                            name, 
                            email, 
                            contact,
                            is_admin: is_admin ? 1 : 0,
                            is_approved: is_approved ? 1 : 0,
                            created_by_admin: created_by_admin ? 1 : 0
                        });
                    }
                }
            );
        });
    },

    // Get user by email
    getByEmail: (email) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.get(
                `SELECT * FROM users WHERE email = ?`,
                [email],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Convert integer fields to boolean for consistency
                        if (row) {
                            row.is_admin = row.is_admin === 1 || row.is_admin === true;
                            row.is_approved = row.is_approved === 1 || row.is_approved === true;
                            row.is_rejected = (row.is_rejected === 1 || row.is_rejected === true);
                            row.created_by_admin = row.created_by_admin === 1 || row.created_by_admin === true;
                        }
                        resolve(row);
                    }
                }
            );
        });
    },

    // Get user by ID
    getById: (id) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.get(
                `SELECT id, name, email, contact, is_admin, is_approved, is_rejected, created_by_admin, created_at FROM users WHERE id = ?`,
                [id],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Convert integer fields to boolean
                        if (row) {
                            row.is_admin = row.is_admin === 1 || row.is_admin === true;
                            row.is_approved = row.is_approved === 1 || row.is_approved === true;
                            row.is_rejected = (row.is_rejected === 1 || row.is_rejected === true);
                            row.created_by_admin = row.created_by_admin === 1 || row.created_by_admin === true;
                        }
                        resolve(row);
                    }
                }
            );
        });
    },

    // Get all users (agents) - for admin
    getAll: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.all(
                `SELECT id, name, email, contact, guarantor_number, guarantor_validation_number, 
                        is_admin, is_approved, is_rejected, created_by_admin, created_at 
                 FROM users 
                 ORDER BY created_at DESC`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Convert integer fields to boolean
                        const formattedRows = (rows || []).map(row => ({
                            ...row,
                            is_admin: row.is_admin === 1 || row.is_admin === true,
                            is_approved: row.is_approved === 1 || row.is_approved === true,
                            is_rejected: (row.is_rejected === 1 || row.is_rejected === true),
                            created_by_admin: row.created_by_admin === 1 || row.created_by_admin === true
                        }));
                        resolve(formattedRows);
                    }
                }
            );
        });
    },

    // Approve an agent
    approveAgent: (agentId, approvedBy) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.run(
                `UPDATE users SET is_approved = 1, is_rejected = 0 WHERE id = ? AND is_admin = 0`,
                [agentId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ id: agentId, approved: true });
                    }
                }
            );
        });
    },

    // Reject an agent - marks as rejected so it won't appear in pending list
    rejectAgent: (agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.run(
                `UPDATE users SET is_approved = 0, is_rejected = 1 WHERE id = ? AND is_admin = 0`,
                [agentId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ id: agentId, approved: false, rejected: true });
                    }
                }
            );
        });
    },

    // Get agent statistics (client count, male/female counts, total balance)
    getAgentStats: (agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            if (!agentId) {
                reject(new Error('agent_id is required'));
                return;
            }
            db.get(
                `SELECT 
                    COUNT(*) as total_clients,
                    SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) as female_count,
                    SUM(CASE WHEN gender = 'Male' THEN 1 ELSE 0 END) as male_count,
                    SUM(CASE WHEN gender NOT IN ('Male', 'Female') THEN 1 ELSE 0 END) as other_count,
                    SUM(current_balance) as total_balance
                 FROM clients
                 WHERE agent_id = ?`,
                [agentId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || {
                            total_clients: 0,
                            male_count: 0,
                            female_count: 0,
                            other_count: 0,
                            total_balance: 0
                        });
                    }
                }
            );
        });
    },

    // Get admin dashboard statistics
    getAdminDashboardStats: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            
            // Get total agents count
            db.get(
                `SELECT COUNT(*) as total_agents FROM users`,
                [],
                (err, agentRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Get total clients and gender breakdown
                    db.get(
                        `SELECT 
                            COUNT(*) as total_clients,
                            SUM(CASE WHEN gender = 'Female' THEN 1 ELSE 0 END) as female_count,
                            SUM(CASE WHEN gender = 'Male' THEN 1 ELSE 0 END) as male_count,
                            SUM(CASE WHEN gender NOT IN ('Male', 'Female') THEN 1 ELSE 0 END) as other_count
                         FROM clients`,
                        [],
                        (err2, clientRow) => {
                            if (err2) {
                                reject(err2);
                                return;
                            }
                            
                            resolve({
                                total_agents: agentRow?.total_agents || 0,
                                total_clients: clientRow?.total_clients || 0,
                                female_count: clientRow?.female_count || 0,
                                male_count: clientRow?.male_count || 0,
                                other_count: clientRow?.other_count || 0
                            });
                        }
                    );
                }
            );
        });
    },

    // Get today's summary statistics
    getTodayStats: (date) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const today = date || new Date().toISOString().split('T')[0];
            
            // Get new clients created today
            db.get(
                `SELECT COUNT(*) as new_clients_today 
                 FROM clients 
                 WHERE DATE(created_at) = ?`,
                [today],
                (err, newClientsRow) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Get total deposits today
                    db.get(
                        `SELECT COALESCE(SUM(amount), 0) as total_deposits 
                         FROM transactions 
                         WHERE transaction_date = ? AND transaction_type = 'deposit'`,
                        [today],
                        (err2, depositsRow) => {
                            if (err2) {
                                reject(err2);
                                return;
                            }
                            
                            // Get total withdrawals today
                            db.get(
                                `SELECT COALESCE(SUM(amount), 0) as total_withdrawals 
                                 FROM transactions 
                                 WHERE transaction_date = ? AND transaction_type = 'withdrawal'`,
                                [today],
                                (err3, withdrawalsRow) => {
                                    if (err3) {
                                        reject(err3);
                                        return;
                                    }
                                    
                                    // Get total commission today
                                    db.get(
                                        `SELECT COALESCE(SUM(ABS(amount)), 0) as total_commission 
                                         FROM transactions 
                                         WHERE transaction_date = ? AND transaction_type = 'commission'`,
                                        [today],
                                        (err4, commissionRow) => {
                                            if (err4) {
                                                reject(err4);
                                                return;
                                            }
                                            
                                            resolve({
                                                new_clients_today: newClientsRow?.new_clients_today || 0,
                                                total_deposits: depositsRow?.total_deposits || 0,
                                                total_withdrawals: withdrawalsRow?.total_withdrawals || 0,
                                                total_commission: commissionRow?.total_commission || 0,
                                                date: today
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    }
};

// Commission Cycle operations
const CommissionCycle = {
    // Get commission cycle for a client
    getByClientId: (clientId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.get(
                'SELECT * FROM commission_cycles WHERE client_id = ?',
                [clientId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || { client_id: clientId, cumulative_withdrawal: 0, updated_at: null });
                    }
                }
            );
        });
    },

    // Get commission cycle with client info
    getByClientIdWithClientInfo: (clientId, agentId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.get(
                `SELECT 
                    cc.*,
                    c.rate as client_rate,
                    c.current_balance,
                    c.name as client_name
                 FROM commission_cycles cc
                 RIGHT JOIN clients c ON cc.client_id = c.id
                 WHERE c.id = ? AND c.agent_id = ?`,
                [clientId, agentId],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        const cumulative = parseFloat(row?.cumulative_withdrawal || 0);
                        const rate = parseFloat(row?.client_rate || 0);
                        const threshold = 31 * rate; // 31 boxes = one full page
                        resolve({
                            client_id: clientId,
                            cumulative_withdrawal: cumulative,
                            client_rate: rate,
                            commission_threshold: threshold,
                            remaining_to_threshold: Math.max(0, threshold - cumulative),
                            threshold_reached: cumulative >= threshold,
                            updated_at: row?.updated_at || null,
                            client_name: row?.client_name,
                            current_balance: parseFloat(row?.current_balance || 0)
                        });
                    }
                }
            );
        });
    },

    // Reset commission cycle for a client
    reset: (clientId) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.run(
                `UPDATE commission_cycles SET cumulative_withdrawal = 0, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?`,
                [clientId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        if (this.changes === 0) {
                            // No existing record, create one
                            db.run(
                                `INSERT INTO commission_cycles (client_id, cumulative_withdrawal, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP)`,
                                [clientId],
                                (insertErr) => {
                                    if (insertErr) {
                                        reject(insertErr);
                                    } else {
                                        resolve({ client_id: clientId, cumulative_withdrawal: 0 });
                                    }
                                }
                            );
                        } else {
                            resolve({ client_id: clientId, cumulative_withdrawal: 0 });
                        }
                    }
                }
            );
        });
    },

    // Adjust commission cycle (for corrections)
    adjust: (clientId, newCumulative) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const cumulative = Math.max(0, parseFloat(newCumulative) || 0);
            db.run(
                `INSERT INTO commission_cycles (client_id, cumulative_withdrawal, updated_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(client_id) DO UPDATE SET
                    cumulative_withdrawal = excluded.cumulative_withdrawal,
                    updated_at = CURRENT_TIMESTAMP`,
                [clientId, cumulative],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ client_id: clientId, cumulative_withdrawal: cumulative });
                    }
                }
            );
        });
    },

    // Get all clients with pending commission cycles
    getAllPending: () => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.all(
                `SELECT 
                    cc.client_id,
                    cc.cumulative_withdrawal,
                    cc.updated_at,
                    c.name as client_name,
                    c.rate as client_rate,
                    c.current_balance,
                    u.name as agent_name,
                    u.id as agent_id,
                    (31 * c.rate - cc.cumulative_withdrawal) as remaining_to_threshold,
                    (31 * c.rate) as commission_threshold
                 FROM commission_cycles cc
                 JOIN clients c ON cc.client_id = c.id
                 JOIN users u ON c.agent_id = u.id
                 WHERE cc.cumulative_withdrawal > 0 AND cc.cumulative_withdrawal < (31 * c.rate)
                 ORDER BY cc.cumulative_withdrawal DESC`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }
};

// Message operations
const Message = {
    // Create a new message
    create: (messageData) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const { client_id, transaction_id, message_type, message, phone_number, status } = messageData;
            
            db.run(
                `INSERT INTO messages (client_id, transaction_id, message_type, message, phone_number, status) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [client_id, transaction_id || null, message_type || 'transaction', message, phone_number, status || 'pending'],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ id: this.lastID, ...messageData });
                    }
                }
            );
        });
    },

    // Update message status
    updateStatus: (messageId, status, sentAt = null) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            const sentAtValue = sentAt || (status === 'sent' ? new Date().toISOString() : null);
            
            db.run(
                `UPDATE messages SET status = ?, sent_at = ? WHERE id = ?`,
                [status, sentAtValue, messageId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ id: messageId, status, sent_at: sentAtValue });
                    }
                }
            );
        });
    },

    // Get messages for a client
    getByClientId: (clientId, limit = 50) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.all(
                `SELECT * FROM messages 
                 WHERE client_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT ?`,
                [clientId, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    },

    // Get messages by status
    getByStatus: (status, limit = 100) => {
        return new Promise((resolve, reject) => {
            const db = getDatabase();
            db.all(
                `SELECT * FROM messages 
                 WHERE status = ? 
                 ORDER BY created_at ASC 
                 LIMIT ?`,
                [status, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }
};

module.exports = {
    initDatabase,
    getDatabase,
    Client,
    Transaction,
    AgentDailyStatus,
    Message,
    User,
    CommissionCycle
};

