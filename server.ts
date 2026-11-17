import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  analyzeRequestSchema,
  discoverJobsRequestSchema,
  fetchJobRequestSchema,
} from "./src/lib/validation.ts";
import { analyzeJobPosting, AnalysisError } from "./server/analyzeJob.ts";
import { fetchJobFromUrl, JobFetchError } from "./server/fetchJob.ts";
import { discoverJobs } from "./server/jobDiscovery/discoverJobs.ts";
import { DiscoverySourceError } from "./server/jobDiscovery/httpClient.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === "production";

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/analyze", async (req, res) => {
    const parsedReq = analyzeRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      const firstIssue = parsedReq.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Virheellinen pyyntö.",
      });
      return;
    }

    const controller = new AbortController();
    const handleClientDisconnect = () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    };

    req.on("aborted", handleClientDisconnect);
    res.on("close", handleClientDisconnect);

    try {
      const analysis = await analyzeJobPosting({
        jobText: parsedReq.data.jobText,
        jobUrl: parsedReq.data.jobUrl,
        profile: parsedReq.data.profile,
        signal: controller.signal,
      });

      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      res.json({ analysis });
    } catch (error) {
      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      if (error instanceof AnalysisError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error("Unexpected analysis failure:", error);
      res.status(500).json({
        error: "Analyysi epäonnistui odottamattoman palvelinvirheen vuoksi.",
      });
    } finally {
      req.off("aborted", handleClientDisconnect);
      res.off("close", handleClientDisconnect);
    }
  });

  app.post("/api/fetch-job", async (req, res) => {
    const parsedReq = fetchJobRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      const firstIssue = parsedReq.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Virheellinen URL-pyyntö.",
      });
      return;
    }

    const controller = new AbortController();
    const handleClientDisconnect = () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    };

    req.on("aborted", handleClientDisconnect);
    res.on("close", handleClientDisconnect);

    try {
      const result = await fetchJobFromUrl(parsedReq.data.url, {
        signal: controller.signal,
      });

      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      res.json(result);
    } catch (error) {
      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      if (error instanceof JobFetchError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error("Unexpected job fetch failure:", error);
      res.status(500).json({
        error: "Ilmoituksen nouto epäonnistui odottamattoman palvelinvirheen vuoksi. Voit liittää ilmoitustekstin käsin.",
      });
    } finally {
      req.off("aborted", handleClientDisconnect);
      res.off("close", handleClientDisconnect);
    }
  });

  app.post("/api/discover-jobs", async (req, res) => {
    const parsedReq = discoverJobsRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      const firstIssue = parsedReq.error.issues[0];
      res.status(400).json({
        error: firstIssue?.message ?? "Virheellinen työpaikkahaun pyyntö.",
      });
      return;
    }

    const controller = new AbortController();
    const handleClientDisconnect = () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    };

    req.on("aborted", handleClientDisconnect);
    res.on("close", handleClientDisconnect);

    try {
      const result = await discoverJobs(parsedReq.data, {
        signal: controller.signal,
      });

      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      res.json(result);
    } catch (error) {
      if (controller.signal.aborted || res.writableEnded || res.destroyed) {
        return;
      }

      if (error instanceof DiscoverySourceError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error("Unexpected job discovery failure:", error);
      res.status(500).json({
        error:
          "Työpaikkojen haku epäonnistui odottamattoman palvelinvirheen vuoksi.",
      });
    } finally {
      req.off("aborted", handleClientDisconnect);
      res.off("close", handleClientDisconnect);
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*all", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Career Intelligence Agent listening on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
