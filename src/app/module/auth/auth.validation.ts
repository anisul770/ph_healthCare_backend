import z from "zod";

const PatientRegistrationZodSchema = z.object({
	name: z
		.string("not a string!!!!!")
		.min(3, "Name must be at least 3 characters long")
		.max(15),
	email: z.email("Not email!!!"),
	password: z
		.string()
		.min(5, "Password must be 8 characters long")
		.regex(/[A-Z]/, { message: "Contain at least one uppercase letter" })
		.regex(/[a-z]/, { message: "Contain at least one lowercase letter" })
		.regex(/[0-9]/, { message: "Contain at least one number" })
		.regex(/[^A-Za-z0-9]/, {
			message: "Contain at least one special character",
		}),
	patient: z
		.object({
			contactNumber: z.string().optional(),
		})
		.optional(),
});

const LoginZodSchema = z.object({
    email : z.email(),
    password : z.string().min(5)
})

const ForgotPasswordZodSchema = z.object({
    email : z.email(),
})

const ResetPasswordZodSchema = z.object({
    email : z.email(),
    newPassword: z
		.string()
		.min(5, "Password must be 8 characters long")
		.regex(/[A-Z]/, { message: "Contain at least one uppercase letter" })
		.regex(/[a-z]/, { message: "Contain at least one lowercase letter" })
		.regex(/[0-9]/, { message: "Contain at least one number" })
		.regex(/[^A-Za-z0-9]/, {
			message: "Contain at least one special character",
		}),
	otp : z.string().length(6)
})

export const UserValidation = {
    PatientRegistrationZodSchema,
    LoginZodSchema,
	ForgotPasswordZodSchema,
	ResetPasswordZodSchema
}