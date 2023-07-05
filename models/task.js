const mongoose = require("mongoose");

const taskSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbTaskId: Number,
  rbProjectId: Number,
  name: String,
  updatedAt: Number,
});

module.exports = mongoose.model("Task", taskSchema);
