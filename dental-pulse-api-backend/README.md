# Dental Pulse API Backend

A structured Node.js Express API backend for Dental Pulse application.

## 📁 Project Structure

```
dental-pulse-api-backend/
├── src/
│   ├── controllers/       # Request handlers
│   ├── routes/           # API routes
│   ├── app.js           # Express app configuration
│   └── server.js        # Server entry point
├── .env                 # Environment variables
├── .env.example        # Environment variables template
├── .gitignore          # Git ignore rules
└── package.json        # Project dependencies
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
# Copy .env.example to .env (already created)
# Modify .env as needed
```

### Running the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:3000` (or the PORT specified in .env)

## 📡 API Endpoints

### Root
- `GET /` - API information

### Health Check
- `GET /api/v1/health` - Server health status
- `GET /api/v1/health/hello` - Hello World endpoint

### Example Response

**GET /api/v1/health/hello**
```json
{
  "success": true,
  "message": "Hello World!",
  "data": {
    "version": "v1",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🔧 Adding New Routes

1. Create a controller in `src/controllers/`
2. Create a route file in `src/routes/`
3. Register the route in `src/routes/index.js`

### Example

**Controller** (`src/controllers/example.controller.js`):
```javascript
const getData = (req, res) => {
  res.json({ success: true, data: [] });
};

module.exports = { getData };
```

**Route** (`src/routes/example.routes.js`):
```javascript
const express = require('express');
const router = express.Router();
const exampleController = require('../controllers/example.controller');

router.get('/', exampleController.getData);

module.exports = router;
```

**Register** in `src/routes/index.js`:
```javascript
const exampleRoutes = require('./example.routes');
router.use('/example', exampleRoutes);
```

## 🛡️ Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Environment Variables**: Sensitive data protection

## 📦 Dependencies

- **express**: Web framework
- **dotenv**: Environment variable management
- **cors**: CORS middleware
- **helmet**: Security middleware
- **nodemon**: Development auto-reload (dev dependency)

## 🚢 Deployment

This project is ready to be deployed to any Node.js hosting platform:

- **Heroku**: Procfile not needed (uses `npm start` by default)
- **Railway**: Works out of the box
- **DigitalOcean**: Compatible with App Platform
- **AWS/GCP**: Deploy as containerized app or serverless function

### Environment Variables for Production

Make sure to set these in your deployment platform:
```
PORT=3000
NODE_ENV=production
API_VERSION=v1
```

## 📝 License

ISC
