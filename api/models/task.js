const mongoose = require("mongoose");

const taskSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbTaskId: { type: Number, required: true },
  rbProjectId: { type: Number, required: true },
  name: { type: String, required: true },
  updatedAt: { type: Number, required: true },
});

module.exports = mongoose.model("Task", taskSchema);
