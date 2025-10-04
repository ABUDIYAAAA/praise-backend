import express from "express";
import {
  handleWebhook,
  getUserEvents,
  getEventDetails,
} from "../controllers/github.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// Public webhook endpoint (GitHub calls this)
// POST /github/webhook
router.post("/webhook", handleWebhook);

// Protected endpoints (require authentication)
// GET /github/events - Get user's webhook events
router.get("/events", authenticateToken, getUserEvents);

// GET /github/events/:id - Get detailed event info
router.get("/events/:id", authenticateToken, getEventDetails);

export default router;
