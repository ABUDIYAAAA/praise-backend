import Repository from "../models/repository.model.js";
import Badge from "../models/badge.model.js";
import UserBadge from "../models/user-badge.model.js";
import PullRequest from "../models/pull-request.model.js";
import User from "../models/user.model.js";
import UserRepository from "../models/user-repository.model.js";
import mongoose from "mongoose";
import axios from "axios";

class BadgeService {
  /**
   * Import repositories and create default badges
   * @param {ObjectId} userId - The user ID who is importing the repositories
   * @param {Array} githubRepos - Array of GitHub repository data (with userRole property)
   * @returns {Object} - Import results with created repositories and badges
   */
  static async importRepositories(userId, githubRepos) {
    const session = await mongoose.startSession();
    const results = {
      success: true,
      imported: [],
      updated: [],
      errors: [],
      badgesCreated: 0,
    };

    try {
      await session.withTransaction(async () => {
        for (const githubRepo of githubRepos) {
          try {
            const userRole = githubRepo.userRole || "contributor";

            // Check if repository already exists
            let repository = await Repository.findOne({
              githubId: githubRepo.id,
            }).session(session);

            let isNewRepo = false;
            if (repository) {
              // Update existing repository
              await repository.syncData(githubRepo);
              results.updated.push({
                id: repository._id,
                name: repository.name,
                fullName: repository.fullName,
                role: userRole,
              });
            } else {
              isNewRepo = true;
              // For new repositories, we need to determine the actual owner
              // The owner in our system should be the GitHub repo owner, not necessarily the importing user
              let repoOwnerId = userId; // Default fallback

              // Try to find the GitHub repo owner in our system
              if (githubRepo.owner && githubRepo.owner.login) {
                const repoOwner = await User.findOne({
                  githubUsername: githubRepo.owner.login,
                }).session(session);
                if (repoOwner) {
                  repoOwnerId = repoOwner._id;
                }
              }

              // Create new repository
              repository = new Repository({
                name: githubRepo.name,
                fullName: githubRepo.full_name,
                owner: repoOwnerId,
                description: githubRepo.description,
                language: githubRepo.language,
                private: githubRepo.private,
                githubId: githubRepo.id,
                url: githubRepo.html_url,
                cloneUrl: githubRepo.clone_url,
                defaultBranch: githubRepo.default_branch || "main",
                stargazersCount: githubRepo.stargazers_count || 0,
                forksCount: githubRepo.forks_count || 0,
                topics: githubRepo.topics || [],
              });

              await repository.save({ session });

              // Create default badges for the repository
              // Check if badges already exist to avoid duplicates
              const existingBadges = await Badge.find({
                repository: repository._id,
                isDefault: true,
              }).session(session);

              if (existingBadges.length === 0) {
                const badges = await Badge.createDefaultBadges(
                  repository._id,
                  userId // Creator is the importing user (could be owner or contributor)
                );

                if (badges.length > 0) {
                  // Link badges to repository
                  repository.badges = badges.map((badge) => badge._id);
                  await repository.save({ session });
                  results.badgesCreated += badges.length;
                }
              }

              // Get badge count for the repository
              const badgeCount = await Badge.countDocuments({
                repository: repository._id,
                active: true,
              }).session(session);

              results.imported.push({
                id: repository._id,
                name: repository.name,
                fullName: repository.fullName,
                role: userRole,
                badgeCount,
              });
            }

            // Create or update UserRepository relationship
            await UserRepository.addUserToRepository(
              userId,
              repository._id,
              userRole
            );
          } catch (error) {
            console.error(
              `Error importing repository ${githubRepo.full_name}:`,
              error
            );
            results.errors.push({
              repository: githubRepo.full_name,
              error: error.message,
            });
          }
        }
      });
    } catch (error) {
      results.success = false;
      results.error = error.message;
    } finally {
      await session.endSession();
    }

    return results;
  }

  /**
   * Award badges to contributors for a specific repository
   * @param {ObjectId} repoId - The repository ID
   * @param {Object} options - Options for badge awarding
   * @returns {Object} - Award results with statistics
   */
  static async awardBadgesForRepo(repoId, options = {}) {
    const { forceRecheck = false, specificUserId = null } = options;

    try {
      // 1. Fetch repository and its active badges
      const repository = await Repository.findById(repoId)
        .populate("badges")
        .populate("owner");

      if (!repository) {
        throw new Error("Repository not found");
      }

      const activeBadges = await Badge.find({
        repository: repoId,
        active: true,
      });

      if (activeBadges.length === 0) {
        return {
          success: true,
          message: "No active badges found for repository",
          awardsGiven: 0,
        };
      }

      // 2. Get all contributors with their statistics
      const contributors = await this.getContributorStats(
        repoId,
        specificUserId
      );

      const results = {
        success: true,
        repositoryName: repository.fullName,
        badgesChecked: activeBadges.length,
        contributorsChecked: contributors.length,
        awardsGiven: 0,
        newAwards: [],
        errors: [],
      };

      // 3. For each contributor, check badge eligibility
      for (const contributor of contributors) {
        for (const badge of activeBadges) {
          try {
            // Skip if badge already awarded (unless force recheck)
            if (!forceRecheck) {
              const existingAward = await UserBadge.findOne({
                user: contributor.userId,
                badge: badge._id,
              });

              if (existingAward) {
                continue;
              }
            }

            // Check if user meets badge criteria
            const isEligible = await this.checkBadgeEligibility(
              contributor,
              badge
            );

            if (isEligible) {
              // Award the badge
              const awardResult = await UserBadge.awardBadge({
                userId: contributor.userId,
                badgeId: badge._id,
                repositoryId: repoId,
                actualValue: this.getActualValue(contributor, badge),
                triggeringEvent: "batch_award",
                metadata: {
                  batchProcessing: true,
                  contributorStats: contributor,
                },
              });

              if (awardResult.success) {
                results.awardsGiven++;
                results.newAwards.push({
                  userId: contributor.userId,
                  userEmail: contributor.userEmail,
                  badgeName: badge.name,
                  actualValue: this.getActualValue(contributor, badge),
                });
              }
            }
          } catch (error) {
            results.errors.push({
              userId: contributor.userId,
              badgeId: badge._id,
              error: error.message,
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.error("Error in awardBadgesForRepo:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch PR statistics from GitHub API for a user in a repository
   * @param {Object} repository - Repository document
   * @param {String} githubUsername - User's GitHub username
   * @param {String} accessToken - User's GitHub access token
   * @returns {Object} - PR statistics
   */
  static async fetchGitHubPRStats(repository, githubUsername, accessToken) {
    try {
      console.log("🔍 Fetching GitHub PR stats for:", {
        repo: repository.fullName,
        user: githubUsername,
      });

      const [owner, repoName] = repository.fullName.split("/");

      // Fetch pull requests from GitHub API
      let page = 1;
      let allPRs = [];
      let hasMore = true;

      while (hasMore && page <= 10) {
        // Limit to 10 pages (1000 PRs max)
        const response = await axios.get(
          `https://api.github.com/repos/${owner}/${repoName}/pulls`,
          {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            params: {
              state: "all", // Get open, closed, and merged PRs
              per_page: 100,
              page: page,
            },
          }
        );

        const prs = response.data;

        // Filter PRs by the specific user
        const userPRs = prs.filter((pr) => pr.user.login === githubUsername);
        allPRs = allPRs.concat(userPRs);

        hasMore = prs.length === 100; // If we got 100 PRs, there might be more
        page++;
      }

      console.log("📊 Found PRs from GitHub API:", allPRs.length);

      // Calculate statistics
      const totalPRs = allPRs.length;
      const mergedPRs = allPRs.filter((pr) => pr.merged_at !== null).length;
      const openPRs = allPRs.filter((pr) => pr.state === "open").length;
      const closedPRs = allPRs.filter(
        (pr) => pr.state === "closed" && pr.merged_at === null
      ).length;

      // For commits, we'd need to make additional API calls, so let's estimate
      // or fetch from a few recent PRs
      let totalCommits = 0;
      let totalAdditions = 0;
      let totalDeletions = 0;

      // Fetch commit details for ALL merged PRs (not just recent 10)
      const mergedPRsForCommits = allPRs.filter((pr) => pr.merged_at !== null);

      console.log(
        `📝 Fetching commit details for ${mergedPRsForCommits.length} merged PRs...`
      );

      for (const pr of mergedPRsForCommits) {
        try {
          const commitsResponse = await axios.get(pr.commits_url, {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          });
          totalCommits += commitsResponse.data.length;

          // Get PR details for additions/deletions
          const prDetailsResponse = await axios.get(pr.url, {
            headers: {
              Authorization: `token ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          });

          totalAdditions += prDetailsResponse.data.additions || 0;
          totalDeletions += prDetailsResponse.data.deletions || 0;
        } catch (error) {
          console.warn("Could not fetch commit details for PR:", pr.number);
        }
      }

      // Also fetch direct commits that aren't part of PRs
      try {
        console.log("🔍 Fetching direct commits from GitHub API...");
        let commitPage = 1;
        let hasMoreCommits = true;
        let directCommits = 0;

        while (hasMoreCommits && commitPage <= 5) {
          // Limit to 5 pages for performance
          const commitsResponse = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}/commits`,
            {
              headers: {
                Authorization: `token ${accessToken}`,
                Accept: "application/vnd.github.v3+json",
              },
              params: {
                author: githubUsername,
                per_page: 100,
                page: commitPage,
              },
            }
          );

          const commits = commitsResponse.data;
          directCommits += commits.length;

          hasMoreCommits = commits.length === 100;
          commitPage++;
        }

        console.log(
          `📊 Found ${directCommits} direct commits by ${githubUsername}`
        );

        // Use the higher number between PR commits and direct commits
        totalCommits = Math.max(totalCommits, directCommits);
      } catch (error) {
        console.warn("Could not fetch direct commits:", error.message);
      }

      const stats = {
        userId: githubUsername, // We'll resolve this to actual user ID later
        githubUsername,
        totalPRs,
        mergedPRs,
        openPRs,
        closedPRs,
        totalCommits,
        totalAdditions,
        totalDeletions,
        totalFilesChanged: 0, // Would need additional API calls
        firstContribution:
          allPRs.length > 0
            ? new Date(Math.min(...allPRs.map((pr) => new Date(pr.created_at))))
            : null,
        lastContribution:
          allPRs.length > 0
            ? new Date(Math.max(...allPRs.map((pr) => new Date(pr.created_at))))
            : null,
        totalLinesChanged: totalAdditions + totalDeletions,
      };

      console.log("🎯 GitHub Stats Summary:", {
        username: githubUsername,
        totalPRs: stats.totalPRs,
        mergedPRs: stats.mergedPRs,
        totalCommits: stats.totalCommits,
        totalLinesChanged: stats.totalLinesChanged,
        repository: repository.fullName,
      });

      return stats;
    } catch (error) {
      console.error(
        "Error fetching GitHub PR stats:",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  /**
   * Get contributor statistics for a repository (now using GitHub API)
   * @param {String|ObjectId} repoId - Repository ID
   * @param {String|ObjectId} specificUserId - Optional specific user ID
   * @returns {Array} - Array of contributor statistics
   */
  static async getContributorStats(repoId, specificUserId = null) {
    console.log("🔍 getContributorStats called with:", {
      repoId,
      specificUserId,
    });

    try {
      // Get repository details
      const repository = await Repository.findById(repoId);
      if (!repository) {
        throw new Error("Repository not found");
      }

      // If specific user requested, get their details and fetch from GitHub
      if (specificUserId) {
        const user = await User.findById(specificUserId);
        if (!user || !user.githubUsername || !user.githubToken) {
          console.log("❌ User not found or missing GitHub credentials");
          return [];
        }

        console.log("� Fetching live data from GitHub API...");
        const githubStats = await this.fetchGitHubPRStats(
          repository,
          user.githubUsername,
          user.githubToken
        );

        // Convert GitHub stats to our expected format
        const contributorStats = [
          {
            userId: user._id,
            userEmail: user.email,
            githubUsername: user.githubUsername,
            totalPRs: githubStats.totalPRs,
            mergedPRs: githubStats.mergedPRs,
            totalCommits: githubStats.totalCommits,
            totalAdditions: githubStats.totalAdditions,
            totalDeletions: githubStats.totalDeletions,
            totalFilesChanged: githubStats.totalFilesChanged,
            firstContribution: githubStats.firstContribution,
            lastContribution: githubStats.lastContribution,
            totalLinesChanged: githubStats.totalLinesChanged,
          },
        ];

        console.log("🎯 Live GitHub PR Stats:", {
          username: user.githubUsername,
          totalPRs: githubStats.totalPRs,
          mergedPRs: githubStats.mergedPRs,
          totalCommits: githubStats.totalCommits,
        });

        return contributorStats;
      }

      // If no specific user, fall back to database stats for all contributors
      console.log(
        "📊 Falling back to database aggregation for all contributors"
      );

      const contributorStats = await PullRequest.aggregate([
        { $match: { repository: repoId } },
        {
          $group: {
            _id: "$user",
            totalPRs: { $sum: 1 },
            mergedPRs: {
              $sum: { $cond: [{ $eq: ["$merged", true] }, 1, 0] },
            },
            totalCommits: { $sum: "$commitCount" },
            totalAdditions: { $sum: "$additions" },
            totalDeletions: { $sum: "$deletions" },
            totalFilesChanged: { $sum: "$changedFiles" },
            firstContribution: { $min: "$githubCreatedAt" },
            lastContribution: { $max: "$githubCreatedAt" },
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
        {
          $unwind: "$userDetails",
        },
        {
          $project: {
            userId: "$_id",
            userEmail: "$userDetails.email",
            githubUsername: "$userDetails.githubUsername",
            totalPRs: 1,
            mergedPRs: 1,
            totalCommits: 1,
            totalAdditions: 1,
            totalDeletions: 1,
            totalFilesChanged: 1,
            firstContribution: 1,
            lastContribution: 1,
            totalLinesChanged: { $add: ["$totalAdditions", "$totalDeletions"] },
          },
        },
      ]);

      return contributorStats;
    } catch (error) {
      console.error("Error in getContributorStats:", error);
      return [];
    }
  }

  /**
   * Check if a contributor is eligible for a specific badge
   * @param {Object} contributor - Contributor statistics
   * @param {Object} badge - Badge document
   * @returns {Boolean} - Whether the contributor is eligible
   */
  static async checkBadgeEligibility(contributor, badge) {
    switch (badge.criteriaType) {
      case "prs":
        return contributor.mergedPRs >= badge.criteriaValue;

      case "commits":
        return contributor.totalCommits >= badge.criteriaValue;

      case "issues":
        // This would require an Issue model
        // For now, return false
        return false;

      case "reviews":
        // This would require a Review model
        // For now, return false
        return false;

      case "stars":
        // This would be repository-level, not contributor-level
        return false;

      case "forks":
        // This would be repository-level, not contributor-level
        return false;

      default:
        return false;
    }
  }

  /**
   * Get the actual value that qualified the user for the badge
   * @param {Object} contributor - Contributor statistics
   * @param {Object} badge - Badge document
   * @returns {Number} - The actual value
   */
  static getActualValue(contributor, badge) {
    switch (badge.criteriaType) {
      case "prs":
        return contributor.mergedPRs;
      case "commits":
        return contributor.totalCommits;
      default:
        return 0;
    }
  }

  /**
   * Award badge to a specific user for a specific event
   * @param {Object} params - Award parameters
   * @returns {Object} - Award result
   */
  static async awardBadgeForEvent({
    userId,
    repositoryId,
    eventType,
    eventData = {},
    triggeringEvent = null,
  }) {
    try {
      // Get user stats for the repository
      const userStats = await this.getContributorStats(repositoryId, userId);

      if (userStats.length === 0) {
        return {
          success: false,
          message: "No contributions found for user in this repository",
        };
      }

      const contributor = userStats[0];

      // Get all active badges for the repository
      const badges = await Badge.find({
        repository: repositoryId,
        active: true,
      });

      const results = {
        success: true,
        awardsGiven: 0,
        newAwards: [],
      };

      // Check each badge for eligibility
      for (const badge of badges) {
        // Check if already awarded
        const existingAward = await UserBadge.findOne({
          user: userId,
          badge: badge._id,
        });

        if (existingAward) {
          continue;
        }

        // Check eligibility
        const isEligible = await this.checkBadgeEligibility(contributor, badge);

        if (isEligible) {
          const awardResult = await UserBadge.awardBadge({
            userId,
            badgeId: badge._id,
            repositoryId,
            actualValue: this.getActualValue(contributor, badge),
            triggeringEvent,
            metadata: {
              eventType,
              eventData,
              realTimeAwarding: true,
            },
          });

          if (awardResult.success) {
            results.awardsGiven++;
            results.newAwards.push(awardResult.award);
          }
        }
      }

      return results;
    } catch (error) {
      console.error("Error in awardBadgeForEvent:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get badge statistics for a repository
   * @param {ObjectId} repoId - Repository ID
   * @returns {Object} - Badge statistics
   */
  static async getRepositoryBadgeStats(repoId) {
    try {
      const [badgeStats, awardStats] = await Promise.all([
        Badge.find({ repository: repoId, active: true }).populate(
          "awardedCount"
        ),
        UserBadge.aggregate([
          { $match: { repository: repoId } },
          {
            $group: {
              _id: null,
              totalAwards: { $sum: 1 },
              uniqueRecipients: { $addToSet: "$user" },
              recentAwards: {
                $sum: {
                  $cond: [
                    {
                      $gte: [
                        "$awardedAt",
                        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

      return {
        totalBadges: badgeStats.length,
        totalAwards: awardStats[0]?.totalAwards || 0,
        uniqueRecipients: awardStats[0]?.uniqueRecipients?.length || 0,
        recentAwards: awardStats[0]?.recentAwards || 0,
        badgeDetails: badgeStats,
      };
    } catch (error) {
      console.error("Error getting repository badge stats:", error);
      throw error;
    }
  }

  /**
   * Get user's badge progress for a repository
   * @param {ObjectId} userId - User ID
   * @param {ObjectId} repoId - Repository ID
   * @returns {Object} - User's badge progress
   */
  static async getUserBadgeProgress(userId, repoId) {
    try {
      const [userStats, badges, earnedBadges] = await Promise.all([
        this.getContributorStats(repoId, userId),
        Badge.find({ repository: repoId, active: true }),
        UserBadge.find({ user: userId, repository: repoId }).populate("badge"),
      ]);

      const contributor = userStats[0] || {
        totalPRs: 0,
        mergedPRs: 0,
        totalCommits: 0,
      };

      const progress = badges.map((badge) => {
        const earned = earnedBadges.find((ub) =>
          ub.badge._id.equals(badge._id)
        );
        const currentValue = this.getActualValue(contributor, badge);
        const progress = Math.min(
          (currentValue / badge.criteriaValue) * 100,
          100
        );

        return {
          badge,
          earned: !!earned,
          earnedAt: earned?.awardedAt,
          currentValue,
          requiredValue: badge.criteriaValue,
          progress,
        };
      });

      return {
        contributor,
        totalBadges: badges.length,
        earnedBadges: earnedBadges.length,
        progress,
      };
    } catch (error) {
      console.error("Error getting user badge progress:", error);
      throw error;
    }
  }
}

export default BadgeService;
