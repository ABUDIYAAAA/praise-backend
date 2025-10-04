import mongoose from "mongoose";

const repositorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Repository name is required"],
      trim: true,
      maxLength: [100, "Repository name cannot exceed 100 characters"],
    },
    fullName: {
      type: String,
      required: [true, "Repository full name is required"],
      unique: true,
      trim: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Repository owner is required"],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxLength: [500, "Description cannot exceed 500 characters"],
      default: null,
    },
    language: {
      type: String,
      trim: true,
      maxLength: [50, "Language cannot exceed 50 characters"],
      default: null,
    },
    private: {
      type: Boolean,
      default: false,
      index: true,
    },
    githubId: {
      type: Number,
      required: [true, "GitHub repository ID is required"],
      unique: true,
      index: true,
    },
    url: {
      type: String,
      required: [true, "Repository URL is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^https?:\/\/.+/.test(v);
        },
        message: "URL must be a valid HTTP/HTTPS URL",
      },
    },
    cloneUrl: {
      type: String,
      trim: true,
    },
    defaultBranch: {
      type: String,
      default: "main",
      trim: true,
    },
    stargazersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    forksCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    topics: {
      type: [String],
      default: [],
      validate: {
        validator: function (topics) {
          return topics.length <= 20;
        },
        message: "Cannot have more than 20 topics",
      },
    },
    badges: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Badge",
      },
    ],
    importedAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncAt: {
      type: Date,
      default: Date.now,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
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

// Indexes for performance
repositorySchema.index({ owner: 1, active: 1 });
repositorySchema.index({ fullName: 1, active: 1 });
repositorySchema.index({ githubId: 1, active: 1 });

// Virtual for badge count
repositorySchema.virtual("badgeCount", {
  ref: "Badge",
  localField: "_id",
  foreignField: "repository",
  count: true,
});

// Virtual for total contributors
repositorySchema.virtual("contributorCount", {
  ref: "PullRequest",
  localField: "_id",
  foreignField: "repository",
  count: true,
});

// Static method to find by GitHub ID
repositorySchema.statics.findByGitHubId = function (githubId) {
  return this.findOne({ githubId, active: true });
};

// Static method to find by owner
repositorySchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId, active: true })
    .populate("owner", "email githubUsername")
    .populate("badges")
    .sort({ lastSyncAt: -1 });
};

// Instance method to add badge
repositorySchema.methods.addBadge = function (badgeId) {
  if (!this.badges.includes(badgeId)) {
    this.badges.push(badgeId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to sync data
repositorySchema.methods.syncData = function (githubData) {
  this.name = githubData.name;
  this.description = githubData.description;
  this.language = githubData.language;
  this.private = githubData.private;
  this.stargazersCount = githubData.stargazers_count || 0;
  this.forksCount = githubData.forks_count || 0;
  this.topics = githubData.topics || [];
  this.defaultBranch = githubData.default_branch || "main";
  this.lastSyncAt = new Date();
  return this.save();
};

// Pre-save middleware
repositorySchema.pre("save", function (next) {
  if (this.isModified("fullName")) {
    this.fullName = this.fullName.toLowerCase();
  }
  next();
});

const Repository = mongoose.model("Repository", repositorySchema);

export default Repository;
