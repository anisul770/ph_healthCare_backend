import httpStatus from "http-status"
import { AppointmentStatus, DoctorVerificationStatus, PaymentStatus, ScheduleStatus } from "../../../generated/prisma/enums"
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/AppError"

const getAdminAnalytics = async() => {
    // total doctors
    const totalDoctors = await prisma.doctor.count({
        where :{
            isDeleted :false
        }
    })
    const totalPendingDoctorsApplciation = await prisma.doctor.count({
        where :{
            isDeleted :false,
            verificationStatus : DoctorVerificationStatus.PENDING 
        }
    })
    const totalApprovedDoctors = await prisma.doctor.count({
        where :{
            isDeleted :false,
            verificationStatus : DoctorVerificationStatus.APPROVED
        }
    })
    const totalRejectedDoctors = await prisma.doctor.count({
        where :{
            isDeleted :false,
            verificationStatus : DoctorVerificationStatus.REJECTED
        }
    })

    // patient 
    const totalPatient = await prisma.patient.count({
        where :{isDeleted : false}
    })

    // appointments
    const totalAppointments = await prisma.appointment.count();

    const totalCompletedAppointments = await prisma.appointment.count({
        where : {status : AppointmentStatus.COMPLETED}
    })
    const totalCancelledAppointments = await prisma.appointment.count({
        where : {status : AppointmentStatus.CANCELLED}
    });

    const totalRevenueResult = await prisma.payment.aggregate({
        where : {
            status : PaymentStatus.PAID
        },
        _sum : { amount : true}
    })

    const totalRevenue = totalRevenueResult._sum.amount?.toNumber() || 0;

    const totalRefundResult = await prisma.payment.aggregate({
        where : {
            status : PaymentStatus.REFUNDED
        },
        _sum : { amount : true}
    })

    const totalRefund = totalRefundResult._sum.amount?.toNumber() || 0;
    const totalProfit  = totalRevenue - totalRefund;

    return{
        totalDoctors,
        totalApprovedDoctors,
        totalPendingDoctorsApplciation,
        totalRejectedDoctors,
        totalAppointments,
        totalPatient,
        totalCompletedAppointments,
        totalCancelledAppointments,
        totalRevenue,
        totalRefund,
        totalProfit
    }
}

const getPatientAnalytics = async(user:RequestUser) => {
    const patient = await prisma.patient.findUnique({
        where: { id : user.userId }
    });
    if(!patient){
        throw new AppError(httpStatus.NOT_FOUND,"Patient not found!");
    };

    const totalAppointments = await prisma.appointment.count({
        where : { patientId : patient.id}
    });

    const upcomingAppointments = await prisma.appointment.count({
        where : {patientId : patient.id, status : AppointmentStatus.CONFIRMED}
    });

    const completedAppointments = await prisma.appointment.count({
        where : { patientId : patient.id , status : AppointmentStatus.COMPLETED}
    });

    const cancelledAppointments = await prisma.appointment.count({
        where : { patientId : patient.id , status : AppointmentStatus.CANCELLED}
    });

    const totalAmountSpentResult = await prisma.payment.aggregate({
        where : { 
            appointment :{
                patientId : patient.id
            },
            status : PaymentStatus.PAID
        },
        _sum : {
            amount : true
        }
    });

    const totalAmountSpent = totalAmountSpentResult._sum.amount?.toNumber() || 0
    const totalAmountRefundedResult = await prisma.payment.aggregate({
        where : { 
            appointment :{
                patientId : patient.id
            },
            status : PaymentStatus.REFUNDED
        },
        _sum : {
            amount : true
        }
    });

    const totalAmountRefunded = totalAmountRefundedResult._sum.amount?.toNumber() || 0

    return {
        totalAppointments,
        upcomingAppointments,
        completedAppointments,
        cancelledAppointments,
        totalAmountSpent,
        totalAmountRefunded
    }


}

const getDoctorAnalytics = async(user : RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where: { userId : user.userId }
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor not found!");
    };

    const totalSchedules = await prisma.schedule.count({
        where : { doctorId : doctor.id ,isDeleted : false}
    });

    const publishedSchedule = await prisma.schedule.count({
        where : {doctorId : doctor.id, status : ScheduleStatus.PUBLISHED}
    });

    const totalAppointments = await prisma.appointment.count({
        where : { doctorId : doctor.id}
    });

    const upcomingAppointments = await prisma.appointment.count({
        where : {doctorId : doctor.id, status : AppointmentStatus.CONFIRMED}
    });

    const ongoingAppointments = await prisma.appointment.count({
        where : {doctorId : doctor.id, status : AppointmentStatus.ONGOING}
    });

    const completedAppointments = await prisma.appointment.count({
        where : { doctorId : doctor.id , status : AppointmentStatus.COMPLETED}
    });

    const cancelledAppointments = await prisma.appointment.count({
        where : { doctorId : doctor.id , status : AppointmentStatus.CANCELLED}
    });

    const totalDoctorEarningResult = await prisma.payment.aggregate({
        where : {
            appointment : {
                doctorId : doctor.id
            },
            status : PaymentStatus.PAID
        },
        _sum : {
            amount : true
        }
    });

    const totalDoctorEarning = totalDoctorEarningResult._sum.amount?.toNumber() || 0;
    const totalDoctorRefundResult = await prisma.payment.aggregate({
        where : {
            appointment : {
                doctorId : doctor.id
            },
            status : PaymentStatus.REFUNDED
        },
        _sum : {
            amount : true
        }
    });

    const totalDoctorRefund = totalDoctorRefundResult._sum.amount?.toNumber() || 0;


    return {
        totalSchedules,
        publishedSchedule,
        totalAppointments,
        upcomingAppointments,
        ongoingAppointments,
        completedAppointments,
        cancelledAppointments,
        totalDoctorEarning,
        totalDoctorRefund
    }
}


export const AnalyticsServices = {
    getAdminAnalytics,
    getPatientAnalytics,
    getDoctorAnalytics
}