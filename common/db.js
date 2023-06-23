const mongoose = require('mongoose');

// Connect to DB
connectDb().catch(err => console.log(err));
async function connectDb() {
  await mongoose.connect(process.env.MONGODB_URI);
}

// Models Definitions - (START) //
const projectSchema = new mongoose.Schema({
    rbProjectId: Number,
    name: String
});
const Project = mongoose.model('projects', projectSchema);

const userSchema = new mongoose.Schema({
    rbUserId: Number,
    name: String,
    username: String,
    email: String,
    password: String,
    status: Boolean
});
const User = mongoose.model('users', userSchema);

const taskSchema = new mongoose.Schema({
    rbTaskId: Number,
    rbProjectId: Number,
    name: String,
    updatedAt: Number
});
const Task = mongoose.model('tasks', taskSchema);

const loggingSchema = new mongoose.Schema({
    rbCommentId: Number,
    rbUserId: Number,
    rbTaskId: Number,
    minutes: Number,
    timeTrackingOn: String,
    createdAt: Number
});
const Logging = mongoose.model('loggings', loggingSchema);
// Models Definitions - (END) //

// Models Methods
const saveRecord = async ({model, modelData, modelSearchData, recordData = null}) => {
    const dbRecord = await model.findOne(modelSearchData).exec();
    if (!dbRecord) {
        const record = new model(modelData);
        await record.save();
    } else if (dbRecord && recordData && dbRecord.updatedAt != recordData.updated_at) {
        console.log(`Task: ${dbRecord.name} Old UpdatedAt: ${dbRecord.updatedAt} New UpdatedAt: ${recordData.updated_at}`);
        dbRecord.updatedAt = recordData.updated_at;
        await dbRecord.save();
    }
}

// Export Models
module.exports = {
    Project,
    User,
    Task,
    Logging,
    saveRecord
};