import express from "express";
import {
  login,
  register,
  logout,
  getCurrentUser,
  githubRedirect,
  githubCallback,
} from "../controllers/auth.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = express.Router();

// Public routes
router.post("/register", register);
router.post("/login", login);

// GitHub OAuth
router.get("/github", githubRedirect);
router.get("/github/callback", githubCallback);

// Protected routes (require authentication)
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getCurrentUser);

export default router;
