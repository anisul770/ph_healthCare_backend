import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma"
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import { DoctorVerificationStatus, Role, ScheduleStatus } from "../../../generated/prisma/enums";
import crypto from "crypto";
import { TApplyAsDoctorPayload } from "./doctor.validation";
import { redisClient } from "../../lib/redis";
import path from "path";
import { transporter } from "../../lib/nodemailer";
import ejs from "ejs";
import { IUpdateDoctorProfilePayload, IVerifyDoctorEmailPayload } from "./doctor.interface";
import { RequestUser } from "../../middleware/checkAuth";
import { IQuery } from "../../interfaces";
import { DoctorWhereInput } from "../../../generated/prisma/models";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { addDays, startOfDay } from "date-fns";

const applyAsDoctor = async(
    payload:TApplyAsDoctorPayload,
    resume:Express.Multer.File | null, 
    additionalFiles : Express.Multer.File[])=> {

        const isUserExist = await prisma.user.findUnique({
            where : {
                email : payload.user.email,
            }
        });

        if(isUserExist){
            throw new AppError(httpStatus.CONFLICT, "User already exists with this email");
        };

        const resumeUploadResult = await new Promise<UploadApiResponse>((resolve,reject)=>{
                cloudinary.uploader.upload_stream(
              {
                resource_type : "auto",
              },
              async (error,result) => {
                if(error){
                    return reject(error);
                }      
                if(!result){
                    return reject(new Error("No result returned from Cloudinary."));
                } 
                resolve(result); 
              }
            ).end(resume?.buffer);
        });

        const additionalFilesUploadResults = await Promise.all(
            additionalFiles.map((file) => {
                return new Promise<UploadApiResponse>((resolve,reject)=>{
                    cloudinary.uploader.upload_stream(
                    {
                        resource_type : "auto",
                    },
                    async (error,result) => {
                        if(error){
                            return reject(error);
                        }      
                        if(!result){
                            return reject(new Error("No result returned from Cloudinary."));
                        } 
                        resolve(result); 
                    }
                    ).end(file.buffer);
                });
            })
        );

        const randomDoctorPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(randomDoctorPassword, Number(config.bcrypt_salt_rounds));

        const doctorApplication = await prisma.user.create({
            data : {
                ...payload.user,
                password : hashedPassword,
                role : Role.DOCTOR,
                doctor : {
                    create : {
                        name : payload.user.name,
                        email : payload.user.email,
                        ...payload.doctor,
                        resume : resumeUploadResult.secure_url,
                        resumePublicId : resumeUploadResult.public_id,
                        additionalFiles : additionalFilesUploadResults.map((file)=>({
                            url : file.secure_url,
                            publicId : file.public_id
                        }))
                    }
                }
            },
            include : {
                doctor : true
            }
        });

        const expirationSeconds = 60*60;

        const otpKey = `doctor-application-otp:${payload.user.email}`;
        const otpValue = crypto.randomInt(100000,1000000).toString();

        await redisClient.set(otpKey,otpValue,{
            expiration : {
                type : "EX",
                value : expirationSeconds
            }
        });

        const templatePath = path.join(
            process.cwd(),"src/app/templates/email-verification-otp.ejs"
        )

        const templateData = {
            name : payload.user.name,
            otp : otpValue,
            expirationMin : expirationSeconds / 60,
            brandName : "PH Healthcare"
        }
        const html = await ejs.renderFile(templatePath,templateData)
    
        await transporter.sendMail({
            from : config.email_sender,
            to : payload.user.email,
            subject : "Email verification",
            // text : `Your OTP is ${otp}`
            html
        })
        return doctorApplication;
}

const verifyDoctorEmail = async(payload:IVerifyDoctorEmailPayload) => {
    const otp = payload.otp
    const email = payload.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
        where : {
            email,
            role : Role.DOCTOR
        }
    });
    if(!existingUser){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Application not Found. Please apply Again.")
    };

    if(existingUser.emailVerified){
        throw new AppError(httpStatus.BAD_REQUEST, "Email already verified!!");
    }

    const otpKey = `doctor-application-otp:${email}`;

    const redisOtp = await redisClient.get(otpKey);

    if(!redisOtp){
        throw new AppError(httpStatus.BAD_REQUEST, "OTP Expired. Your application window has closed, please apply again. ");
    };
    if(redisOtp !== otp){
        throw new AppError(httpStatus.BAD_REQUEST, "OTP Does not match");
    }

    await redisClient.del([otpKey]);

    const verifiedUser = await prisma.user.update({
        where : { id : existingUser.id},
        data : { emailVerified :true},
        omit : { password  : true},
        include : { doctor : true}
    });

    return verifiedUser;
}

const approveDoctor = async(payload : any,reviewer: RequestUser) => {
    const {doctorId, verificationStatus, rejectionReason } = payload;

    const existingDoctor = await prisma.doctor.findUnique({
        where : {id : doctorId},
        include : {user : true}
    });
    if(!existingDoctor){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Application not found");
    };

    if(existingDoctor.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor application has been deleted");
    };

    if(!existingDoctor.user.emailVerified){
        throw new AppError(httpStatus.BAD_REQUEST, "Doctor has not verified their Email Yet. Application cannot be reviewed.")
    };
    if(existingDoctor.verificationStatus !== DoctorVerificationStatus.PENDING){
        throw new AppError(httpStatus.BAD_REQUEST, `Doctor Application has already been ${existingDoctor.verificationStatus.toLowerCase()}`)
    };

    if(verificationStatus === DoctorVerificationStatus.REJECTED && !rejectionReason){
        throw new AppError(httpStatus.BAD_REQUEST, "Rejection reason is required when rejecting a doctor application");
    }

    const updatedDoctor = await prisma.doctor.update({
        where : { id : doctorId},
        data : {
            verificationStatus,
            rejectionReason : verificationStatus === DoctorVerificationStatus.REJECTED ? rejectionReason : null,
            reviewedBy : reviewer.userId,
            reviewedAt : new Date()
        }
    });

    const isApproved = verificationStatus === DoctorVerificationStatus.APPROVED;

    const templatePath = path.join(
        process.cwd(),`src/app/templates/${isApproved ?  "doctor-application-approved.ejs" : "doctor-application-rejected.ejs" }`
    )

    const templateData = {
        name : updatedDoctor.name,
        reason : updatedDoctor.rejectionReason,
        brandName : "PH Healthcare"
    }
    const html = await ejs.renderFile(templatePath,templateData)

    await transporter.sendMail({
        from : config.email_sender,
        to : updatedDoctor.email,
        subject : isApproved
            ? "Your doctor application has been approved"
            : "Update on your doctor application",
        // text : `Your OTP is ${otp}`
        html
    });

    return updatedDoctor

}

const getAllDoctors = async(query : IQuery)=>{

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc"

    const andConditions : DoctorWhereInput[] = [];

    // seraching
    if(query.searchTerm) {
        andConditions.push({
            OR : [
                { name : {contains : query.searchTerm, mode : "insensitive"}},
                {email : {contains : query.searchTerm, mode : "insensitive"}},
                { specialization : { contains : query.searchTerm , mode : "insensitive"}},
                {licenseNumber : {contains : query.searchTerm, mode : "insensitive"}}
            ]
        })
    };

    // filtering
    if(query.specialization){
        andConditions.push({
            specialization : {equals : query.specialization, mode: "insensitive"}
        });
    }
    if(query.email){
        andConditions.push({
            email : {contains : query.email, mode:"insensitive"}
        });
    }
    if(query.licenseNumber){
        andConditions.push({
            licenseNumber : {contains : query.licenseNumber , mode: "insensitive"}
        });
    }
    if(query.verificationStatus){
        andConditions.push({
            verificationStatus : query.verificationStaus as DoctorVerificationStatus,
        });
    }

    // if(query.isDeleted){
    //     andConditions.push({isDeleted : query.isDeleted === "true" ? true : false});
    // }
    andConditions.push({isDeleted : false})

    // search,filter,pagination 
    const allDoctors = await prisma.doctor.findMany({
        where : {
            AND : andConditions.length > 0 ? andConditions : undefined
        },
        take : limit,
        skip : skip,
        orderBy : {
            [sortBy] : sortBy
        },
        include : {
            user : {
                omit : {
                    password : true
                }
            },
            //  schedule : true,
            //  appintments : true,
            // prescription : true,
        }
    });

    const totalDoctorCount = await prisma.doctor.count({
        where : {
            AND : andConditions
        }
    })

    return {
        data : allDoctors,
        meta: {
            page: page,
            limit : limit,
            total : totalDoctorCount,
            totalPages: Math.ceil(totalDoctorCount/limit)
        }
    }
}

const updateDoctorProfile = async(payload:IUpdateDoctorProfilePayload,user:RequestUser) => {
    const existingDoctor = await prisma.doctor.findUnique({
        where : { userId : user.userId}
    });
    if(!existingDoctor){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor profile not found!");
    }

    const updatedDoctor = await prisma.doctor.update({
        where : { id : existingDoctor.id},
        data : payload
    })
}

const getAvailableDoctorByTodaysSchedule = async (query: IQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const now = new Date();
	const startOfToday = startOfDay(now);
	const startOfTomorrow = addDays(startOfToday, 1);

	// A doctor is "available today" if they have at least one published,
	// not-yet-started schedule today with open slots left.

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ verificationStatus: DoctorVerificationStatus.APPROVED },
		{
			schedules: {
				some: {
					isDeleted: false,
					status: ScheduleStatus.PUBLISHED,
					availableSlots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				} } },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const availableDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consulationFee: true,
			createdAt: true,
			schedules: {
				where: {
					isDeleted: false,
					status: ScheduleStatus.PUBLISHED,
					availableSlots: { gt: 0 },
					startDateTime: {
						gte: startOfToday,
						lt: startOfTomorrow,
						gt: now,
					},
				},
				orderBy: { [sortBy] : sortOrder },
				select: {
					id: true,
					startDateTime: true,
					endDateTime: true,
					availableSlots: true,
					totalSlot: true,
				},
			},
		},
	});

	const totalAvailableDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: availableDoctors,
		meta: {
			page,
			limit,
			total: totalAvailableDoctorCount,
			totalPages: Math.ceil(totalAvailableDoctorCount / limit),
		},
	};
}

const getAllDoctorsListPublic = async (query: IQuery) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const andConditions: DoctorWhereInput[] = [
		{ isDeleted: false },
		{ verificationStatus: DoctorVerificationStatus.APPROVED },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ specialization: { contains: query.searchTerm, mode: "insensitive" } },
				{ qualifications: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	const allDoctors = await prisma.doctor.findMany({
		where: {
			AND: andConditions,
		},

		take: limit,
		skip,

		orderBy: {
			[sortBy]: sortOrder,
		},

		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consulationFee: true,
			createdAt: true,
		},
	});

	const totalDoctorCount = await prisma.doctor.count({
		where: { AND: andConditions },
	});

	return {
		data: allDoctors,
		meta: {
			page,
			limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit),
		},
	};
}

const getSingleDoctorPublicProfile = async (doctorId: string) => {

	const doctor = await prisma.doctor.findUnique({
		where: {
			id: doctorId,
			isDeleted: false,
			verificationStatus: DoctorVerificationStatus.APPROVED,
		},
		select: {
			id: true,
			name: true,
			specialization: true,
			licenseNumber: true,
			qualifications: true,
			experienceYears: true,
			bio: true,
			consultationFee: true,
			createdAt: true,
		},
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Not Found");
	}

	return doctor;
}


export const DoctorServices = {
    applyAsDoctor,
    verifyDoctorEmail,
    approveDoctor,
    getAllDoctors,
    updateDoctorProfile,
    getAllDoctorsListPublic,
    getAvailableDoctorByTodaysSchedule,
    getSingleDoctorPublicProfile
}