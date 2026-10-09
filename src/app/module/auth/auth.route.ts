import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import {  UserValidation } from "./auth.validation";

const router = Router();

router.post("/register",
	// (req:Request,res:Response,next:NextFunction)=>{
	// 		// const payload = req.body ? req.body : {}
	// 	const payload = req.body ?? {}
	// 	const result = PatientValidation.PatientRegistrationZodSchema.safeParse(payload)
	// 	if (!result.success) {
	// 	// let errorMessage = "";
	// 	// payload.error.issues.forEach((issue) => {
	// 	// 	errorMessage = errorMessage + "\n" + issue.message;
	// 	// });
	// 	throw new Error(payload.error.issues[0].message);
	// }

	// req.body = result.data

	// next()
		
	// }, 

	validateRequest(UserValidation.PatientRegistrationZodSchema),
	AuthController.registerPatient);
router.post("/login",validateRequest(UserValidation.LoginZodSchema), AuthController.loginUser);
router.get(
	"/me",
	auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
	AuthController.getMe,
);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/google", AuthController.googleLogin);
router.post("/forgot-password",validateRequest(UserValidation.ForgotPasswordZodSchema) ,AuthController.forgotPassword);
router.post("/reset-password",validateRequest(UserValidation.ResetPasswordZodSchema) ,AuthController.resetPassword);

export const AuthRoutes = router;
