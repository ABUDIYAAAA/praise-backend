import express from "express";
import {
  checkAndAwardBadges,
  getUserBadgesForRepository,
  getUserBadgeProgress,
  getRepositoryLeaderboard,
} from "../controllers/badge.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// All badge routes require authentication
router.use(authenticateToken);

// POST /api/badges/check - Check and award badges for user in repository
router.post("/check", checkAndAwardBadges);

// GET /api/badges/repository/:id - Get user's badges for repository
router.get("/repository/:id", getUserBadgesForRepository);

// GET /api/badges/repository/:id/progress - Get user's badge progress for repository
router.get("/repository/:id/progress", getUserBadgeProgress);

// GET /api/badges/repository/:id/leaderboard - Get repository leaderboard
router.get("/repository/:id/leaderboard", getRepositoryLeaderboard);

export default router;
