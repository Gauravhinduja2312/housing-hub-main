const mongoose = require('mongoose');

// This file centralizes the database connection logic.
const connectDB = async () => {
  // Check if the MongoDB connection URI is defined in the environment variables.
  // This is a critical check to prevent the app from starting without a database connection.
  if (!process.env.MONGO_URI) {
    console.error('FATAL ERROR: MONGO_URI is not defined in the environment variables.');
    // Exit the process with a failure code if the URI is missing.
    process.exit(1);
  }

  try {
    // Attempt to connect to the MongoDB database using the URI.
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully.');
  } catch (error) {
    // If the connection fails, log the error and exit.
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
