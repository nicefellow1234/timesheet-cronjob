const mongoose = require("mongoose");

const loggingSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbCommentId: { type: Number, required: true },
  rbUserId: { type: Number, required: true },
  rbTaskId: { type: Number, required: true },
  minutes: { type: Number, required: true },
  timeTrackingOn: { type: String, required: true },
  createdAt: { type: Number, required: true },
});

module.exports = mongoose.model("Logging", loggingSchema);
