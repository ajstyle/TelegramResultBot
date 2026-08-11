const mongoose = require('mongoose');
const config = require('./config');

async function connectDB() {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB] Connected to database: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    // Return null instead of crashing server so paper/testing mode can run gracefully if DB is down
    return null;
  }
}

module.exports = { connectDB };
