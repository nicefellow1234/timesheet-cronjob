const mongoose = require("mongoose");

const loggingSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbCommentId: Number,
  rbUserId: Number,
  rbTaskId: Number,
  minutes: Number,
  timeTrackingOn: String,
  createdAt: Number,
});

module.exports = mongoose.model("Logging", loggingSchema);
