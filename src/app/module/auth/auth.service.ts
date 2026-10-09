import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { TokenPayload } from "google-auth-library";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterPatientPayload,
	IRequestUser,
	IResetPasswordPayload,
} from "./auth.interface";
import { redisClient } from "../../lib/redis";
import { transporter } from "../../lib/nodemailer";
import ejs from "ejs";
import path from "path";

const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password } = payload;

	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, 8);

	const createdUser = await prisma.user.create({
		data: {
			name,
			email,
			password: hashedPassword,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: false,
			patient: {
				create: { name, email },
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	const { patient, ...user } = createdUser;
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		patient,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new Error("User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new Error(
			"User Already has account register with google. Try to login with Google.",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new Error("Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			patient: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new Error("User not found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new Error(
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new Error("User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;
	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});
		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("Google ID Token verification failed", error);
		throw new Error("Invalid or Expire Google Id Token");
	}

	if (!googleIdTokenPayload) {
		throw new Error("Invalid or Expire Google Id Token");
	}

	if (!googleIdTokenPayload.email) {
		throw new Error("Google Email is not found");
	}
	if (!googleIdTokenPayload.name) {
		throw new Error("Google Name is not found");
	}

	const ifPatientExist = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.PATIENT,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifPatientExist;

	if (!ifPatientExist) {
		const ifPatientExistWithCredentials = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.PATIENT,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (ifPatientExistWithCredentials) {
			if (!ifPatientExistWithCredentials.emailVerified) {
				throw new Error("Email Not verified");
			}
			if (ifPatientExistWithCredentials.status === UserStatus.BLOCKED) {
				throw new Error("User is BLOCKED");
			}
			if (
				ifPatientExistWithCredentials.isDeleted ||
				ifPatientExistWithCredentials.status === UserStatus.DELETED
			) {
				throw new Error("User is deleted");
			}

			user = await prisma.user.update({
				where: {
					id: ifPatientExistWithCredentials.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.PATIENT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					patient: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});
		}
	}

	if (!user) {
		throw new Error("User Not Found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is BLOCKED");
	}
	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async(payload:IForgotPasswordPayload) => {
	const {email} = payload;

	const isUserExist = await prisma.user.findUnique({
		where : {
			email
		}
	});

	if(!isUserExist){
		throw new Error("User Does not Exist!")
	};
	if(!isUserExist.emailVerified){
		throw new Error("User not verified")
	};
	if(isUserExist.status === "BLOCKED"){
		throw new Error("User is Blocked")
	};
	if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
		throw new Error("User is Deleted");
	};
	if(isUserExist.googleId && isUserExist.authProvider === "GOOGLE"){
		throw new Error("User has account with google");
	};

	const otp = crypto.randomInt(100000,1000000).toString();

	const key = `forgot-password-otp:${isUserExist.email}`

	const expirationSeconds = 5*60

	await redisClient.set(key, otp , {
		expiration:{
			type : "EX",
			value : expirationSeconds
		}
	})

	const templatePath = path.join(process.cwd(), "src/app/templates/forgot-password.ejs");

	const html = await ejs.renderFile(templatePath,{
		name : isUserExist.name,
		otp,
		expirationMin : expirationSeconds/60,
		brandName: "PH Healthcare",
	})

	await transporter.sendMail({
		from : config.email_sender,
		to : isUserExist.email,
		subject : "Forgot Password",
		// text : `Your OTP is ${otp}`
		html
	})

}

const resetPassword = async(payload:IResetPasswordPayload) => {
	const {email, otp, newPassword} = payload;

	const isUserExist = await prisma.user.findUnique({
		where : {
			email
		}
	});

	if(!isUserExist){
		throw new Error("User Does not Exist!")
	};
	if(!isUserExist.emailVerified){
		throw new Error("User not verified")
	};
	if(isUserExist.status === "BLOCKED"){
		throw new Error("User is Blocked")
	};
	if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
		throw new Error("User is Deleted");
	};
	if(isUserExist.googleId && isUserExist.authProvider === "GOOGLE"){
		throw new Error("User has account with google");
	};

	const key = `forgot-password-otp:${isUserExist.email}`

	const redisOtp = await redisClient.get(key);

	if(!redisOtp){
		throw new Error("Invalid OTP")
	}

	if(redisOtp !== otp){
		throw new Error("OTP does not match")
	};

	const hashedNewPassword = await bcrypt.hash(newPassword,Number(config.bcrypt_salt_rounds));

	await prisma.user.update({
		where : {
			email : isUserExist.email
		},
		data : {
			password : hashedNewPassword
		}
	})

	await redisClient.del([key]);

	const templatePath = path.join(process.cwd(), "src/app/templates/reset-password-success.ejs");

	const html = await ejs.renderFile(templatePath,{
		name : isUserExist.name,
		brandName: "PH Healthcare",
	})

	await transporter.sendMail({
		from : config.email_sender,
		to : isUserExist.email,
		subject : "Your password has been reset successfully.",
		// text : `Your OTP is ${otp}`
		html
	})
}

export const AuthService = {
	registerPatient,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
