const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DentPulse Enterprise API',
      version: '1.0.0',
      description:
        'Backend API for DentPulse Enterprise dental practice management. Includes Dentally/Xero/Iplicit sync, cross-platform provisioning, password sync, profile sync, and Central Auth integration.',
    },
    servers: [
      { url: process.env.SWAGGER_SERVER_URL || `http://localhost:${process.env.PORT || 4000}`, description: process.env.NODE_ENV === 'production' ? 'Production' : 'Local Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase JWT token',
        },
        centralAuthJwt: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Central Auth JWKS JWT token',
        },
      },
    },
  },
  apis: [path.join(__dirname, '..', 'routes', '*.js')],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerSpec };
