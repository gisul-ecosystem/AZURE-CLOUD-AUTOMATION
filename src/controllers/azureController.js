const azureService = require('../services/azureService');

const testAzureConnection = async (req, res, next) => {
  try {
    const result = await azureService.testAzureConnection();

    res.status(200).json({
      success: true,
      authenticated: result.authenticated,
      subscriptionId: result.subscriptionId,
      resourceGroupCount: result.resourceGroupCount
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  testAzureConnection
};
