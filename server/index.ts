import express from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { createServer as createViteServer } from "vite";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { pool } from "./db";
import { createApi } from "./routes";
import { verifiedIdentityResolver } from "./auth";

const app = express();
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY)
})));
app.use(createApi(pool, verifiedIdentityResolver(pool)));
if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist/client"));
  app.get("/{*path}", (_req, res) => res.sendFile("dist/client/index.html", { root: process.cwd() }));
} else {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}
app.listen(5000, "0.0.0.0", () => console.log("EdCurie listening on port 5000"));
