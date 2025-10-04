import axios from "axios";
import { ApiResponse } from "../utils/api-response.js";
import User from "../models/user.model.js";
import Repository from "../models/repository.model.js";
import BadgeService from "../services/badgeService.js";

/**
 * Import repositories from GitHub
 * POST /api/repositories/import
 */
const importRepositories = async (req, res) => {
  try {
    const { repositoryIds } = req.body;
    const userId = req.user._id;

    if (
      !repositoryIds ||
      !Array.isArray(repositoryIds) ||
      repositoryIds.length === 0
    ) {
      return res
        .status(400)
        .json(new ApiResponse(400, "Repository IDs array is required"));
    }

    // Get user with GitHub access token
    const user = await User.findById(userId);
    if (!user || !user.githubAccessToken) {
      return res
        .status(400)
        .json(new ApiResponse(400, "GitHub access token not found"));
    }

    // Fetch selected repositories from GitHub API
    const githubRepos = [];
    const errors = [];

    for (const repoId of repositoryIds) {
      try {
        const response = await axios.get(
          `https://api.github.com/repositories/${repoId}`,
          {
            headers: {
              Authorization: `Bearer ${user.githubAccessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          }
        );

        // Verify user owns this repository
        if (response.data.owner.login !== user.githubUsername) {
          errors.push({
            repositoryId: repoId,
            error: "You can only import repositories you own",
          });
          continue;
        }

        githubRepos.push(response.data);
      } catch (error) {
        console.error(
          `Error fetching repository ${repoId}:`,
          error.response?.data
        );
        errors.push({
          repositoryId: repoId,
          error: error.response?.data?.message || "Failed to fetch repository",
        });
      }
    }

    if (githubRepos.length === 0) {
      return res
        .status(400)
        .json(
          new ApiResponse(400, "No valid repositories found to import", {
            errors,
          })
        );
    }

    // Import repositories using BadgeService
    const importResult = await BadgeService.importRepositories(
      userId,
      githubRepos
    );

    if (!importResult.success) {
      return res.status(500).json(
        new ApiResponse(500, "Repository import failed", {
          error: importResult.error,
          partialResults: importResult,
        })
      );
    }

    // Return success response
    return res.status(201).json(
      new ApiResponse(201, "Repositories imported successfully", {
        imported: importResult.imported,
        updated: importResult.updated,
        badgesCreated: importResult.badgesCreated,
        errors: [...errors, ...importResult.errors],
        summary: {
          totalProcessed: githubRepos.length,
          imported: importResult.imported.length,
          updated: importResult.updated.length,
          failed: errors.length + importResult.errors.length,
        },
      })
    );
  } catch (error) {
    console.error("Import repositories error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Internal server error during import"));
  }
};

/**
 * Get user's imported repositories
 * GET /api/repositories
 */
const getUserRepositories = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, search = "" } = req.query;

    const query = { owner: userId, active: true };

    // Add search filter if provided
    if (search.trim()) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { fullName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [repositories, total] = await Promise.all([
      Repository.find(query)
        .populate(
          "badges",
          "name description icon color difficulty criteriaType criteriaValue"
        )
        .populate({
          path: "badgeCount",
        })
        .sort({ lastSyncAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Repository.countDocuments(query),
    ]);

    return res.status(200).json(
      new ApiResponse(200, "Repositories retrieved successfully", {
        repositories,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      })
    );
  } catch (error) {
    console.error("Get repositories error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to retrieve repositories"));
  }
};

/**
 * Get repository details with badge statistics
 * GET /api/repositories/:id
 */
const getRepositoryDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const repository = await Repository.findOne({
      _id: id,
      owner: userId,
      active: true,
    })
      .populate("owner", "email githubUsername")
      .populate("badges");

    if (!repository) {
      return res.status(404).json(new ApiResponse(404, "Repository not found"));
    }

    // Get badge statistics
    const badgeStats = await BadgeService.getRepositoryBadgeStats(id);

    return res.status(200).json(
      new ApiResponse(200, "Repository details retrieved", {
        repository,
        badgeStats,
      })
    );
  } catch (error) {
    console.error("Get repository details error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to retrieve repository details"));
  }
};

/**
 * Sync repository data with GitHub
 * POST /api/repositories/:id/sync
 */
const syncRepository = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const repository = await Repository.findOne({
      _id: id,
      owner: userId,
      active: true,
    });

    if (!repository) {
      return res.status(404).json(new ApiResponse(404, "Repository not found"));
    }

    const user = await User.findById(userId);
    if (!user || !user.githubAccessToken) {
      return res
        .status(400)
        .json(new ApiResponse(400, "GitHub access token not found"));
    }

    // Fetch latest data from GitHub
    const response = await axios.get(
      `https://api.github.com/repositories/${repository.githubId}`,
      {
        headers: {
          Authorization: `Bearer ${user.githubAccessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    // Update repository with latest data
    await repository.syncData(response.data);

    return res.status(200).json(
      new ApiResponse(200, "Repository synced successfully", {
        repository,
      })
    );
  } catch (error) {
    console.error("Sync repository error:", error);

    if (error.response?.status === 404) {
      return res
        .status(404)
        .json(new ApiResponse(404, "Repository not found on GitHub"));
    }

    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to sync repository"));
  }
};

/**
 * Award badges for repository
 * POST /api/repositories/:id/award-badges
 */
const awardBadges = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { forceRecheck = false } = req.body;

    const repository = await Repository.findOne({
      _id: id,
      owner: userId,
      active: true,
    });

    if (!repository) {
      return res.status(404).json(new ApiResponse(404, "Repository not found"));
    }

    // Award badges using BadgeService
    const result = await BadgeService.awardBadgesForRepo(id, { forceRecheck });

    if (!result.success) {
      return res.status(500).json(
        new ApiResponse(500, "Failed to award badges", {
          error: result.error,
        })
      );
    }

    return res.status(200).json(
      new ApiResponse(200, "Badges awarded successfully", {
        result,
      })
    );
  } catch (error) {
    console.error("Award badges error:", error);
    return res.status(500).json(new ApiResponse(500, "Failed to award badges"));
  }
};

/**
 * Get user's badge progress for repository
 * GET /api/repositories/:id/badge-progress
 */
const getBadgeProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const repository = await Repository.findOne({
      _id: id,
      active: true,
    });

    if (!repository) {
      return res.status(404).json(new ApiResponse(404, "Repository not found"));
    }

    // Get user's badge progress
    const progress = await BadgeService.getUserBadgeProgress(userId, id);

    return res.status(200).json(
      new ApiResponse(200, "Badge progress retrieved", {
        progress,
        repository: {
          id: repository._id,
          name: repository.name,
          fullName: repository.fullName,
        },
      })
    );
  } catch (error) {
    console.error("Get badge progress error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to retrieve badge progress"));
  }
};

export {
  importRepositories,
  getUserRepositories,
  getRepositoryDetails,
  syncRepository,
  awardBadges,
  getBadgeProgress,
};
