/**
 * Middleware to capture raw request body for webhook signature verification
 * GitHub webhooks require the raw body to verify the signature
 */
export const captureRawBody = (req, res, next) => {
  if (req.path === "/github/webhook" && req.method === "POST") {
    let data = "";
    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => {
      req.rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch (error) {
        console.error("Failed to parse webhook JSON:", error);
        return res.status(400).json({ error: "Invalid JSON" });
      }
      next();
    });
  } else {
    next();
  }
};
