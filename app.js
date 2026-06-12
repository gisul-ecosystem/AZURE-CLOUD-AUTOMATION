require('dotenv').config();

const express = require('express');
const categoryRoutes = require('./src/routes/categoryRoutes');
const azureRoutes = require('./src/routes/azureRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const cleanupRoutes = require('./src/routes/cleanupRoutes');
const accessRoutes = require('./src/routes/accessRoutes');
const credentialRoutes = require('./src/routes/credentialRoutes');
const catalogRoutes = require('./src/routes/catalogRoutes');
const provisionRoutes = require('./src/routes/provisionRoutes');
const roleProvisionRoutes = require('./src/routes/roleProvisionRoutes');
const serviceResourceProvisionRoutes = require('./src/routes/serviceResourceProvisionRoutes');
const userProvisionRoutes = require('./src/routes/userProvisionRoutes');
const { startExpiryScheduler } = require('./src/scheduler/expiryScheduler');
const { startUsageScheduler } = require('./src/scheduler/usageScheduler');
const pricingRoutes = require('./src/routes/pricingRoutes');
const servicePricingRoutes = require('./src/routes/servicePricingRoutes');
const requestRoutes = require('./src/routes/requestRoutes');
const usageRoutes = require('./src/routes/usageRoutes');
const orgAdminRoutes = require('./src/routes/orgAdminRoutes');
const adminAccessRequestRoutes = require('./src/routes/adminAccessRequestRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const jobRoutes = require('./src/routes/jobRoutes');
const AppError = require('./src/utils/AppError');
const { pool } = require('./src/config/database');

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs.toFixed(2)} ms`);
  });

  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Service Catalog API is running.'
  });
});

app.use('/api/categories', categoryRoutes);
app.use('/api/azure', azureRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/manage', accessRoutes);
app.use('/api', catalogRoutes);
app.use('/api/provision', credentialRoutes);
app.use('/api/provision', provisionRoutes);
app.use('/api/provision', userProvisionRoutes);
app.use('/api/provision', roleProvisionRoutes);
app.use('/api/provision', serviceResourceProvisionRoutes);
app.use('/api/pricing', pricingRoutes);
console.log('pricing_routes_registered');
app.use('/api/services/pricing', servicePricingRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin-access-requests', adminAccessRequestRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/org-admin', orgAdminRoutes);

app.all('*', (req, res, next) => {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Internal server error.';

  if (!error.isOperational) {
    console.error('Unhandled error:', error);
  }

  res.status(statusCode).json({
    success: false,
    message
  });
});

const port = Number(process.env.PORT || 3000);
let server;

const startServer = () => {
  startExpiryScheduler();
  startUsageScheduler();
  server = app.listen(port, () => {
    console.log(`Service Catalog API listening on port ${port}`);
  });

  return server;
};

const shutdown = async (signal) => {
  console.log(`${signal} received. Closing server gracefully.`);

  if (!server) {
    process.exit(0);
    return;
  }

  server.close(async () => {
    try {
      await pool.end();
      console.log('PostgreSQL pool closed.');
      process.exit(0);
    } catch (error) {
      console.error('Error while closing PostgreSQL pool:', error);
      process.exit(1);
    }
  });
};

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

if (require.main === module) {
  startServer();
}

module.exports = app;
