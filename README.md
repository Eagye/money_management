# Lucky Susu Ent - Money Management System

A comprehensive money management application for tracking client deposits, withdrawals, balances, and commission calculations. Built for managing Susu (rotating savings) operations with agent and admin capabilities.

## 🚀 Features

### Core Functionality
- **Client Management**: Register and manage clients with deposits and withdrawals
- **Transaction Tracking**: Record deposits and withdrawals with date tracking
- **Balance Management**: Automatic balance calculations and updates
- **Commission System**: Automatic commission deduction (31st box) when clients complete withdrawal cycles
- **Agent Management**: Multi-agent support with approval workflow
- **Admin Dashboard**: Comprehensive admin panel with analytics and reporting

### Security Features
- **JWT Authentication**: Secure token-based authentication
- **Bcrypt Password Hashing**: Industry-standard password security
- **Rate Limiting**: Protection against API abuse
- **CORS Configuration**: Configurable cross-origin resource sharing
- **Input Validation**: Server-side validation and sanitization
- **Protected Routes**: Authentication required for all protected pages

### Admin Features
- **Dashboard Analytics**: Real-time statistics and metrics
- **Agent Management**: Approve/reject agent registrations
- **Client Overview**: View all clients across all agents
- **Transaction Reports**: Daily, weekly, and monthly reports
- **Commission Tracking**: Commission reports by period
- **Account Analytics**: Largest/smallest accounts, dormant accounts, active accounts
- **Deposit/Withdrawal Reports**: Comprehensive transaction reporting

### Agent Features
- **Client Registration**: Register new clients with rates
- **Deposit Management**: Record client deposits (weekdays only)
- **Transaction History**: View client transaction history
- **Client Search**: Search clients by name or phone
- **Daily View**: View transactions by date
- **Statistics**: View personal client and transaction statistics

## 🛠️ Tech Stack

- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Backend**: Node.js with Express-like HTTP server
- **Database**: SQLite with WAL mode for better concurrency
- **Authentication**: JWT (JSON Web Tokens)
- **Password Security**: Bcrypt (10 salt rounds)
- **Logging**: Winston logger
- **Rate Limiting**: In-memory rate limiter

## 📋 Prerequisites

- Node.js (v14 or higher recommended)
- npm (comes with Node.js)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mc
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Required
   JWT_SECRET=your-strong-random-secret-key-minimum-32-characters
   
   # Optional (with defaults)
   PORT=3000
   NODE_ENV=development
   LOG_LEVEL=debug
   ADMIN_EMAIL=admin@luckysusu.com
   ALLOWED_ORIGINS=http://localhost:3000
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   JWT_EXPIRES_IN=24h
   ```

   **Important**: Generate a strong JWT_SECRET:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. **Initialize the database**
   
   The database will be automatically created on first server start. The application uses SQLite with the database file `lucky_susu.db`.

5. **Create admin user** (First time setup)
   
   Run the admin creation script:
   ```bash
   node create_admin.js
   ```
   
   Or use the admin creation page at `/admin/create-admin.html` (requires admin access)

## 🚀 Running the Application

### Start the server
```bash
npm start
```

Or directly:
```bash
node server.js
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

### Access the Application

- **Login Page**: http://localhost:3000/
- **Agent Dashboard**: http://localhost:3000/registered_clients.html
- **Admin Dashboard**: http://localhost:3000/admin/dashboard.html
- **Register Agent**: http://localhost:3000/register_agent.html
- **Register Client**: http://localhost:3000/register_client.html

## 📁 Project Structure

```
mc/
├── admin/                      # Admin panel pages
│   ├── dashboard.html         # Main admin dashboard
│   ├── agents.html            # Agent management
│   ├── clients.html           # All clients view
│   ├── deposits/              # Deposit reports
│   │   ├── daily.html
│   │   ├── weekly.html
│   │   └── monthly.html
│   ├── withdrawals/           # Withdrawal reports
│   │   ├── daily.html
│   │   ├── weekly.html
│   │   └── monthly.html
│   └── commission/            # Commission reports
│       ├── daily.html
│       ├── weekly.html
│       └── monthly.html
├── api.js                     # API route handlers
├── api-client.js              # Frontend API client
├── auth.js                    # Authentication utilities
├── auth-check.js              # Client-side auth checks
├── config.js                  # Configuration management
├── database.js                # Database models and queries
├── logger.js                  # Winston logger setup
├── messaging.js               # SMS/notification handling
├── middleware.js              # HTTP middleware
├── rateLimiter.js             # Rate limiting middleware
├── server.js                  # Main HTTP server
├── app.js                     # Frontend application logic
├── styles.css                 # Application styles
├── index.html                 # Login page
├── registered_clients.html    # Agent dashboard
├── register_agent.html        # Agent registration
├── register_client.html       # Client registration
├── client_view.html           # Client details view
├── day_view.html              # Daily transaction view
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

## 🔐 Authentication

### User Roles

1. **Admin**: Full system access
   - Created by existing admin
   - Can approve/reject agents
   - Access to all admin features

2. **Agent**: Limited access
   - Must be approved by admin
   - Can manage own clients
   - Can record deposits/withdrawals

### Registration Flow

1. **Agent Registration**:
   - Agent registers with email, password, contact, Ghana Card number, and guarantor details
   - Account is created but not approved
   - Admin must approve the account
   - Agent can login only after approval

2. **Admin Creation**:
   - Only existing admins can create new admins
   - New admin accounts are automatically approved

### API Authentication

All API endpoints (except `/api/auth/register` and `/api/auth/login`) require authentication:

```javascript
Authorization: Bearer <JWT_TOKEN>
```

## 💰 Commission System

The commission system automatically deducts commission when clients make withdrawals:

- **Commission Threshold**: 31 × client_rate (one full page)
- **Commission Amount**: Number of completed pages × client_rate
- **Automatic Deduction**: Commission is deducted only when a full page (31 boxes) is completed
- **Tracking**: Cumulative withdrawals tracked per client in `commission_cycles` table

For detailed commission logic, see [COMMISSION_LOGIC_EXPLANATION.md](./COMMISSION_LOGIC_EXPLANATION.md)

## 📊 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new agent
- `POST /api/auth/login` - Login user

### Clients (Agent)
- `GET /api/clients` - Get all clients (paginated)
- `POST /api/clients` - Create new client
- `GET /api/clients/search` - Search clients
- `GET /api/clients/:id` - Get client details
- `GET /api/clients/stats` - Get client statistics

### Transactions (Agent)
- `POST /api/transactions` - Create transaction (deposit/withdrawal)
- `GET /api/transactions/client/:id` - Get client transactions
- `GET /api/transactions/date` - Get transactions by date

### Admin Endpoints
- `GET /api/admin/dashboard/stats` - Dashboard statistics
- `GET /api/admin/agents` - Get all agents
- `POST /api/admin/agents/:id/approve` - Approve/reject agent
- `GET /api/admin/clients` - Get all clients
- `POST /api/admin/withdrawals` - Create withdrawal
- `GET /api/admin/deposits/daily` - Daily deposits report
- `GET /api/admin/deposits/weekly` - Weekly deposits report
- `GET /api/admin/deposits/monthly` - Monthly deposits report
- `GET /api/admin/withdrawals/daily` - Daily withdrawals report
- `GET /api/admin/commission/daily` - Daily commission report

See `api.js` for complete API documentation.

## 🗄️ Database Schema

### Main Tables
- **users**: Agent/admin accounts
- **clients**: Client information
- **transactions**: Deposit/withdrawal records
- **commission_cycles**: Commission tracking per client
- **agent_daily_status**: Daily deposit approval status

The database is automatically initialized on first server start.

## 🔒 Security Best Practices

1. **Change JWT_SECRET**: Use a strong, random secret in production
2. **Environment Variables**: Never commit `.env` file
3. **HTTPS**: Use HTTPS in production
4. **Rate Limiting**: Already implemented, adjust limits as needed
5. **Password Policy**: Enforce strong passwords (currently minimum 6 characters)
6. **Input Validation**: All inputs are validated and sanitized

## 📝 Logging

The application uses Winston for logging:
- **Logs Directory**: `logs/`
- **Files**: `combined.log` (all logs), `error.log` (errors only)
- **Log Levels**: debug, info, warn, error

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Windows
Get-Process -Name node | Stop-Process -Force

# Mac/Linux
lsof -ti:3000 | xargs kill
```

### Database Issues
- Database file: `lucky_susu.db`
- Check logs in `logs/error.log`
- Database is automatically created on first run

### Authentication Issues
- Check JWT_SECRET is set in `.env`
- Verify token is being sent in Authorization header
- Check browser console for errors

## 📚 Documentation

- [Commission Logic Explanation](./COMMISSION_LOGIC_EXPLANATION.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Production Issues](./PRODUCTION_ISSUES.md)
- [Commission Scenarios](./COMMISSION_SCENARIOS.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

ISC

## 👥 Support

For issues or questions, please check the documentation files or create an issue in the repository.

---

**Version**: 1.0.0  
**Last Updated**: 2024
