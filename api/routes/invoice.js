const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Invoice = require("../../api/models/invoice");

router.get("/", (req, res, next) => {
  Invoice.find()
    .select("_id userId project weekEnding rate subTotal")
    .exec()
    .then((docs) => {
      const response = {
        count: docs.length,
        data: docs.map((doc) => {
          return {
            _id: doc._id,
            userId: doc.userId,
            project: doc.project,
            weekEnding: doc.weekEnding,
            rate: doc.rate,
            subTotal: doc.subTotal,
            request: {
              type: "GET",
              url: "http://localhost:3001/invoice/" + doc._id,
            },
          };
        }),
      };
      res.status(200).json(response);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.post("/", (req, res, next) => {
  const invoice = new Invoice({
    _id: new mongoose.Types.ObjectId(),
    userId: req.body.userId,
    project: req.body.project,
    weekEnding: req.body.weekEnding,
    rate: req.body.rate,
    subTotal: req.body.subTotal,
  });
  invoice
    .save()
    .then((result) => {
      console.log(result);
      res.status(201).json({
        message: "Created invoice successfully",
        createdInvoice: result,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.get("/:invoiceId", (req, res, next) => {
  const id = req.params.invoiceId;
  Invoice.findById(id)
    .exec()
    .then((doc) => {
      console.log("From database", doc);
      if (doc) {
        res.status(200).json(doc);
      } else {
        res.status(500).json({
          message: "No valid entry found for provided ID",
        });
      }
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ error: err });
    });
});

router.patch("/:invoiceId", (req, res, next) => {
  const id = req.params.invoiceId;
  const updateOps = {};
  for (const ops of req.body) {
    updateOps[ops.propName] = ops.value;
  }
  Invoice.findOneAndUpdate({ _id: id }, { $set: updateOps })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json(result);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.delete("/:invoiceId", (req, res, next) => {
  const id = req.params.invoiceId;
  Invoice.deleteOne({ _id: id })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json({
        message: "Invoice deleted successfully",
        deletedInvoice: result,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

module.exports = router;
