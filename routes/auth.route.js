import express from "express";
import {
  logout,
  getCurrentUser,
  githubRedirect,
  githubCallback,
} from "../controllers/auth.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// GitHub OAuth (public routes)
router.get("/github", githubRedirect);
router.get("/github/callback", githubCallback);

// Protected routes (require authentication)
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getCurrentUser);

export default router;
