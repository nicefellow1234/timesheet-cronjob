const mongoose = require("mongoose");

mongoose.connect(
  "mongodb+srv://CX-timesheet:" +
    process.env.MONGO_ATLAS_PW +
    "@cx-timesheet.ibmrtvy.mongodb.net/?retryWrites=true&w=majority"
);

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
