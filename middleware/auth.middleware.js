import { verifyToken } from "../utils/jwt.js";
import User from "../models/user.model.js";
import { ApiResponse } from "../utils/api-response.js";

/**
 * Middleware to authenticate requests using JWT tokens
 * Checks for token in cookies (preferred) or Authorization header
 * Attaches user data to req.user if valid
 */
export const authenticateToken = async (req, res, next) => {
  try {
    // Get token from cookie (preferred) or Authorization header
    let token = req.cookies?.authToken;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res
        .status(401)
        .json(new ApiResponse(401, "Access token required"));
    }

    // Verify the token
    const decoded = verifyToken(token);
    if (!decoded) {
      return res
        .status(401)
        .json(new ApiResponse(401, "Invalid or expired token"));
    }

    // Fetch current user data from database (in case data changed)
    const user = await User.findById(decoded.userId).select(
      "-passwordHash -githubToken"
    );
    if (!user) {
      return res.status(401).json(new ApiResponse(401, "User not found"));
    }

    // Attach user data to request object
    req.user = user;
    req.tokenPayload = decoded;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json(new ApiResponse(500, "Authentication error"));
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token
 * Useful for routes that work with or without authentication
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.authToken;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.userId).select(
          "-passwordHash -githubToken"
        );
        if (user) {
          req.user = user;
          req.tokenPayload = decoded;
        }
      }
    }

    next();
  } catch (error) {
    console.error("Optional auth middleware error:", error);
    next(); // Continue even if error
  }
};
