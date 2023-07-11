const mongoose = require("mongoose");

const invoiceScheema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  userId: { type: Number, required: true },
  project: { type: String, required: true },
  weekEnding: { type: Date, required: true },
  rate: { type: Number, required: true },
  subTotal: { type: Number, required: true },
});

module.exports = mongoose.model("Invoice", invoiceScheema);
