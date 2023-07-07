const express = require("express");
const router = express.Router();

const { generateInvoiceData } = require("../../common/renderMethods");

router.post("/", async (req, res, next) => {
  try {
    const {
      month,
      year,
      userId,
      hourlyRate,
      invoiceNo,
      customItem,
      customValue,
    } = req.body;

    let data = await generateInvoiceData(
      month,
      year,
      userId,
      hourlyRate,
      invoiceNo,
      customItem,
      customValue
    );

    return res.status(200).json({ data });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      error: err,
    });
  }
});

module.exports = router;
