import { NextFunction, Request, Response } from "express";
import z from "zod";
import { catchAsync } from "../utils/catchAsync";
import httpStatus from "http-status";
import { AppError } from "../utils/AppError";

export const validateRequest = (zodSchema : z.ZodObject) => {
	return catchAsync(
		(req:Request,res:Response,next:NextFunction)=>{
			// const payload = req.body ? req.body : {}
			const payload = req.body ?? {}
			const result = zodSchema.safeParse(payload)
			if (!result.success) {
				// let errorMessage = "";
				// payload.error.issues.forEach((issue) => {
				// 	errorMessage = errorMessage + "\n" + issue.message;
				// });
				throw new AppError(httpStatus.BAD_REQUEST, result.error.issues[0].message);
			}

			req.body = result.data

			next()
		}
	)
}

