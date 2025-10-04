import mongoose from "mongoose";

const userBadgeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
      index: true,
    },
    badge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Badge",
      required: [true, "Badge reference is required"],
      index: true,
    },
    repository: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: [true, "Repository reference is required"],
      index: true,
    },
    awardedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    awardedBy: {
      type: String,
      enum: ["system", "manual", "webhook"],
      default: "system",
    },
    criteriaMetAt: {
      type: Date,
      default: Date.now,
    },
    actualValue: {
      type: Number,
      required: true,
      min: 0,
    },
    metadata: {
      triggeringEvent: String,
      prNumber: Number,
      commitSha: String,
      additionalData: mongoose.Schema.Types.Mixed,
    },
    acknowledged: {
      type: Boolean,
      default: false,
    },
    acknowledgedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  }
);

// Compound indexes for performance and uniqueness
userBadgeSchema.index({ user: 1, badge: 1 }, { unique: true });
userBadgeSchema.index({ user: 1, repository: 1 });
userBadgeSchema.index({ badge: 1, awardedAt: -1 });
userBadgeSchema.index({ repository: 1, awardedAt: -1 });
userBadgeSchema.index({ awardedAt: -1 });

// Virtual to populate badge details
userBadgeSchema.virtual("badgeDetails", {
  ref: "Badge",
  localField: "badge",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate user details
userBadgeSchema.virtual("userDetails", {
  ref: "User",
  localField: "user",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate repository details
userBadgeSchema.virtual("repositoryDetails", {
  ref: "Repository",
  localField: "repository",
  foreignField: "_id",
  justOne: true,
});

// Static method to award badge to user
userBadgeSchema.statics.awardBadge = async function ({
  userId,
  badgeId,
  repositoryId,
  actualValue,
  triggeringEvent = null,
  metadata = {},
}) {
  try {
    // Check if already awarded
    const existingAward = await this.findOne({
      user: userId,
      badge: badgeId,
    });

    if (existingAward) {
      return {
        success: false,
        message: "Badge already awarded to user",
        award: existingAward,
      };
    }

    // Create new award
    const userBadge = new this({
      user: userId,
      badge: badgeId,
      repository: repositoryId,
      actualValue,
      metadata: {
        ...metadata,
        triggeringEvent,
      },
    });

    await userBadge.save();

    // Populate the badge details
    await userBadge.populate([
      { path: "badge", select: "name description icon color difficulty" },
      { path: "user", select: "email githubUsername" },
      { path: "repository", select: "name fullName" },
    ]);

    return {
      success: true,
      message: "Badge awarded successfully",
      award: userBadge,
    };
  } catch (error) {
    if (error.code === 11000) {
      return { success: false, message: "Badge already awarded to user" };
    }
    throw error;
  }
};

// Static method to get user's badges for a repository
userBadgeSchema.statics.getUserBadgesForRepo = function (userId, repositoryId) {
  return this.find({ user: userId, repository: repositoryId })
    .populate(
      "badge",
      "name description icon color difficulty criteriaType criteriaValue"
    )
    .populate("repository", "name fullName")
    .sort({ awardedAt: -1 });
};

// Static method to get all badges for a user
userBadgeSchema.statics.getUserBadges = function (userId, options = {}) {
  const { limit = 50, skip = 0, repositoryId = null } = options;

  const query = { user: userId };
  if (repositoryId) {
    query.repository = repositoryId;
  }

  return this.find(query)
    .populate(
      "badge",
      "name description icon color difficulty criteriaType criteriaValue"
    )
    .populate("repository", "name fullName")
    .sort({ awardedAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get recent badges for a repository
userBadgeSchema.statics.getRecentBadgesForRepo = function (
  repositoryId,
  days = 30,
  limit = 10
) {
  const dateThreshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.find({
    repository: repositoryId,
    awardedAt: { $gte: dateThreshold },
  })
    .populate("badge", "name description icon color difficulty")
    .populate("user", "email githubUsername")
    .sort({ awardedAt: -1 })
    .limit(limit);
};

// Static method to get badge statistics
userBadgeSchema.statics.getBadgeStats = async function (badgeId) {
  const stats = await this.aggregate([
    { $match: { badge: new mongoose.Types.ObjectId(badgeId) } },
    {
      $group: {
        _id: null,
        totalAwarded: { $sum: 1 },
        averageValue: { $avg: "$actualValue" },
        maxValue: { $max: "$actualValue" },
        minValue: { $min: "$actualValue" },
        firstAwarded: { $min: "$awardedAt" },
        lastAwarded: { $max: "$awardedAt" },
      },
    },
  ]);

  return (
    stats[0] || {
      totalAwarded: 0,
      averageValue: 0,
      maxValue: 0,
      minValue: 0,
      firstAwarded: null,
      lastAwarded: null,
    }
  );
};

// Instance method to acknowledge badge
userBadgeSchema.methods.acknowledge = function () {
  this.acknowledged = true;
  this.acknowledgedAt = new Date();
  return this.save();
};

// Pre-save middleware to set repository from badge
userBadgeSchema.pre("save", async function (next) {
  if (this.isNew && !this.repository && this.badge) {
    try {
      const Badge = mongoose.model("Badge");
      const badge = await Badge.findById(this.badge).select("repository");
      if (badge) {
        this.repository = badge.repository;
      }
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Post-save middleware for notifications
userBadgeSchema.post("save", async function (doc) {
  // Here you could trigger notifications, webhooks, etc.
  console.log(`Badge awarded: User ${doc.user} received badge ${doc.badge}`);
});

const UserBadge = mongoose.model("UserBadge", userBadgeSchema);

export default UserBadge;
