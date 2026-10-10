import crypto from "crypto";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
	type NextFunction,
} from "express";
import httpStatus from "http-status";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { redisClient } from "./app/lib/redis";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import cookieParser from "cookie-parser";
import config from "./app/config";
import { userRoutes } from "./app/module/user/user.route";

const app: Application = express();

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/user", userRoutes);

app.get("/test", async (req: Request, res: Response, next: NextFunction) => {
	try {
		
		const otp = crypto.randomInt(100000,1000000)

		await redisClient.set("forget-password-otp:patient1@gmail.com","123456",{
			expiration : {
				type : "EX",
				value : 60
			}
		})
		
		res.status(httpStatus.OK).json({
			success: true,
			message: "Welcome to PH Healthcare System Backend",
			data : otp
		});
	} catch (error) {
		console.log(error);
		next(error);
	}
});

// Basic route
app.get("/", async (req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to PH Healthcare System Backend",
	});
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
