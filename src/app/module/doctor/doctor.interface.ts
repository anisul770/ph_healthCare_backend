import { DoctorVerificationStatus } from "../../../generated/prisma/enums";

export interface IVerifyDoctorEmailPayload {
    email : string;
    otp : string;
}

export interface IApproveDoctorPayload {
    doctorId: string;
    verificationStatus: DoctorVerificationStatus;
    rejectionReason: string;
}