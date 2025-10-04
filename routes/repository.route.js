import express from "express";
import {
  importRepositories,
  getUserRepositories,
  getRepositoryDetails,
  syncRepository,
  awardBadges,
  getBadgeProgress,
} from "../controllers/repository.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// All repository routes require authentication
router.use(authenticateToken);

// POST /api/repositories/import - Import repositories from GitHub
router.post("/import", importRepositories);

// GET /api/repositories - Get user's imported repositories
router.get("/", getUserRepositories);

// GET /api/repositories/:id - Get repository details
router.get("/:id", getRepositoryDetails);

// POST /api/repositories/:id/sync - Sync repository with GitHub
router.post("/:id/sync", syncRepository);

// POST /api/repositories/:id/award-badges - Award badges for repository
router.post("/:id/award-badges", awardBadges);

// GET /api/repositories/:id/badge-progress - Get badge progress for repository
router.get("/:id/badge-progress", getBadgeProgress);

export default router;
