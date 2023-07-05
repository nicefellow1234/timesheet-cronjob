const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  rbUserId: Number,
  name: String,
  username: String,
  email: String,
  password: String,
  status: Boolean,
});

module.exports = mongoose.model("User", userSchema);
