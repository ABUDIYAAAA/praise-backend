import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  passwordHash: String,

  githubId: String,
  githubUsername: String,
  githubToken: String,

  onboardingComplete: { type: Boolean, default: false },
});

export default mongoose.model("User", userSchema);
