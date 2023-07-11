const mongoose = require("mongoose");

const projectSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbProjectId: { type: Number, required: true },
  name: { type: String, required: true },
});

module.exports = mongoose.model("Project", projectSchema);
