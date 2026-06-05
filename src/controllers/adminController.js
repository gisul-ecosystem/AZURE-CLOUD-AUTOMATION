const azureCatalogSyncService = require('../services/azureCatalogSyncService');

const syncServices = async (req, res, next) => {
  try {
    const result = await azureCatalogSyncService.syncAzureCatalog();

    res.status(200).json({
      success: true,
      totalServices: result.totalServices,
      totalLocations: result.totalLocations,
      totalRows: result.totalRows
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  syncServices
};
