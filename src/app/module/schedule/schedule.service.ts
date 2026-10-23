import { addDays, differenceInMinutes, isAfter, isSameDay, startOfDay } from "date-fns"
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/AppError"
import { ICreateSchedulePayload, IUpdateSchedulePayload } from "./schedule.interface"
import httpStatus  from "http-status"
import { IQuery } from "../../interfaces"
import { ScheduleWhereInput } from "../../../generated/prisma/models"
import { ScheduleStatus } from "../../../generated/prisma/enums"

const createSchedule = async(payload : ICreateSchedulePayload,user: RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId},
    });

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor profile not found");
    };

    if(!isSameDay(payload.startDateTime, payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date time and end date time has to be on the same day.");  
    }
    if(isAfter(payload.startDateTime, payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date time cannot be after end date time.");  
    }

    const startOfTheDay = startOfDay(payload.startDateTime) // 25 August => 12:00 AM
    const startOfNextDay = addDays(startOfTheDay,1) // 26 August => 12:00 AM

    const existingScheduleOnThisDate = await prisma.schedule.findFirst({
        where : {
            doctorId : doctor.id,
            isDeleted : false,
            startDateTime : {
                gte : startOfTheDay,
                lt : startOfNextDay
            }
        }
    });
    
    if(existingScheduleOnThisDate){
        throw new AppError(httpStatus.CONFLICT, " You already have a schedule for this date")
    }

    const durationInMinutes = differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    );

    const MINUTES_ALLOCATED_PER_SLOT = 20

    const totalSlot = Math.floor(durationInMinutes/MINUTES_ALLOCATED_PER_SLOT);

    const schedule = await prisma.schedule.create({
        data : {
            startDateTime : payload.startDateTime,
            endDateTime : payload.endDateTime,
            meetingLink : payload.meetingLink,
            totalSlot,
            availableSlots : totalSlot,
            doctorId : doctor.id
        },
        include : {
            doctor : {
                select : {
                    name : true,
                    email : true,
                    contactNumber : true
                }
            }
        }
    });
    return schedule

}

const getMySchedules = async(query: IQuery, user: RequestUser) => {
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";


    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId},
    });

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor profile not found");
    };

    // let limit = 10;
    // if(query.limit){
    //     limit = Number(query.limit);
    // }

    // let page = 1;
    // if(query.page){
    //     page = Number(query.page);
    // }

    // const skip = (page -1) * limit;

    const andConditions : ScheduleWhereInput[] = [
        {
            doctorId : doctor.id
        },
        {
            isDeleted : false
        }
    ];

    if(query.status) {
        andConditions.push({ status : query.status});
    };

    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },
        take : limit,
        skip,
        orderBy : {
            // startDateTime : "desc"
            [sortBy] : sortOrder
        },
        include : {
            appointments : {
                include : {
                    patient : true
                }
            }
        }
    });

    const total = await prisma.schedule.count({
        where : { AND : andConditions}
    })

    return {
        data : schedules,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }
}

const getAllSchedules = async(query : IQuery) => {
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const andConditions : ScheduleWhereInput[] = [];

    if(query.doctorId){
        andConditions.push({doctorId : query.doctorId})
    };
    if(query.email){
        andConditions.push({doctor : {email : query.email}})
    };
    if(query.status){
        andConditions.push({status : query.status});
    };
    // seraching
    if(query.searchTerm) {
        andConditions.push({
            doctor : {
                OR : [
                    { name : {contains : query.searchTerm, mode : "insensitive"}},
                    {email : {contains : query.searchTerm, mode : "insensitive"}},
                    { specialization : { contains : query.searchTerm , mode : "insensitive"}},
                    {licenseNumber : {contains : query.searchTerm, mode : "insensitive"}}
                ],
            },
        })
    }; 

    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },
        take : limit,
        skip,
        orderBy : {
            // startDateTime : "desc"
            [sortBy] : sortOrder
        },
        include : {
            appointments : {
                include : {
                    patient : true
                }
            }
        }
    });

    const total = await prisma.schedule.count({
        where : { AND : andConditions}
    })

    return {
        data : schedules,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }
};

const getScheduleById = async(scheduleId : string) => {
    const schedule = await prisma.schedule.findUnique({
        where : { id : scheduleId},
        include : {
            doctor : {
                select : {
                    id : true,
                    name : true,
                    email : true,
                    specialization : true,
                    userId : true
                }
            },
            appointments : {
                include : {
                    patient : true,
                },
            }
        }
    });

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND, "Schedule not found");
    }

    return schedule
}

const updateSchedule = async(scheduleId : string, payload : IUpdateSchedulePayload,user: RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId}
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found");
    }

        const schedule = await prisma.schedule.findUnique({
            where : { id : scheduleId, doctorId : doctor.id }
        });

        if(!schedule || schedule.isDeleted){
            throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found");
        };
    if(schedule.status === ScheduleStatus.PUBLISHED && schedule.totalSlot !== schedule.availableSlots){
        throw new AppError(httpStatus.CONFLICT,"Once Published cannot be updated");
    }


    // const updateData : IUpdateSchedulePayload = {};
    // if(payload.meetingLink){
    //     updateData.meetingLink = payload.meetingLink || schedule.meetingLink
    // }

    payload.meetingLink = payload.meetingLink || schedule.meetingLink;
    payload.startDateTime = payload.startDateTime || schedule.startDateTime;
    payload.endDateTime = payload.endDateTime || schedule.endDateTime;

    if(!isSameDay(payload.startDateTime, payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date time and end date time has to be on the same day.");  
    }
    if(isAfter(payload.startDateTime, payload.endDateTime)){
        throw new AppError(httpStatus.CONFLICT,"Start Date time cannot be after end date time.");  
    }

    const startOfTheDay = startOfDay(payload.startDateTime) // 25 August => 12:00 AM
    const startOfNextDay = addDays(startOfTheDay,1) // 26 August => 12:00 AM

    const existingScheduleOnThisDate = await prisma.schedule.findFirst({
        where : {
            doctorId : doctor.id,
            isDeleted : false,
            startDateTime : {
                gte : startOfTheDay,
                lt : startOfNextDay
            }
        }
    });
    
    if(existingScheduleOnThisDate){
        throw new AppError(httpStatus.CONFLICT, " You already have a schedule for this date")
    }
    
    const durationInMinutes = differenceInMinutes(
        payload.startDateTime,
        payload.endDateTime
    );

    const MINUTES_ALLOCATED_PER_SLOT = 20

    const totalSlot = Math.floor(durationInMinutes/MINUTES_ALLOCATED_PER_SLOT);

    const updatedSchedule = await prisma.schedule.update({
        where : {
            id : schedule.id
        },
        data : {
            startDateTime : payload.startDateTime,
            endDateTime : payload.endDateTime,
            meetingLink : payload.meetingLink,
            totalSlot,
            availableSlots : totalSlot,
            doctorId : doctor.id
        },
        include : {
            doctor : {
                select : {
                    name : true,
                    email : true,
                    contactNumber : true
                }
            }
        }
    });

    return updatedSchedule

}

const publishSchedule = async(scheduleId:string,user:RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId}
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found");
    }

    const schedule = await prisma.schedule.findUnique({
        where : { id : scheduleId, doctorId : doctor.id }
    });

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found");
    };

    if(schedule.status === "PUBLISHED"){
        throw new AppError(httpStatus.CONFLICT, "Schedule is already Published");
    }

    const publishSchedule = await prisma.schedule.update({
        where: {
            id : schedule.id
        },
        data :{
            status : ScheduleStatus.PUBLISHED
        }
    })

    return publishSchedule;
}

const deleteSchedule = async(scheduleId:string,user:RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId}
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found");
    }

    const schedule = await prisma.schedule.findUnique({
        where : { id : scheduleId, doctorId : doctor.id }
    });

    if(!schedule || schedule.isDeleted){
        throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found");
    };

    if(schedule.status === ScheduleStatus.PUBLISHED && schedule.totalSlot !== schedule.availableSlots){
        throw new AppError(httpStatus.CONFLICT,"Once Published cannot be updated");
    };

    return deleteSchedule;
}

const getTodaysSchedule = async(query: IQuery) => {
    if(!query.doctorId){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Id Must be provided in query")
    };

    const doctor = await prisma.doctor.findUnique({
        where : { id : query.doctorId}
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile Not Found");
    };

    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const now = new Date();
    const startOfToday = startOfDay(now);
    const startOfTomorrow = addDays(startOfToday,1);

    const andConditions : ScheduleWhereInput[] = [
        {
            doctorId : query.doctorId
        },
        {
            isDeleted : false
        },
        {
            status : ScheduleStatus.PUBLISHED
        },
        {
            startDateTime : {
                gte : startOfToday,
                lt : startOfTomorrow,
                gt : now
            }
        },
        {
            availableSlots : { gt : 0 }
        }
    ];

    const schedules = await prisma.schedule.findMany({
        where : {
            AND : andConditions
        },
        take : limit,
        skip,
        orderBy : {
            // startDateTime : "desc"
            [sortBy] : sortOrder
        }
    });

    const total = await prisma.schedule.count({
        where : { AND : andConditions}
    })

    return {
        data : schedules,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }

}

export const ScheduleServices = {
    createSchedule,
    getMySchedules,
    getAllSchedules,
    getScheduleById,
    updateSchedule,
    publishSchedule,
    deleteSchedule,
    getTodaysSchedule
}