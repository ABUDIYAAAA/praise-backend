import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },

  githubId: { type: String, required: true, unique: true },
  githubUsername: { type: String, required: true },
  githubToken: String,

  onboardingComplete: { type: Boolean, default: true },
});

export default mongoose.model("User", userSchema);
