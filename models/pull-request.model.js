import mongoose from "mongoose";

const pullRequestSchema = new mongoose.Schema(
  {
    repository: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: [true, "Repository reference is required"],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
      index: true,
    },
    githubPrId: {
      type: Number,
      required: [true, "GitHub PR ID is required"],
      index: true,
    },
    number: {
      type: Number,
      required: [true, "PR number is required"],
    },
    title: {
      type: String,
      required: [true, "PR title is required"],
      trim: true,
      maxLength: [300, "Title cannot exceed 300 characters"],
    },
    body: {
      type: String,
      trim: true,
      default: "",
    },
    state: {
      type: String,
      enum: ["open", "closed", "merged"],
      default: "open",
      index: true,
    },
    merged: {
      type: Boolean,
      default: false,
      index: true,
    },
    mergedAt: {
      type: Date,
      index: true,
    },
    closedAt: {
      type: Date,
    },
    githubCreatedAt: {
      type: Date,
      required: true,
      index: true,
    },
    githubUpdatedAt: {
      type: Date,
      required: true,
    },
    baseBranch: {
      type: String,
      required: true,
      default: "main",
    },
    headBranch: {
      type: String,
      required: true,
    },
    commitCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    changedFiles: {
      type: Number,
      default: 0,
      min: 0,
    },
    additions: {
      type: Number,
      default: 0,
      min: 0,
    },
    deletions: {
      type: Number,
      default: 0,
      min: 0,
    },
    labels: [
      {
        name: String,
        color: String,
      },
    ],
    assignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    reviewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    url: {
      type: String,
      required: true,
      trim: true,
    },
    diffUrl: {
      type: String,
      trim: true,
    },
    patchUrl: {
      type: String,
      trim: true,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    processedAt: {
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
pullRequestSchema.index({ repository: 1, githubPrId: 1 }, { unique: true });
pullRequestSchema.index({ repository: 1, user: 1, merged: 1 });
pullRequestSchema.index({ user: 1, merged: 1, mergedAt: -1 });
pullRequestSchema.index({ repository: 1, state: 1, githubCreatedAt: -1 });
pullRequestSchema.index({ merged: 1, mergedAt: -1 });

// Virtual for total lines changed
pullRequestSchema.virtual("totalLines").get(function () {
  return this.additions + this.deletions;
});

// Virtual for PR age in days
pullRequestSchema.virtual("ageInDays").get(function () {
  const now = this.mergedAt || this.closedAt || new Date();
  const created = this.githubCreatedAt;
  return Math.ceil((now - created) / (1000 * 60 * 60 * 24));
});

// Static method to create or update PR from webhook
pullRequestSchema.statics.createOrUpdateFromWebhook = async function (
  webhookData,
  repository,
  user
) {
  const {
    id: githubPrId,
    number,
    title,
    body,
    state,
    merged,
    merged_at: mergedAt,
    closed_at: closedAt,
    created_at: githubCreatedAt,
    updated_at: githubUpdatedAt,
    base,
    head,
    html_url: url,
    diff_url: diffUrl,
    patch_url: patchUrl,
    commits,
    changed_files: changedFiles,
    additions,
    deletions,
    labels = [],
  } = webhookData;

  const prData = {
    repository: repository._id,
    user: user._id,
    githubPrId,
    number,
    title,
    body: body || "",
    state,
    merged: !!merged,
    mergedAt: mergedAt ? new Date(mergedAt) : null,
    closedAt: closedAt ? new Date(closedAt) : null,
    githubCreatedAt: new Date(githubCreatedAt),
    githubUpdatedAt: new Date(githubUpdatedAt),
    baseBranch: base?.ref || "main",
    headBranch: head?.ref || "unknown",
    commitCount: commits || 1,
    changedFiles: changedFiles || 0,
    additions: additions || 0,
    deletions: deletions || 0,
    labels: labels.map((label) => ({
      name: label.name,
      color: label.color,
    })),
    url,
    diffUrl,
    patchUrl,
  };

  try {
    const existingPR = await this.findOne({
      repository: repository._id,
      githubPrId,
    });

    if (existingPR) {
      Object.assign(existingPR, prData);
      return await existingPR.save();
    } else {
      return await this.create(prData);
    }
  } catch (error) {
    console.error("Error creating/updating PR from webhook:", error);
    throw error;
  }
};

// Static method to get user's PRs for repository
pullRequestSchema.statics.getUserPRsForRepo = function (
  userId,
  repositoryId,
  options = {}
) {
  const { merged = null, limit = 50, skip = 0 } = options;

  const query = { repository: repositoryId, user: userId };
  if (merged !== null) {
    query.merged = merged;
  }

  return this.find(query)
    .populate("repository", "name fullName")
    .populate("user", "email githubUsername")
    .sort({ githubCreatedAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to count user contributions
pullRequestSchema.statics.countUserContributions = async function (
  userId,
  repositoryId = null
) {
  const matchStage = { user: new mongoose.Types.ObjectId(userId) };
  if (repositoryId) {
    matchStage.repository = new mongoose.Types.ObjectId(repositoryId);
  }

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalPRs: { $sum: 1 },
        mergedPRs: {
          $sum: { $cond: [{ $eq: ["$merged", true] }, 1, 0] },
        },
        totalCommits: { $sum: "$commitCount" },
        totalAdditions: { $sum: "$additions" },
        totalDeletions: { $sum: "$deletions" },
        totalFilesChanged: { $sum: "$changedFiles" },
        firstPR: { $min: "$githubCreatedAt" },
        lastPR: { $max: "$githubCreatedAt" },
      },
    },
  ]);

  return (
    stats[0] || {
      totalPRs: 0,
      mergedPRs: 0,
      totalCommits: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      totalFilesChanged: 0,
      firstPR: null,
      lastPR: null,
    }
  );
};

// Static method to get repository PR statistics
pullRequestSchema.statics.getRepositoryStats = async function (repositoryId) {
  const stats = await this.aggregate([
    { $match: { repository: new mongoose.Types.ObjectId(repositoryId) } },
    {
      $group: {
        _id: null,
        totalPRs: { $sum: 1 },
        mergedPRs: {
          $sum: { $cond: [{ $eq: ["$merged", true] }, 1, 0] },
        },
        uniqueContributors: { $addToSet: "$user" },
        avgCommitsPerPR: { $avg: "$commitCount" },
        totalLinesChanged: {
          $sum: { $add: ["$additions", "$deletions"] },
        },
      },
    },
    {
      $addFields: {
        contributorCount: { $size: "$uniqueContributors" },
      },
    },
  ]);

  return (
    stats[0] || {
      totalPRs: 0,
      mergedPRs: 0,
      contributorCount: 0,
      avgCommitsPerPR: 0,
      totalLinesChanged: 0,
    }
  );
};

// Instance method to mark as processed
pullRequestSchema.methods.markAsProcessed = function () {
  this.processed = true;
  this.processedAt = new Date();
  return this.save();
};

// Pre-save middleware
pullRequestSchema.pre("save", function (next) {
  if (this.merged && !this.mergedAt) {
    this.mergedAt = new Date();
  }
  if (this.state === "closed" && !this.closedAt) {
    this.closedAt = new Date();
  }
  next();
});

const PullRequest = mongoose.model("PullRequest", pullRequestSchema);

export default PullRequest;
