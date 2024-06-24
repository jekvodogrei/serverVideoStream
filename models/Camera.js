const mongoose = require('mongoose');

const cameraSchema = new mongoose.Schema({
   name: {
      type: String,
      required: true
   },
   url: {
      type: String,
      required: true
   },
   ip: {
      type: String,
      required: true
   }
});

const Camera = mongoose.model('Camera', cameraSchema);

module.exports = Camera;