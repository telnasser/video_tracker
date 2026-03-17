import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { detectionsTable, insertDetectionSchema } from "@workspace/db";
import { CreateDetectionBody } from "@workspace/api-zod";
import { desc, sql, count, max, avg } from "drizzle-orm";

const router: IRouter = Router();

router.get("/detections", async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const rows = await db
    .select()
    .from(detectionsTable)
    .orderBy(desc(detectionsTable.timestamp))
    .limit(limit);

  const mapped = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    personCount: r.personCount,
    boxes: r.boxes,
  }));

  res.json(mapped);
});

router.post("/detections", async (req, res) => {
  const parsed = CreateDetectionBody.parse(req.body);
  const insert = insertDetectionSchema.parse(parsed);

  const [row] = await db.insert(detectionsTable).values(insert).returning();

  res.status(201).json({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    personCount: row.personCount,
    boxes: row.boxes,
  });
});

router.get("/detections/stats", async (req, res) => {
  const [totals] = await db
    .select({
      totalDetections: count(),
      totalPersonsDetected: sql<number>`COALESCE(SUM(${detectionsTable.personCount}), 0)`,
      averagePersonsPerDetection: sql<number>`COALESCE(AVG(${detectionsTable.personCount}), 0)`,
      maxPersonsDetected: max(detectionsTable.personCount),
    })
    .from(detectionsTable);

  const recentActivity = await db
    .select({
      hour: sql<string>`TO_CHAR(DATE_TRUNC('hour', ${detectionsTable.timestamp}), 'YYYY-MM-DD HH24:00')`,
      count: count(),
    })
    .from(detectionsTable)
    .groupBy(sql`DATE_TRUNC('hour', ${detectionsTable.timestamp})`)
    .orderBy(sql`DATE_TRUNC('hour', ${detectionsTable.timestamp}) DESC`)
    .limit(24);

  const avgPerDetection = parseFloat(String(totals.averagePersonsPerDetection ?? 0));

  res.json({
    totalDetections: Number(totals.totalDetections ?? 0),
    totalPersonsDetected: Number(totals.totalPersonsDetected ?? 0),
    averagePersonsPerDetection: parseFloat(avgPerDetection.toFixed(2)),
    maxPersonsDetected: Number(totals.maxPersonsDetected ?? 0),
    recentActivity: recentActivity.map((r) => ({
      hour: r.hour,
      count: Number(r.count),
    })),
  });
});

export default router;
