import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";
import { sendResponse } from "../../utils/sendResponse";
import { DoctorServices } from "./doctor.service";
import { applyAsDoctorValidationSchema } from "./doctor.validation";
import { RequestUser } from "../../middleware/checkAuth";

const applyAsDoctor = catchAsync(async (req: Request, res: Response) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
	console.log({ files });
	const resume = files?.["resume"] ? files["resume"][0] : null;
	const additionalFiles = files?.["additionalFiles"] || [];

    // const data = JSON.parse(req.body.data)

    const zodValidationResult = applyAsDoctorValidationSchema.safeParse(JSON.parse(req.body.data));

    if(!zodValidationResult.success){
        console.log(zodValidationResult.error);
        throw new AppError(httpStatus.BAD_REQUEST, `${zodValidationResult.error.issues[0].path[1].toString()} field ${zodValidationResult.error.issues[0].message}`)
    }

    const payload = zodValidationResult.data

	const result = await DoctorServices.applyAsDoctor(payload,resume,additionalFiles);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Apply as doctor successfully",
		data: result,
	});
});

const verifyDoctorEmail = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body;

	const result = await DoctorServices.verifyDoctorEmail(payload);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor Email verify successfully",
		data: result,
	});
});

const approveDoctor = catchAsync(async (req: Request, res: Response) => {
    const payload = req.body;  

	const result = await DoctorServices.approveDoctor(payload,req.user as RequestUser);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor approved successfully",
		data: result,
	});
});

const getAllDoctors = catchAsync(async (req: Request, res: Response) => {
	const {data, meta} = await DoctorServices.getAllDoctors(req.query);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor Retrieved successfully",
		data: data,
		meta : meta
	});
});

const updateDoctorProfile = catchAsync(
	async (req: Request, res: Response) => {
		const payload = req.body;
		const user = req.user!;

		const result = await DoctorServices.updateDoctorProfile(payload, user);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Doctor Profile Updated Successfully",
			data: result,
		});
	},
);

const getAvailableDoctorByTodaysSchedule = catchAsync(
	async (req: Request, res: Response) => {
	

		const { data, meta } = await DoctorServices.getAvailableDoctorByTodaysSchedule(
			req.query
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Today's Available Doctors Retrieved Successfully",
			data,
			meta,
		});
	},
);

const getAllDoctorsListPublic = catchAsync(async (req: Request, res: Response) => {


	const { data, meta } = await DoctorServices.getAllDoctorsListPublic(
		req.query
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctors Retrieved Successfully",
		data,
		meta,
	});
});

const getSingleDoctorPublicProfile = catchAsync(
	async (req: Request, res: Response) => {

		const doctorId = req.params.doctorId as string
		
		const result = await DoctorServices.getSingleDoctorPublicProfile(
			doctorId
		);
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Doctor Profile Retrieved Successfully",
			data: result,
		});
	},
);



export const DoctorController = {
    applyAsDoctor,  
    verifyDoctorEmail,
    approveDoctor,
	getAllDoctors,
	updateDoctorProfile,
	getAvailableDoctorByTodaysSchedule,
	getAllDoctorsListPublic,
	getSingleDoctorPublicProfile,
}