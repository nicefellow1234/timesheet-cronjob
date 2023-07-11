const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Project = require("../../api/models/project");

router.get("/", (req, res, next) => {
  Project.find()
    .select("_id name rbProjectId")
    .exec()
    .then((docs) => {
      const response = {
        count: docs.length,
        data: docs.map((doc) => {
          return {
            _id: doc._id,
            name: doc.name,
            rbProjectId: doc.rbProjectId,
            request: {
              type: "GET",
              url: "http://localhost:3001/projects/" + doc._id,
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
  const project = new Project({
    _id: new mongoose.Types.ObjectId(),
    rbProjectId: req.body.rbProjectId,
    name: req.body.name,
  });
  project
    .save()
    .then((result) => {
      console.log(result);
      res.status(201).json({
        message: "Created project successfully",
        data: {
          _id: result._id,
          name: result.name,
          rbProjectId: result.rbProjectId,
          request: {
            type: "GET",
            url: "http://localhost:3001/projects/" + result._id,
          },
        },
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.get("/:projectId", (req, res, next) => {
  const id = req.params.projectId;
  Project.findById(id)
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

router.put("/:projectId", (req, res, next) => {
  const id = req.params.projectId;
  const updateOps = {};
  for (const ops of req.body) {
    updateOps[ops.propName] = ops.value;
  }
  Project.findOneAndUpdate({ _id: id }, { $set: updateOps })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json({
        message: "Project updated",
        request: {
          type: "GET",
          url: "http://localhost:3001/projects/" + id,
        },
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

router.delete("/:projectId", (req, res, next) => {
  const id = req.params.projectId;
  Project.deleteOne({ _id: id })
    .exec()
    .then((result) => {
      console.log(result);
      res.status(200).json({
        message: "Project deleted successfully",
        request: {
          type: "POST",
          url: "http://localhost:3001/projects/",
          body: { rbProjectId: "Number", name: "String" },
        },
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
