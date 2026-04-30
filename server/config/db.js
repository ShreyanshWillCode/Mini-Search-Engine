const mongoose = require("mongoose");

/**
 * Establishes a connection to MongoDB using the URI from environment variables.
 * Exits the process if the connection fails — critical dependency for the service.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // These options keep Mongoose compatible across driver versions
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅  MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌  MongoDB connection error: ${error.message}`);
    process.exit(1); // Crawler cannot function without its database
  }
};

module.exports = connectDB;
