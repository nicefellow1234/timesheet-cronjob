const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Task = require("../../api/models/task");

router.get("/", (req, res, next) => {
  Task.find()
    .exec()
    .then((docs) => {
      console.log(docs);
      res.status(200).json(docs);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.post("/", (req, res, next) => {
  const task = new Task({
    _id: new mongoose.Types.ObjectId(),
    rbTaskId: req.body.rbTaskId,
    rbProjectId: req.body.rbProjectId,
    name: req.body.name,
    updatedAt: req.body.updatedAt,
  });
  task
    .save()
    .then((result) => {
      console.log(result);
      res.status(201).json({
        message: "Handling POST requests to /tasks",
        createdTask: result,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.delete("/:taskId", (req, res, next) => {
  const id = req.params.taskId;
  Task.deleteOne({ _id: id })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json({
        message: "Task deleted successfully",
        deletedTask: result,
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
