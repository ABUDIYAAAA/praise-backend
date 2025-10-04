import crypto from "crypto";
import { ApiResponse } from "../utils/api-response.js";
import User from "../models/user.model.js";
import WebhookEvent from "../models/webhook-event.model.js";

/**
 * Verify GitHub webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - GitHub signature from headers
 * @returns {boolean} - Whether signature is valid
 */
const verifyGitHubSignature = (payload, signature) => {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET not configured");
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(payload, "utf8")
    .digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Handle GitHub webhook events
 * POST /github/webhook
 */
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];

    // Verify webhook signature
    if (!signature || !verifyGitHubSignature(req.rawBody, signature)) {
      console.log("Invalid GitHub webhook signature");
      return res.status(401).json(new ApiResponse(401, "Invalid signature"));
    }

    const payload = req.body;

    console.log(`GitHub Webhook Event: ${event} (Delivery: ${deliveryId})`);
    console.log("Repository:", payload.repository?.full_name);
    console.log("Sender:", payload.sender?.login);

    // Find associated user
    let associatedUser = null;
    if (payload.repository?.owner?.login || payload.sender?.login) {
      associatedUser = await User.findOne({
        $or: [
          { githubUsername: payload.repository?.owner?.login },
          { githubUsername: payload.sender?.login },
        ],
      });
    }

    // Store webhook event in database
    try {
      await WebhookEvent.create({
        eventType: event,
        deliveryId,
        repository: payload.repository
          ? {
              fullName: payload.repository.full_name,
              owner: payload.repository.owner?.login,
              private: payload.repository.private,
            }
          : null,
        sender: payload.sender
          ? {
              login: payload.sender.login,
              id: payload.sender.id,
            }
          : null,
        action: payload.action,
        payload,
        userId: associatedUser?._id,
      });
      console.log("Webhook event stored in database");
    } catch (dbError) {
      console.error("Failed to store webhook event:", dbError);
    }

    // Handle different event types
    switch (event) {
      case "push":
        await handlePushEvent(payload);
        break;
      case "pull_request":
        await handlePullRequestEvent(payload);
        break;
      case "issues":
        await handleIssueEvent(payload);
        break;
      case "commit_comment":
        await handleCommitCommentEvent(payload);
        break;
      case "create":
        await handleCreateEvent(payload);
        break;
      case "delete":
        await handleDeleteEvent(payload);
        break;
      case "fork":
        await handleForkEvent(payload);
        break;
      case "release":
        await handleReleaseEvent(payload);
        break;
      case "star":
        await handleStarEvent(payload);
        break;
      case "watch":
        await handleWatchEvent(payload);
        break;
      default:
        console.log(`Unhandled event type: ${event}`);
        await handleGenericEvent(event, payload);
    }

    return res.status(200).json(new ApiResponse(200, "Webhook processed"));
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Webhook processing failed"));
  }
};

/**
 * Handle push events (new commits)
 */
const handlePushEvent = async (payload) => {
  const { repository, pusher, commits, ref } = payload;

  console.log(`Push to ${repository.full_name} on ${ref} by ${pusher.name}`);
  console.log(`${commits.length} commit(s) pushed:`);

  commits.forEach((commit, index) => {
    console.log(
      `  ${index + 1}. ${commit.message} (${commit.id.substring(0, 7)}) by ${
        commit.author.name
      }`
    );
  });

  // Find user by repository owner or pusher
  const user = await User.findOne({
    $or: [
      { githubUsername: repository.owner.login },
      { githubUsername: pusher.name },
    ],
  });

  if (user) {
    console.log(`Associated with user: ${user.email}`);
    // Here you can store the event data, trigger notifications, etc.
  }
};

/**
 * Handle pull request events
 */
const handlePullRequestEvent = async (payload) => {
  const { action, pull_request, repository, sender } = payload;

  console.log(
    `PR ${action}: #${pull_request.number} "${pull_request.title}" in ${repository.full_name}`
  );
  console.log(`From: ${pull_request.head.ref} → ${pull_request.base.ref}`);
  console.log(`By: ${sender.login}`);

  const user = await User.findOne({
    $or: [
      { githubUsername: repository.owner.login },
      { githubUsername: sender.login },
    ],
  });

  if (user) {
    console.log(`Associated with user: ${user.email}`);
  }
};

/**
 * Handle issue events
 */
const handleIssueEvent = async (payload) => {
  const { action, issue, repository, sender } = payload;

  console.log(
    `Issue ${action}: #${issue.number} "${issue.title}" in ${repository.full_name}`
  );
  console.log(`By: ${sender.login}`);
};

/**
 * Handle commit comment events
 */
const handleCommitCommentEvent = async (payload) => {
  const { action, comment, repository, sender } = payload;

  console.log(`Commit comment ${action} in ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);
  console.log(`By: ${sender.login}`);
};

/**
 * Handle branch/tag creation
 */
const handleCreateEvent = async (payload) => {
  const { ref_type, ref, repository, sender } = payload;

  console.log(
    `${ref_type} created: ${ref} in ${repository.full_name} by ${sender.login}`
  );
};

/**
 * Handle branch/tag deletion
 */
const handleDeleteEvent = async (payload) => {
  const { ref_type, ref, repository, sender } = payload;

  console.log(
    `${ref_type} deleted: ${ref} in ${repository.full_name} by ${sender.login}`
  );
};

/**
 * Handle repository fork
 */
const handleForkEvent = async (payload) => {
  const { forkee, repository, sender } = payload;

  console.log(
    `Repository forked: ${repository.full_name} → ${forkee.full_name} by ${sender.login}`
  );
};

/**
 * Handle release events
 */
const handleReleaseEvent = async (payload) => {
  const { action, release, repository, sender } = payload;

  console.log(
    `Release ${action}: ${release.tag_name} in ${repository.full_name}`
  );
  console.log(`Release name: ${release.name}`);
  console.log(`By: ${sender.login}`);
};

/**
 * Handle star events
 */
const handleStarEvent = async (payload) => {
  const { action, repository, sender } = payload;

  console.log(
    `Repository ${action === "created" ? "starred" : "unstarred"}: ${
      repository.full_name
    } by ${sender.login}`
  );
};

/**
 * Handle watch events
 */
const handleWatchEvent = async (payload) => {
  const { action, repository, sender } = payload;

  console.log(
    `Repository ${action}: ${repository.full_name} by ${sender.login}`
  );
};

/**
 * Handle any unspecified events
 */
const handleGenericEvent = async (eventType, payload) => {
  const { repository, sender } = payload;

  console.log(
    `Generic event (${eventType}): ${repository?.full_name || "No repo"} by ${
      sender?.login || "Unknown"
    }`
  );
  console.log("Payload keys:", Object.keys(payload));
};

/**
 * Get webhook events for the authenticated user
 * GET /github/events
 */
const getUserEvents = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, eventType } = req.query;

    const filter = { userId };
    if (eventType) {
      filter.eventType = eventType;
    }

    const events = await WebhookEvent.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select("-payload") // Exclude full payload for list view
      .lean();

    const total = await WebhookEvent.countDocuments(filter);

    return res.status(200).json(
      new ApiResponse(200, "Events retrieved", {
        events,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    console.error("Get user events error:", error);
    return res.status(500).json(new ApiResponse(500, "Failed to get events"));
  }
};

/**
 * Get detailed webhook event by ID
 * GET /github/events/:id
 */
const getEventDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const event = await WebhookEvent.findOne({ _id: id, userId });

    if (!event) {
      return res.status(404).json(new ApiResponse(404, "Event not found"));
    }

    return res
      .status(200)
      .json(new ApiResponse(200, "Event details retrieved", { event }));
  } catch (error) {
    console.error("Get event details error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to get event details"));
  }
};

export { handleWebhook, getUserEvents, getEventDetails };
