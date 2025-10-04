import express from "express";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.route.js";
import githubRoutes from "./routes/github.route.js";
import { captureRawBody } from "./middleware/webhook.middleware.js";

const app = express();

// Webhook middleware must come before express.json()
app.use(captureRawBody);
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/test-cors", (req, res) => {
  res.json({ msg: "CORS is working!" });
});
app.use(morgan("dev"));
app.use("/auth", authRoutes);
app.use("/github", githubRoutes);

export default app;
