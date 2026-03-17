import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const boundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  confidence: z.number(),
  trackId: z.number().int(),
});

export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const detectionsTable = pgTable("detections", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  personCount: integer("person_count").notNull(),
  boxes: jsonb("boxes").notNull().$type<BoundingBox[]>(),
});

export const insertDetectionSchema = createInsertSchema(detectionsTable).omit({ id: true, timestamp: true }).extend({
  boxes: z.array(boundingBoxSchema),
});

export type InsertDetection = z.infer<typeof insertDetectionSchema>;
export type Detection = typeof detectionsTable.$inferSelect;
