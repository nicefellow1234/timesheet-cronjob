const mongoose = require("mongoose");

// Connect to DB
connectDb().catch((err) => console.log(err));
async function connectDb() {
  await mongoose.connect(process.env.MONGODB_URI);
}

// Models Definitions - (START) //
const projectSchema = new mongoose.Schema({
  rbProjectId: {
    type: Number,
    unique: true
  },
  name: String
});
const Project = mongoose.model("projects", projectSchema);

const userSchema = new mongoose.Schema({
  rbUserId: {
    type: Number,
    unique: true
  },
  name: String,
  username: String,
  email: String,
  password: String,
  status: Boolean
});
const User = mongoose.model("users", userSchema);

const taskSchema = new mongoose.Schema({
  rbTaskId: {
    type: Number,
    unique: true
  },
  rbProjectId: Number,
  name: String,
  updatedAt: Number
});
const Task = mongoose.model("tasks", taskSchema);

const loggingSchema = new mongoose.Schema({
  rbCommentId: {
    type: Number,
    unique: true
  },
  rbUserId: Number,
  rbTaskId: Number,
  minutes: Number,
  timeTrackingOn: String,
  createdAt: Number
});
const Logging = mongoose.model("loggings", loggingSchema);
// Models Definitions - (END) //

// Models Methods
const saveRecord = async ({ model, modelData, modelSearchData }) => {
  const dbRecord = await model.findOne(modelSearchData).exec();
  if (!dbRecord) {
    const record = new model(modelData);
    await record.save();
  } else {
    // Set update status to false by default
    // To avoid saving the dbRecord without any reason if we don't have any updated fields in there
    let updateStatus = false;
    // Loop through the object keys and compare both objects i.e. dbRecord & modelData
    // If there are any updates fields found in the modelData then update dbRecord with that field
    for (const key in modelData) {
      if (dbRecord[key] != modelData[key]) {
        dbRecord[key] = modelData[key];
        updateStatus = true;
      }
    }
    // At last if even we have a single field which has been updated
    // Only then we need to save the dbRecord again to the DB
    if (updateStatus) {
      await dbRecord.save();
    }
  }
};

// Export Models
module.exports = {
  Project,
  User,
  Task,
  Logging,
  saveRecord
};
