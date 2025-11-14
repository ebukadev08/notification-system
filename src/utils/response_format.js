function successResponse(data, message = "") {
  return {
    success: true,
    data,
    message,
    meta: {
      total: 0,
      limit: 0,
      page: 0,
      total_pages: 0,
      has_next: false,
      has_preview: false,
    },
  };
}

function errorResponse(error, message = "") {
  return {
    success: false,
    error,
    message,
    meta: {
      total: 0,
      limit: 0,
      page: 0,
      total_pages: 0,
      has_next: false,
      has_preview: false,
    },
  };
}

module.exports = {successResponse, errorResponse}