import { ApiResponse } from "../utils/api-response.js";
import User from "../models/user.model.js";
import Repository from "../models/repository.model.js";
import Badge from "../models/badge.model.js";
import UserBadge from "../models/user-badge.model.js";
import PullRequest from "../models/pull-request.model.js";
import UserRepository from "../models/user-repository.model.js";
import BadgeService from "../services/badgeService.js";
import mongoose from "mongoose";

/**
 * Check and award badges for a user in a specific repository
 * POST /api/badges/check
 */
const checkAndAwardBadges = async (req, res) => {
  try {
    const { repositoryId } = req.body;
    const userId = req.user._id;

    if (!repositoryId) {
      return res
        .status(400)
        .json(new ApiResponse(400, "Repository ID is required"));
    }

    // Verify user has access to this repository
    const userRepository = await UserRepository.findOne({
      user: userId,
      repository: repositoryId,
      active: true,
    }).populate("repository");

    if (!userRepository) {
      return res
        .status(404)
        .json(new ApiResponse(404, "Repository not found or access denied"));
    }

    // Get user's contribution statistics for this repository
    const contributorStats = await BadgeService.getContributorStats(
      repositoryId,
      userId
    );

    if (contributorStats.length === 0) {
      return res.status(200).json(
        new ApiResponse(200, "No contributions found", {
          newlyAwarded: [],
          contributorStats: {
            totalPRs: 0,
            mergedPRs: 0,
            totalCommits: 0,
          },
        })
      );
    }

    const contributor = contributorStats[0];

    // Get all active badges for this repository
    const badges = await Badge.find({
      repository: repositoryId,
      active: true,
    }).sort({ criteriaValue: 1 }); // Start with lowest criteria

    // Get already awarded badges to avoid duplicates
    const existingBadges = await UserBadge.find({
      user: userId,
      repository: repositoryId,
    }).populate("badge", "name description icon color");

    const existingBadgeIds = new Set(
      existingBadges.map((ub) => ub.badge._id.toString())
    );

    // Check eligibility and award new badges
    const newlyAwarded = [];

    for (const badge of badges) {
      // Skip if already awarded
      if (existingBadgeIds.has(badge._id.toString())) {
        continue;
      }

      // Check if user meets criteria
      const isEligible = await BadgeService.checkBadgeEligibility(
        contributor,
        badge
      );

      if (isEligible) {
        try {
          // Award the badge
          const awardResult = await UserBadge.awardBadge({
            userId,
            badgeId: badge._id,
            repositoryId,
            actualValue: BadgeService.getActualValue(contributor, badge),
            triggeringEvent: "manual_check",
            metadata: {
              checkTriggered: true,
              contributorStats: contributor,
            },
          });

          if (awardResult.success) {
            newlyAwarded.push({
              id: badge._id,
              name: badge.name,
              description: badge.description,
              icon: badge.icon,
              color: badge.color,
              difficulty: badge.difficulty,
              criteriaType: badge.criteriaType,
              criteriaValue: badge.criteriaValue,
              actualValue: BadgeService.getActualValue(contributor, badge),
              awardedAt: awardResult.award.awardedAt,
            });
          }
        } catch (error) {
          console.error(`Error awarding badge ${badge.name}:`, error);
        }
      }
    }

    return res.status(200).json(
      new ApiResponse(200, "Badge check completed", {
        newlyAwarded,
        contributorStats: contributor,
        repositoryName: userRepository.repository.name,
        userRole: userRepository.role,
        totalBadges: badges.length,
        awardedBadges: existingBadges.length + newlyAwarded.length,
      })
    );
  } catch (error) {
    console.error("Check badges error:", error);
    return res.status(500).json(new ApiResponse(500, "Failed to check badges"));
  }
};

/**
 * Get user's badges for a repository
 * GET /api/badges/repository/:id
 */
const getUserBadgesForRepository = async (req, res) => {
  try {
    const { id: repositoryId } = req.params;
    const userId = req.user._id;

    // Verify user has access to this repository
    const userRepository = await UserRepository.findOne({
      user: userId,
      repository: repositoryId,
      active: true,
    });

    if (!userRepository) {
      return res
        .status(404)
        .json(new ApiResponse(404, "Repository not found or access denied"));
    }

    // Get user's badges for this repository
    const userBadges = await UserBadge.find({
      user: userId,
      repository: repositoryId,
    })
      .populate("badge")
      .sort({ awardedAt: -1 });

    // Get all available badges for progress tracking
    const allBadges = await Badge.find({
      repository: repositoryId,
      active: true,
    }).sort({ criteriaValue: 1 });

    // Get user's contribution stats
    const contributorStats = await BadgeService.getContributorStats(
      repositoryId,
      userId
    );
    const contributor = contributorStats[0] || {
      totalPRs: 0,
      mergedPRs: 0,
      totalCommits: 0,
    };

    // Calculate progress for each badge
    const badgeProgress = allBadges.map((badge) => {
      const userBadge = userBadges.find((ub) => ub.badge._id.equals(badge._id));
      const actualValue = BadgeService.getActualValue(contributor, badge);
      const progress = Math.min((actualValue / badge.criteriaValue) * 100, 100);

      return {
        badge: {
          id: badge._id,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          color: badge.color,
          difficulty: badge.difficulty,
          criteriaType: badge.criteriaType,
          criteriaValue: badge.criteriaValue,
        },
        earned: !!userBadge,
        awardedAt: userBadge?.awardedAt,
        actualValue,
        progress,
        progressPercentage: Math.round(progress),
      };
    });

    return res.status(200).json(
      new ApiResponse(200, "User badges retrieved", {
        badges: badgeProgress,
        contributorStats: contributor,
        summary: {
          totalBadges: allBadges.length,
          earnedBadges: userBadges.length,
          progressPercentage: Math.round(
            (userBadges.length / allBadges.length) * 100
          ),
        },
      })
    );
  } catch (error) {
    console.error("Get user badges error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to retrieve user badges"));
  }
};

/**
 * Get badge leaderboard for a repository
 * GET /api/badges/repository/:id/leaderboard
 */
const getRepositoryLeaderboard = async (req, res) => {
  try {
    const { id: repositoryId } = req.params;
    const { limit = 10 } = req.query;
    const userId = req.user._id;
    // Verify user has access to this repository
    const userRepository = await UserRepository.findOne({
      user: userId,
      repository: repositoryId,
      active: true,
    });

    if (!userRepository) {
      return res
        .status(404)
        .json(new ApiResponse(404, "Repository not found or access denied"));
    }

    // Get leaderboard data
    const leaderboard = await UserBadge.aggregate([
      { $match: { repository: new mongoose.Types.ObjectId(repositoryId) } },
      {
        $group: {
          _id: "$user",
          badgeCount: { $sum: 1 },
          latestBadge: { $max: "$awardedAt" },
          badges: { $push: "$badge" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $lookup: {
          from: "badges",
          localField: "badges",
          foreignField: "_id",
          as: "badgeDetails",
        },
      },
      {
        $project: {
          userId: "$_id",
          user: {
            email: "$userDetails.email",
            githubUsername: "$userDetails.githubUsername",
          },
          badgeCount: 1,
          latestBadge: 1,
          isCurrentUser: { $eq: ["$_id", new mongoose.Types.ObjectId(userId)] },
        },
      },
      { $sort: { badgeCount: -1, latestBadge: -1 } },
      { $limit: parseInt(limit) },
    ]);

    return res.status(200).json(
      new ApiResponse(200, "Leaderboard retrieved", {
        leaderboard,
        repositoryId,
      })
    );
  } catch (error) {
    console.error("Get leaderboard error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to retrieve leaderboard"));
  }
};

/**
 * Get user's badge progress for a repository
 * GET /api/badges/repository/:repositoryId/progress
 */
const getUserBadgeProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    console.log(id);
    console.log("hi");
    // Verify user has access to this repository
    const userRepository = await UserRepository.findOne({
      user: userId,
      repository: id,
      active: true,
    }).populate("repository");

    if (!userRepository) {
      return res
        .status(404)
        .json(new ApiResponse(404, "Repository not found or access denied"));
    }

    // Get user's contribution statistics
    const contributorStats = await BadgeService.getContributorStats(id, userId);
    const userStats =
      contributorStats.length > 0
        ? contributorStats[0]
        : {
            totalPRs: 0,
            mergedPRs: 0,
            totalCommits: 0,
            totalIssues: 0,
          };

    // Get all badges for this repository
    const allBadges = await Badge.find({
      repository: id,
      active: true,
    }).sort({ criteriaValue: 1 });

    // Get user's awarded badges
    const awardedBadges = await UserBadge.find({
      user: userId,
      repository: id,
    }).populate("badge");

    const awardedBadgeIds = new Set(
      awardedBadges.map((ub) => ub.badge._id.toString())
    );

    // Create badge progress data
    const badgeProgress = allBadges.map((badge) => {
      const isAwarded = awardedBadgeIds.has(badge._id.toString());
      const currentValue = BadgeService.getActualValue(userStats, badge);
      const progress = Math.min(
        (currentValue / badge.criteriaValue) * 100,
        100
      );

      return {
        _id: badge._id,
        name: badge.name,
        description: badge.description,
        criteriaType: badge.criteriaType,
        criteriaValue: badge.criteriaValue,
        icon: badge.icon,
        color: badge.color,
        difficulty: badge.difficulty,
        isAwarded,
        currentValue,
        progress: Math.round(progress),
      };
    });

    // Get PR activity for chart (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const prActivity = await PullRequest.aggregate([
      {
        $match: {
          repository: new mongoose.Types.ObjectId(id),
          author: userId,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Create comprehensive chart data
    const chartData = {
      contributionOverview: {
        totalPRs: userStats.totalPRs || 0,
        mergedPRs: userStats.mergedPRs || 0,
        openPRs: userStats.openPRs || 0,
        closedPRs: userStats.closedPRs || 0,
        totalCommits: userStats.totalCommits || 0,
        totalAdditions: userStats.totalAdditions || 0,
        totalDeletions: userStats.totalDeletions || 0,
        totalLinesChanged: userStats.totalLinesChanged || 0,
      },
      activityTimeline: {
        firstContribution: userStats.firstContribution,
        lastContribution: userStats.lastContribution,
        prActivity: prActivity,
      },
      badgeStats: {
        totalBadges: badgeProgress.length,
        earnedBadges: badgeProgress.filter((b) => b.isAwarded).length,
        progressPercentage: Math.round(
          (badgeProgress.filter((b) => b.isAwarded).length /
            badgeProgress.length) *
            100
        ),
      },
    };

    res.status(200).json(
      new ApiResponse(200, "Badge progress fetched successfully", {
        userStats,
        badgeProgress,
        chartData,
        userRole: userRepository.role,
        repository: {
          name: userRepository.repository.name,
          fullName: userRepository.repository.fullName,
        },
      })
    );
  } catch (error) {
    console.error("Get user badge progress error:", error);
    res
      .status(500)
      .json(new ApiResponse(500, "Internal server error", null, error.message));
  }
};

export {
  checkAndAwardBadges,
  getUserBadgesForRepository,
  getUserBadgeProgress,
  getRepositoryLeaderboard,
};
