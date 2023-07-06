const mongoose = require("mongoose");

const invoiceScheema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  userId: Number,
  project: String,
  weekEnding: Number,
  rate: Number,
  subTotal: Number,
});

module.exports = mongoose.model("Invoice", invoiceScheema);
