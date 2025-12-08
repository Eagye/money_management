# Lucky Susu Ent - Money Management App

A money management application for tracking client deposits and balances.

## Tech Stack
- **Frontend**: HTML, CSS, JavaScript
- **Middleware**: Node.js
- **Database**: SQLite

## Getting Started

### 1. Install Node.js
Make sure you have Node.js installed on your system. You can download it from [nodejs.org](https://nodejs.org/)

### 2. Start the Server
Open a terminal in this directory and run:

```bash
node server.js
```

Or use npm:

```bash
npm start
```

### 3. Access the Application
Open your browser and navigate to:
- **Login Page**: http://localhost:3000/
- **Registered Clients**: http://localhost:3000/registered_clients.html

## Project Structure
```
mc/
├── index.html              # Login page
├── registered_clients.html  # Main dashboard
├── register_client.html     # Client registration form
├── client_view.html         # Client details page
├── styles.css              # All styles
├── app.js                  # Frontend JavaScript
├── server.js               # Node.js server
└── package.json            # Project configuration
```

## Next Steps
- Add backend API endpoints
- Connect to SQLite database
- Implement authentication
- Add business logic

