import { Router, type IRouter } from "express";
import healthRouter from "./health";
import detectionsRouter from "./detections";

const router: IRouter = Router();

router.use(healthRouter);
router.use(detectionsRouter);

export default router;
