const mongoose = require("mongoose");

// Connect to DB
connectDb().catch((err) => console.log(err));
async function connectDb() {
  await mongoose.connect(process.env.MONGODB_URI);
}

const saveRecord = async ({
  model,
  modelData,
  modelSearchData,
  recordData = null,
}) => {
  const dbRecord = await model.findOne(modelSearchData).exec();
  if (!dbRecord) {
    const record = new model(modelData);
    await record.save();
  } else if (
    dbRecord &&
    recordData &&
    dbRecord.updatedAt != recordData.updated_at
  ) {
    dbRecord.updatedAt = recordData.updated_at;
    await dbRecord.save();
  }
};

module.exports = { saveRecord };
