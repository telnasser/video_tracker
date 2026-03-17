import { Router, type IRouter } from "express";
import multer from "multer";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);
const router: IRouter = Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

router.post("/transcode", upload.single("video"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  const inputPath = req.file.path;
  const outputPath = path.join(os.tmpdir(), `${req.file.filename}_out.mp4`);

  try {
    const cmd = [
      "ffmpeg -y",
      `-i "${inputPath}"`,
      "-c:v libx264 -preset fast -crf 23",
      "-c:a aac -b:a 128k",
      "-movflags +faststart",
      `"${outputPath}"`,
    ].join(" ");

    await execAsync(cmd, { timeout: 10 * 60 * 1000 }); // 10 min hard limit

    const stat = fs.statSync(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", 'attachment; filename="converted.mp4"');

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    const cleanup = () => {
      fs.unlink(inputPath, () => {});
      fs.unlink(outputPath, () => {});
    };
    stream.on("end", cleanup);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      cleanup();
    });
  } catch (err) {
    console.error("Transcode failed:", err);
    fs.unlink(inputPath, () => {});
    fs.unlink(outputPath, () => {});
    res.status(500).json({ error: "Transcoding failed — ffmpeg error" });
  }
});

export default router;
