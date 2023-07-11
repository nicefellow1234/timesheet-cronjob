const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const User = require("../models/users");

router.get("/", (req, res, next) => {
  User.find()
    .select("_id rbUserId name username email password status")
    .exec()
    .then((docs) => {
      console.log(docs);
      const response = {
        count: docs.length,
        data: docs.map((doc) => {
          return {
            _id: doc._id,
            rbUserId: doc.rbUserId,
            name: doc.name,
            username: doc.username,
            email: doc.email,
            password: doc.password,
            status: doc.status,
            request: {
              type: "GET",
              url: "http://localhost:3001/render-users/" + doc._id,
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
  const user = new User({
    _id: new mongoose.Types.ObjectId(),
    rbUserId: req.body.rbUserId,
    name: req.body.name,
    username: req.body.username,
    email: req.body.email,
    password: req.body.password,
    status: req.body.status,
  });
  user
    .save()
    .then((result) => {
      console.log(result);
      res.status(201).json({
        message: "User created successfully",
        createdUser: result,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.delete("/:userId", (req, res, next) => {
  const id = req.params.userId;
  User.deleteOne({ _id: id })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json({
        message: "User deleted successfully",
        deletedUser: result,
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
