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

// Export Models
module.exports = {
    Project,
    User,
    Task,
    Logging
};