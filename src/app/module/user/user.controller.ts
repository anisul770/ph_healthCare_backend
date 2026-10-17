import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";
import { sendResponse } from "../../utils/sendResponse";
import { userServices } from "./user.service";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {

    if (!req.file) {
       throw new AppError(httpStatus.BAD_REQUEST, "No File Provided.")
    }
    const userId = req.user?.userId
    console.log(req.file);
	const result =  await userServices.uploadProfileImage(req.file.buffer,userId as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `Profile image uploaded successfully`,
		data: result
	});
});

export const userController = {
    uploadProfileImage,
}