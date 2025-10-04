import axios from "axios";
import { ApiResponse } from "../utils/api-response.js";
import User from "../models/user.model.js";
import { generateToken, getCookieOptions } from "../utils/jwt.js";

const githubRedirect = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_CALLBACK_URL;
  const scope =
    "repo:status repo_deployment public_repo read:repo_hook read:org read:user user:email";

  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${encodeURIComponent(scope)}`;

  return res.redirect(url);
};

const githubCallback = async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res
        .status(400)
        .json(new ApiResponse(400, "Missing code from GitHub"));
    }

    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      return res
        .status(400)
        .json(new ApiResponse(400, "Failed to obtain GitHub access token"));
    }

    // Fetch user profile
    const ghUserRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });

    const ghEmailsRes = await axios.get("https://api.github.com/user/emails", {
      headers: { Authorization: `token ${accessToken}` },
    });

    const { id: githubId, login: githubUsername } = ghUserRes.data;
    const primaryEmailObj = Array.isArray(ghEmailsRes.data)
      ? ghEmailsRes.data.find((e) => e.primary) || ghEmailsRes.data[0]
      : null;
    const email = primaryEmailObj ? primaryEmailObj.email : null;

    if (!email) {
      return res
        .status(400)
        .json(
          new ApiResponse(
            400,
            "GitHub did not provide an email. Please ensure your GitHub email is public."
          )
        );
    }

    // Check if user exists by GitHub ID
    let user = await User.findOne({ githubId });
    if (user) {
      // Update existing user's token and username
      user.githubToken = accessToken;
      user.githubUsername = githubUsername;
      user.email = email; // Update email in case it changed on GitHub
      await user.save();
    } else {
      // Create new user from GitHub info
      user = await User.create({
        email,
        githubId,
        githubUsername,
        githubToken: accessToken,
        onboardingComplete: true,
      });
    }

    // Generate JWT token and set cookie
    const token = generateToken(user);
    res.cookie("authToken", token, getCookieOptions());

    return res.redirect(`${process.env.FRONTEND_URL}/home`);
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    return res.status(500).json(new ApiResponse(500, "GitHub callback failed"));
  }
};

// POST /auth/logout
const logout = (req, res) => {
  try {
    // Clear the authentication cookie
    res.clearCookie("authToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      path: "/",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, "Logged out successfully"));
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json(new ApiResponse(500, "Logout failed"));
  }
};

// GET /auth/me - Protected route to get current user info
const getCurrentUser = (req, res) => {
  try {
    // req.user is populated by authenticateToken middleware
    const user = req.user;

    return res.status(200).json(
      new ApiResponse(200, "User data retrieved", {
        userId: user._id,
        email: user.email,
        githubId: user.githubId,
        githubUsername: user.githubUsername,
        onboardingComplete: user.onboardingComplete,
      })
    );
  } catch (error) {
    console.error("Get current user error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, "Failed to get user data"));
  }
};

export { logout, getCurrentUser, githubRedirect, githubCallback };
