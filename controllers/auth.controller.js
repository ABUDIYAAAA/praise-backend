import axios from "axios";
import { ApiResponse } from "../utils/api-response.js";
import User from "../models/user.model.js";
import { generateToken, getCookieOptions } from "../utils/jwt.js";

const githubRedirect = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  let redirectUri = process.env.GITHUB_CALLBACK_URL;
  const scope = "user:email";

  // Preserve the source parameter for extension detection
  if (req.query.source === "extension") {
    redirectUri += (redirectUri.includes("?") ? "&" : "?") + "source=extension";
  }

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

    const {
      id: githubId,
      login: githubUsername,
      email: profileEmail,
      avatar_url: githubAvatar,
    } = ghUserRes.data;

    let email = profileEmail; // Try to get email from profile first

    // If no email in profile, try to fetch from emails endpoint
    if (!email) {
      try {
        const ghEmailsRes = await axios.get(
          "https://api.github.com/user/emails",
          {
            headers: { Authorization: `token ${accessToken}` },
          }
        );

        const primaryEmailObj = Array.isArray(ghEmailsRes.data)
          ? ghEmailsRes.data.find((e) => e.primary) || ghEmailsRes.data[0]
          : null;
        email = primaryEmailObj ? primaryEmailObj.email : null;
      } catch (emailError) {
        console.warn(
          "Could not fetch user emails:",
          emailError.response?.data?.message || emailError.message
        );
        // Continue without email for now
      }
    }

    if (!email) {
      // If we can't get email, use a fallback format with GitHub username
      email = `${githubUsername}@github.local`;
      console.warn(
        `No email available for user ${githubUsername}, using fallback: ${email}`
      );
    }

    // Check if user exists by GitHub ID
    let user = await User.findOne({ githubId });
    if (user) {
      // Update existing user's token and username
      user.githubToken = accessToken;
      user.githubUsername = githubUsername;
      user.email = email; // Update email in case it changed on GitHub
      user.githubAvatar = githubAvatar;
      await user.save();
    } else {
      // Create new user from GitHub info
      user = await User.create({
        email,
        githubId,
        githubUsername,
        githubToken: accessToken,
        githubAvatar,
        onboardingComplete: true,
      });
    }

    // Generate JWT token and set cookie
    const token = generateToken(user);
    const cookieOptions = getCookieOptions();
    console.log("🍪 Setting cookie with options:", cookieOptions);
    res.cookie("authToken", token, cookieOptions);

    // Check if this is coming from extension (check referrer or add query param)
    const isExtension =
      req.query.source === "extension" ||
      req.headers.origin?.startsWith("chrome-extension://") ||
      req.headers.origin?.startsWith("moz-extension://");

    if (isExtension) {
      // Return a page that closes the popup and notifies the parent
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Complete</title>
          </head>
          <body>
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif;">
              <div style="text-align: center;">
                <h2>✅ Authentication Successful!</h2>
                <p>You can close this window now.</p>
                <p style="color: #666; font-size: 14px;">Redirecting back to extension...</p>
              </div>
            </div>
            <script>
              // Notify parent window and close popup
              if (window.opener) {
                window.opener.postMessage({ type: 'AUTH_SUCCESS', user: ${JSON.stringify(
                  {
                    userId: user._id,
                    email: user.email,
                    githubUsername: user.githubUsername,
                    onboardingComplete: user.onboardingComplete,
                  }
                )} }, '*');
              }
              // Close this popup window
              setTimeout(() => {
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }

    // For web app (non-extension), include token in URL since cookies might not work cross-origin
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    return res.redirect(
      `${frontendUrl}/home?token=${encodeURIComponent(token)}`
    );
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    return res.status(500).json(new ApiResponse(500, "GitHub callback failed"));
  }
};

// POST /auth/logout
const logout = (req, res) => {
  try {
    // Clear the authentication cookie using same options as when setting
    res.clearCookie("authToken", getCookieOptions());

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
        githubAvatar: user.githubAvatar,
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
