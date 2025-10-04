import mongoose from "mongoose";

const webhookEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true },
    deliveryId: { type: String, required: true, unique: true },
    repository: {
      fullName: String,
      owner: String,
      private: Boolean,
    },
    sender: {
      login: String,
      id: Number,
    },
    action: String, // For events that have actions (opened, closed, etc.)
    payload: mongoose.Schema.Types.Mixed, // Store the full payload
    processedAt: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Associated user if found
  },
  {
    timestamps: true,
  }
);

// Index for querying by repository and event type
webhookEventSchema.index({ "repository.fullName": 1, eventType: 1 });
webhookEventSchema.index({ userId: 1 });

export default mongoose.model("WebhookEvent", webhookEventSchema);
