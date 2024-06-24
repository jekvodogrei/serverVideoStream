const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
   name: {
      type: String,
      required: true
   },
   phone: {
      type: String,
      required: true,
      unique: true
   },
   password: {
      type: String,
      require: true
   },
   cameras: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Camera'
   }]
});

const User = mongoose.model('User', userSchema);

module.exports = User;