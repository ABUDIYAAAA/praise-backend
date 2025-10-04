import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
const JWT_EXPIRE = process.env.JWT_EXPIRE || "7d";

/**
 * Generate JWT token for user
 * @param {Object} user - User object with _id and email
 * @returns {string} JWT token
 */
export const generateToken = (user) => {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    githubId: user.githubId || null,
    onboardingComplete: user.onboardingComplete || false,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRE,
    issuer: "praise-backend",
    audience: "praise-frontend",
  });
};

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded payload or null if invalid
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: "praise-backend",
      audience: "praise-frontend",
    });
  } catch (error) {
    console.error("JWT verification failed:", error.message);
    return null;
  }
};

/**
 * Generate cookie options for JWT
 * @returns {Object} Cookie options
 */
export const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true, // Prevent XSS attacks
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? "strict" : "lax", // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: "/",
  };
};
