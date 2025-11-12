const mongoose = require('mongoose');

const CreatedListSchema = new mongoose.Schema({
  name: { type: String, required: true },
  listId: { type: Number, required: true }, // ILS Segment ID (new format)
  legacyListId: { type: Number }, // Legacy Segment ID (required for email association)
  createdDate: { type: Date, default: Date.now },
  deleted: { type: Boolean, default: null }
});

const CreatedList = mongoose.model('CreatedList', CreatedListSchema);
module.exports = CreatedList;