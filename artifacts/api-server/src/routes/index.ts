import { Router, type IRouter } from "express";
import healthRouter from "./health";
import detectionsRouter from "./detections";
import transcodeRouter from "./transcode";

const router: IRouter = Router();

router.use(healthRouter);
router.use(detectionsRouter);
router.use(transcodeRouter);

export default router;
