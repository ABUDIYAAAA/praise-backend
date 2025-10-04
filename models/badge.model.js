import mongoose from "mongoose";

const badgeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Badge name is required"],
      trim: true,
      maxLength: [100, "Badge name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Badge description is required"],
      trim: true,
      maxLength: [500, "Description cannot exceed 500 characters"],
    },
    criteriaType: {
      type: String,
      enum: {
        values: ["prs", "commits", "issues", "reviews", "stars", "forks"],
        message:
          "Criteria type must be one of: prs, commits, issues, reviews, stars, forks",
      },
      default: "prs",
      required: true,
    },
    criteriaValue: {
      type: Number,
      required: [true, "Criteria value is required"],
      min: [1, "Criteria value must be at least 1"],
      max: [10000, "Criteria value cannot exceed 10000"],
    },
    repository: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: [true, "Repository reference is required"],
      index: true,
    },
    icon: {
      type: String,
      trim: true,
      default: "🏆", // Default trophy emoji
    },
    color: {
      type: String,
      trim: true,
      default: "#FFD700", // Gold color
      validate: {
        validator: function (v) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: "Color must be a valid hex color code",
      },
    },
    difficulty: {
      type: String,
      enum: {
        values: ["easy", "medium", "hard", "legendary"],
        message: "Difficulty must be one of: easy, medium, hard, legendary",
      },
      default: "easy",
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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

// Compound indexes for performance
badgeSchema.index({ repository: 1, active: 1 });
badgeSchema.index({ repository: 1, criteriaType: 1, active: 1 });
badgeSchema.index({ criteriaType: 1, criteriaValue: 1 });

// Unique constraint to prevent duplicate badges for same criteria in same repo
badgeSchema.index(
  { repository: 1, criteriaType: 1, criteriaValue: 1 },
  { unique: true }
);

// Virtual for awarded count
badgeSchema.virtual("awardedCount", {
  ref: "UserBadge",
  localField: "_id",
  foreignField: "badge",
  count: true,
});

// Virtual for recent awards (last 30 days)
badgeSchema.virtual("recentAwardedCount", {
  ref: "UserBadge",
  localField: "_id",
  foreignField: "badge",
  match: {
    awardedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  },
  count: true,
});

// Static method to create default badges for repository
badgeSchema.statics.createDefaultBadges = async function (
  repositoryId,
  createdBy
) {
  const defaultBadges = [
    {
      name: "First Contributor",
      description: "Awarded for your first merged pull request",
      criteriaType: "prs",
      criteriaValue: 1,
      icon: "🌟",
      color: "#32CD32",
      difficulty: "easy",
      isDefault: true,
    },
    {
      name: "Active Contributor",
      description: "Awarded for 5 or more merged pull requests",
      criteriaType: "prs",
      criteriaValue: 5,
      icon: "🚀",
      color: "#FF6B35",
      difficulty: "medium",
      isDefault: true,
    },
    {
      name: "Super Contributor",
      description: "Awarded for 20 or more merged pull requests",
      criteriaType: "prs",
      criteriaValue: 20,
      icon: "⭐",
      color: "#FFD700",
      difficulty: "hard",
      isDefault: true,
    },
    {
      name: "Commit Champion",
      description: "Awarded for 50 or more commits",
      criteriaType: "commits",
      criteriaValue: 50,
      icon: "💻",
      color: "#8A2BE2",
      difficulty: "medium",
      isDefault: true,
    },
  ];

  const badges = defaultBadges.map((badge) => ({
    ...badge,
    repository: repositoryId,
    createdBy,
  }));

  try {
    return await this.insertMany(badges, { ordered: false });
  } catch (error) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      console.warn(
        "Some default badges already exist for repository:",
        repositoryId
      );
      return [];
    }
    throw error;
  }
};

// Static method to find badges by repository
badgeSchema.statics.findByRepository = function (
  repositoryId,
  includeInactive = false
) {
  const query = { repository: repositoryId };
  if (!includeInactive) {
    query.active = true;
  }
  return this.find(query)
    .populate("repository", "name fullName")
    .populate("createdBy", "email githubUsername")
    .sort({ difficulty: 1, criteriaValue: 1 });
};

// Instance method to check if user meets criteria
badgeSchema.methods.checkUserEligibility = async function (userId) {
  const PullRequest = mongoose.model("PullRequest");

  switch (this.criteriaType) {
    case "prs":
      const prCount = await PullRequest.countDocuments({
        repository: this.repository,
        user: userId,
        merged: true,
      });
      return prCount >= this.criteriaValue;

    case "commits":
      // This would require a Commit model or counting commits from PRs
      const commitCount = await PullRequest.aggregate([
        {
          $match: {
            repository: this.repository,
            user: userId,
            merged: true,
          },
        },
        {
          $group: {
            _id: null,
            totalCommits: { $sum: "$commitCount" },
          },
        },
      ]);
      return (commitCount[0]?.totalCommits || 0) >= this.criteriaValue;

    default:
      return false;
  }
};

// Pre-save middleware
badgeSchema.pre("save", function (next) {
  if (this.isNew && !this.createdBy) {
    return next(new Error("Badge must have a creator"));
  }
  next();
});

const Badge = mongoose.model("Badge", badgeSchema);

export default Badge;
