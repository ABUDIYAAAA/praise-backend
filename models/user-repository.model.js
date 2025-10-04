import mongoose from "mongoose";

const userRepositorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
      index: true,
    },
    repository: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Repository",
      required: [true, "Repository reference is required"],
      index: true,
    },
    role: {
      type: String,
      enum: {
        values: ["owner", "contributor"],
        message: "Role must be either 'owner' or 'contributor'",
      },
      required: [true, "User role is required"],
      index: true,
    },
    importedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    permissions: {
      canManageBadges: {
        type: Boolean,
        default: false,
      },
      canViewAnalytics: {
        type: Boolean,
        default: true,
      },
      canInviteContributors: {
        type: Boolean,
        default: false,
      },
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

// Compound indexes for performance and uniqueness
userRepositorySchema.index({ user: 1, repository: 1 }, { unique: true });
userRepositorySchema.index({ user: 1, active: 1 });
userRepositorySchema.index({ repository: 1, role: 1, active: 1 });

// Virtual to populate repository details
userRepositorySchema.virtual("repositoryDetails", {
  ref: "Repository",
  localField: "repository",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate user details
userRepositorySchema.virtual("userDetails", {
  ref: "User",
  localField: "user",
  foreignField: "_id",
  justOne: true,
});

// Static method to get user's repositories with role
userRepositorySchema.statics.getUserRepositories = function (
  userId,
  options = {}
) {
  const { page = 1, limit = 20, search = "", role = null } = options;

  const query = { user: userId, active: true };
  if (role) {
    query.role = role;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  return this.find(query)
    .populate({
      path: "repository",
      match: { active: true },
      populate: {
        path: "badges",
        select:
          "name description icon color difficulty criteriaType criteriaValue",
      },
    })
    .populate("user", "email githubUsername")
    .sort({ importedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
};

// Static method to add user to repository
userRepositorySchema.statics.addUserToRepository = async function (
  userId,
  repositoryId,
  role
) {
  try {
    // Check if relationship already exists
    const existing = await this.findOne({
      user: userId,
      repository: repositoryId,
    });

    if (existing) {
      // Update existing relationship
      existing.role = role;
      existing.active = true;
      existing.importedAt = new Date();

      // Set permissions based on role
      if (role === "owner") {
        existing.permissions.canManageBadges = true;
        existing.permissions.canInviteContributors = true;
      }

      return await existing.save();
    } else {
      // Create new relationship
      const permissions = {
        canManageBadges: role === "owner",
        canViewAnalytics: true,
        canInviteContributors: role === "owner",
      };

      return await this.create({
        user: userId,
        repository: repositoryId,
        role,
        permissions,
      });
    }
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error - try to find and return existing
      return await this.findOne({ user: userId, repository: repositoryId });
    }
    throw error;
  }
};

// Static method to get repository users
userRepositorySchema.statics.getRepositoryUsers = function (
  repositoryId,
  options = {}
) {
  const { role = null } = options;

  const query = { repository: repositoryId, active: true };
  if (role) {
    query.role = role;
  }

  return this.find(query)
    .populate("user", "email githubUsername")
    .populate("repository", "name fullName")
    .sort({ role: 1, importedAt: -1 }); // owners first, then by import date
};

// Instance method to update permissions
userRepositorySchema.methods.updatePermissions = function (newPermissions) {
  Object.assign(this.permissions, newPermissions);
  return this.save();
};

// Instance method to check permission
userRepositorySchema.methods.hasPermission = function (permission) {
  return this.permissions[permission] === true;
};

// Pre-save middleware to set default permissions
userRepositorySchema.pre("save", function (next) {
  if (this.isNew || this.isModified("role")) {
    if (this.role === "owner") {
      this.permissions.canManageBadges = true;
      this.permissions.canInviteContributors = true;
    } else {
      this.permissions.canManageBadges = false;
      this.permissions.canInviteContributors = false;
    }
  }
  next();
});

const UserRepository = mongoose.model("UserRepository", userRepositorySchema);

export default UserRepository;
