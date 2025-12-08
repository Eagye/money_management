// Load environment variables first
require('dotenv').config();

// Load logger and config (must be loaded early)
const logger = require('./logger');
const { validateConfig, getConfig } = require('./config');
const { securityHeaders, requestLogger } = require('./middleware');

// Validate configuration on startup
try {
    validateConfig();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

const config = getConfig();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const zlib = require('zlib');
const { initDatabase, getDatabase } = require('./database');
const { handleAPI } = require('./api');

const PORT = config.port;

// MIME types for different file extensions
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    // Apply security headers
    securityHeaders(req, res, () => {});
    
    // Apply request logging
    requestLogger(req, res, () => {});
    
    // Handle API routes
    if (req.url.startsWith('/api/')) {
        await handleAPI(req, res);
        return;
    }

    // Parse URL to remove query string
    const url = require('url');
    const parsedUrl = url.parse(req.url);
    const pathname = parsedUrl.pathname;

    // Serve static files
    let filePath = '.' + pathname;
    if (filePath === './') {
        filePath = './index.html';
    }

    // Get file extension
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    // Read and serve file
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                // File not found
                logger.warn('File not found', { path: filePath, url: req.url });
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - File Not Found</h1>', 'utf-8');
            } else {
                // Server error
                logger.error('File read error', { path: filePath, error: error.message, code: error.code });
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`, 'utf-8');
            }
        } else {
            // Success - Set headers for HTML files
            const headers = { 'Content-Type': contentType };
            
            // Add CSP header for HTML files to allow inline scripts (for development)
            if (extname === '.html') {
                headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;";
            }
            
            // Check if client accepts gzip compression
            const acceptEncoding = req.headers['accept-encoding'] || '';
            const shouldCompress = acceptEncoding.includes('gzip') && 
                                  (extname === '.html' || extname === '.css' || extname === '.js' || extname === '.json');
            
            if (shouldCompress) {
                headers['Content-Encoding'] = 'gzip';
                zlib.gzip(content, (err, compressed) => {
                    if (err) {
                        logger.error('Compression error', { error: err.message });
                        res.writeHead(200, headers);
                        res.end(content, 'utf-8');
                    } else {
                        res.writeHead(200, headers);
                        res.end(compressed, 'utf-8');
                    }
                });
            } else {
                res.writeHead(200, headers);
                res.end(content, 'utf-8');
            }
        }
    });
});

// Initialize database and start server
initDatabase()
    .then(() => {
        server.listen(PORT, () => {
            logger.info(`Server running at http://localhost:${PORT}/`);
            logger.info('Database initialized and ready');
            logger.info('Press Ctrl+C to stop the server');
            
            // Automatically open browser (only in development)
            if (config.nodeEnv !== 'production') {
                const url = `http://localhost:${PORT}/`;
                const start = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
                exec(`${start} ${url}`, (error) => {
                    if (error) {
                        logger.debug('Could not open browser automatically');
                    }
                });
            }
        })
        .on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${PORT} is already in use!`);
                logger.info('To fix this:');
                logger.info('1. Stop any other server running on port ' + PORT);
                logger.info('2. Or wait a few seconds for the port to be released');
                logger.info('3. Then try running "npm start" again');
                logger.info('You can also kill the process using:');
                logger.info('  Windows: Get-Process -Name node | Stop-Process -Force');
                logger.info('  Mac/Linux: lsof -ti:' + PORT + ' | xargs kill');
            } else {
                logger.error('Server error', { error: err.message, stack: err.stack });
            }
            process.exit(1);
        });
    })
    .catch((err) => {
        logger.error('Failed to initialize database', { error: err.message, stack: err.stack });
        process.exit(1);
    });

