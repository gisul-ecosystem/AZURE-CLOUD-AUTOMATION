const apiResponse = ({ data, count }) => ({
  success: true,
  count,
  data
});

module.exports = apiResponse;
