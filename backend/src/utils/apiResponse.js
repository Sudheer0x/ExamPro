// src/utils/apiResponse.js
//
// One consistent response shape for the whole API:
//   success: { success: true,  message, data }
//   error:   { success: false, message }

function sendSuccess(res, message, data = {}, status = 200) {
  return res.status(status).json({ success: true, message, data });
}

module.exports = { sendSuccess };
