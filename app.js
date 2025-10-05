import express from "express";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.route.js";
import githubRoutes from "./routes/github.route.js";
import repositoryRoutes from "./routes/repository.route.js";
import badgeRoutes from "./routes/badge.route.js";
import { captureRawBody } from "./middleware/webhook.middleware.js";

const app = express();

// Webhook middleware must come before express.json()
app.use(captureRawBody);
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend web app (dev)
      "http://localhost:5174", // Alternative dev port
      "http://localhost:4173", // Vite preview port
      "https://praise-frontend-production.up.railway.app", // Add your deployed frontend URL
      process.env.FRONTEND_URL, // Dynamic frontend URL from env
      /^chrome-extension:\/\//, // Chrome extension
      /^moz-extension:\/\//, // Firefox extension
    ].filter(Boolean), // Remove any undefined values
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/test-cors", (req, res) => {
  res.json({ msg: "CORS is working!" });
});
app.use(morgan("dev"));
app.use("/auth", authRoutes);
app.use("/github", githubRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/badges", badgeRoutes);

export default app;
