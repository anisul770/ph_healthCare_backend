import { addMinutes, format, isBefore, isSameDay, subHours } from "date-fns";
import ejs from "ejs";
import httpStatus from "http-status";
import path from "path";
import PDFDocument from 'pdfkit';
import { AppointmentStatus, PaymentStatus, Role, ScheduleStatus } from "../../../generated/prisma/enums";
import config from "../../config"
import { IQuery } from "../../interfaces";
import { getBkashIdToken } from "../../lib/bkash"
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { IBookAppointmentPayload, ICancelAppointmentPayload, IPayAppointmentPayload, IUpdateAppointmentStatusPayload } from "./appointment.interface";
import { AppointmentWhereInput } from "../../../generated/prisma/models";

const bookAppointment = async(payload:IBookAppointmentPayload,user:RequestUser) => {


    const transactionResult = await prisma.$transaction(async(tx)=>{
        // business logic 

        const patient = await prisma.patient.findUnique({
            where : { userId : user.userId}
        });

        if(!patient){
            throw new AppError(httpStatus.NOT_FOUND,"Patient profile not found")
        }

        const schedule = await prisma.schedule.findUnique({
            where : { id : payload.scheduleId },
            include : {doctor : true}
        });

        if(!schedule || schedule.isDeleted){
            throw new AppError(httpStatus.NOT_FOUND,"Schedule Not Found");
        };

        if(schedule.status !== ScheduleStatus.PUBLISHED){
            throw new AppError(httpStatus.BAD_REQUEST,"This schedule is not Published yet");
        }

        const now  = new Date();

        if(!isSameDay(now,schedule.startDateTime)){
            throw new AppError(
                httpStatus.BAD_REQUEST,
                "This schedule is not Available Today"
            );
        };

        if(!isBefore(now,schedule.startDateTime)){
            throw new AppError(
                httpStatus.BAD_REQUEST,
                "This schedule has already Started"
            );
        };

        const existingAppointment =  await prisma.appointment.findFirst({
            where :{
                patientId : patient.id,
                scheduleId : schedule.id,
                // status : { not : AppointmentStatus.CANCELLED }
            }
        });

        if(existingAppointment?.status === AppointmentStatus.PENDING){
            throw new AppError(httpStatus.BAD_REQUEST,"You already have a Pending apppointment.")
        };

        if(existingAppointment?.status === AppointmentStatus.CONFIRMED){
            throw new AppError(httpStatus.BAD_REQUEST,"You already have a confirmed apppointment.")
        };

        if(existingAppointment?.status === AppointmentStatus.ONGOING){
            throw new AppError(httpStatus.BAD_REQUEST,"You already have an Ongoing apppointment.")
        }

        if(existingAppointment?.status === AppointmentStatus.COMPLETED){
            throw new AppError(httpStatus.BAD_REQUEST,"You already have Completed an apppointment today. Please try again another day.")
        }

        if(schedule.availableSlots === 0) {
            throw new AppError(httpStatus.BAD_REQUEST,"This schedule is fully booked")
        }

        if(!schedule.doctor.consulationFee){
            throw new AppError(
                httpStatus.BAD_REQUEST,
                "Doctor has not set a consulation Fee yet"
            )
        }

        const amount = schedule.doctor.consulationFee.toString();

        const appointment = await tx.appointment.create({
            data:{
                status : AppointmentStatus.PENDING,
                patientId : patient.id,
                doctorId : schedule.doctor.id,
                scheduleId : schedule.id,
            }
        })

        const bkashIdToken = await getBkashIdToken();

        if(!bkashIdToken){
            throw new AppError(httpStatus.BAD_GATEWAY, "No bkash Id token Found!")
        }

        const bkashCratePayment = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`,{
            method: "POST",
            headers : {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization : bkashIdToken,
                "X-App-Key" : config.bkash_app_key
            },
            body : JSON.stringify({  
            // agreementID:'TokenizedMerchant01L3IKB6H1565072174986', // apppointment ID
            mode: "0011",
            payerReference: user.email, // user email or phone number
            callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
            // merchantAssociationInfo: "MI05MID54RF09123456One",
            amount: amount,
            currency: "BDT",
            intent: "sale",
            merchantInvoiceNumber: appointment.id
            })
        })   

        const bkashCreatePaymentResult = await bkashCratePayment.json();

        //payment model create
        await tx.payment.create({
            data : {
                merchantInvoiceNumber : bkashCreatePaymentResult.merchantInvoiceNumber,
                appointmentId : appointment.id,
                amount : amount,
                gatewayResponse : bkashCreatePaymentResult,
                bkashPaymentId : bkashCreatePaymentResult.paymentID,
                payerReference : user.email
            }
        })

        return {
            paymentUrl : bkashCreatePaymentResult.bkashURL
        }
    })
    return transactionResult;
}

const payAppointment = async(payload:IPayAppointmentPayload, user:RequestUser) => {
    const appointmentId = payload.appointmentId;
    const existingAppointment = await prisma.appointment.findUnique({
        where : {
            id : appointmentId
        },
        include: {
            schedule : {
                include : {
                    doctor : true
                }
            }
        }
    });
    if(!existingAppointment){
        throw new AppError(httpStatus.NOT_FOUND, "Appointment does not exist");
    }
    if(existingAppointment.status!=="PENDING"){
        throw new AppError(httpStatus.BAD_REQUEST, "Appointment already paid and confirmed");
    }
    // if(existingAppointment.status==="CANCELLED" || existingAppointment.status==="ONGOING" || existingAppointment.status==="COMPLETED"){
    //     throw new Error(`Appointment is already ${String(existingAppointment.status).toLowerCase}`)
    // }
    if(!existingAppointment.schedule.doctor.consulationFee){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor has not set a consulation Fee yet")
    }
    const amount = existingAppointment.schedule.doctor.consulationFee.toString();
    const bkashIdToken = await getBkashIdToken();

    if(!bkashIdToken){
        throw new AppError(httpStatus.BAD_GATEWAY, "No bkash Id token Found!")
    }

    const bkashCratePayment = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`,{
        method: "POST",
        headers : {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization : bkashIdToken,
            "X-App-Key" : config.bkash_app_key
        },
        body : JSON.stringify({  
        // agreementID:'TokenizedMerchant01L3IKB6H1565072174986', // apppointment ID
        mode: "0011",
        payerReference: user.email, // user email or phone number
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
        // merchantAssociationInfo: "MI05MID54RF09123456One",
        amount: amount,
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: existingAppointment.id
        })
    })   

    const bkashCreatePaymentResult = await bkashCratePayment.json();

    //payment model update
    await prisma.payment.update({
        where :{
            appointmentId : existingAppointment.id
        },
        data : {
            merchantInvoiceNumber : bkashCreatePaymentResult.merchantInvoiceNumber,
            gatewayResponse : bkashCreatePaymentResult,
            bkashPaymentId : bkashCreatePaymentResult.paymentID,
        }
    })
    return {
        paymentUrl : bkashCreatePaymentResult.bkashURL
    }
}

const bookAppointmentCallback = async(query: Record<string,any>) => {
    const transactionResult = await prisma.$transaction(async(tx)=>{
    const paymentId = query.paymentID

    if(!paymentId){
        throw new AppError(httpStatus.BAD_REQUEST, "Payment Id Missing");
    }

    const status = query.status
    if(!status){
        throw new AppError(httpStatus.BAD_REQUEST, "Payment status is missing");
    }

    const bkashIdToken = await getBkashIdToken();

    if(!bkashIdToken){
        throw new AppError(httpStatus.BAD_GATEWAY, "No bkash Id token Found!")
    }

    const executedPaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/execute`,{
        method: "POST",
        headers : {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization : bkashIdToken,
            "X-App-Key" : config.bkash_app_key
        },
        body : JSON.stringify({
            paymentID : paymentId
        })
    })

    const executedPaymentResult = await executedPaymentResponse.json();

    if(status==="success"){
        const appoitnment = await prisma.appointment.findUnique({
            where : {
                id : executedPaymentResult.merchantInvoiceNumber
            },
            include:{
                schedule:true,
                patient : true,
                doctor : true
            }
        })

        if(!appoitnment){
            throw new AppError(httpStatus.NOT_FOUND,"Appointment not found!");
        }

        const newAvailableSlots = appoitnment.schedule.availableSlots - 1;

        const alreadyBookedSlots = appoitnment.schedule.totalSlot - appoitnment.schedule.availableSlots;

        const serialNumber = alreadyBookedSlots+1;

        const joiningTime = addMinutes(appoitnment.schedule.startDateTime, (serialNumber-1) *20);

        await tx.appointment.update({
            where : {
                id : executedPaymentResult.merchantInvoiceNumber,
            },
            data : {
                status : AppointmentStatus.CONFIRMED,
                joiningTime,
                serialNumber
            }
        });

        await tx.schedule.update({
            where : { id : appoitnment.schedule.id},
            data : {
                availableSlots : newAvailableSlots
            }
        })

        await tx.payment.update({
            where : {
                // appointmentId : executedPaymentResult.merchantInvoiceNumber,
                bkashPaymentId : paymentId
            },
            data : {
                status : PaymentStatus.PAID,
                bkashTrxId : executedPaymentResult.trxID,
                paidAt : executedPaymentResult.paymentExecuteTime,
                gatewayResponse : executedPaymentResult
            }
        });

        const pdfDocument = new PDFDocument({margin : 50});

        const pdfChunks : Buffer[] = [];

        pdfDocument.on('data',(chunk: Buffer)=>{
            pdfChunks.push(chunk)
        });

        const pdfReadyPromise = new Promise<Buffer>((resolve)=>{
            pdfDocument.on('end',()=>{
                resolve(Buffer.concat(pdfChunks))
            })
        })

        const pageWidth = pdfDocument.page.width;
        const contentLeft = 50;
        const contentWidth = pageWidth - 100;
        const halfWidth = contentWidth / 2;
        const rowHeight = 24;
        const brandColor = "#0f766e";
        const textColor = "#0f172a";
        const mutedColor = "#64748b";
        const borderColor = "#e2e8f0";
        const invoiceAmount = `${Number(executedPaymentResult.amount).toFixed(2)} ${executedPaymentResult.currency || "BDT"}`;

        const drawSectionTitle = (title : string, x : number, y : number) => {
            pdfDocument.fillColor(mutedColor).font("Helvetica-Bold").fontSize(9)
                .text(title, x, y, {characterSpacing : 1});
            return y + 16;
        };

        const drawDetailsTable = (rows : [string, string][], startY : number) => {
            pdfDocument.lineWidth(1).strokeColor(borderColor)
                .roundedRect(contentLeft, startY, contentWidth, rows.length * rowHeight, 6).stroke();

            rows.forEach(([label, value], index) => {
                const rowY = startY + index * rowHeight;
                if(index > 0){
                    pdfDocument.moveTo(contentLeft, rowY).lineTo(contentLeft + contentWidth, rowY).stroke();
                }
                pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(10)
                    .text(label, contentLeft + 14, rowY + 7);
                pdfDocument.fillColor(textColor).font("Helvetica-Bold").fontSize(10)
                    .text(value, contentLeft + 160, rowY + 7, {width : contentWidth - 174, align : "right"});
            });
            return startY + rows.length * rowHeight;
        };

        // header band
        pdfDocument.rect(0, 0, pageWidth, 100).fill(brandColor);
        pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22)
            .text("PH Healthcare", contentLeft, 32);
        pdfDocument.fillColor("#ccfbf1").font("Helvetica").fontSize(10)
            .text("Appointment Payment Receipt", contentLeft, 60);
        pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24)
            .text("INVOICE", contentLeft, 30, {width : contentWidth, align : "right"});
        pdfDocument.fillColor("#ccfbf1").font("Helvetica").fontSize(9)
            .text(`# ${appoitnment.id}`, contentLeft, 62, {width : contentWidth, align : "right"});

        // billed to (left) + invoice details (right)
        let y = 130;

        drawSectionTitle("BILLED TO", contentLeft, y);
        pdfDocument.fillColor(textColor).font("Helvetica-Bold").fontSize(12)
            .text(appoitnment.patient.name, contentLeft, y + 16, {width : halfWidth - 20});
        pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(10)
            .text(appoitnment.patient.email, contentLeft, y + 34, {width : halfWidth - 20});
        if(appoitnment.patient.contactNumber){
            pdfDocument.text(appoitnment.patient.contactNumber, contentLeft, y + 49, {width : halfWidth - 20});
        }

        const rightColumnX = contentLeft + halfWidth + 20;
        const rightColumnWidth = halfWidth - 20;
        const invoiceDetails : [string, string][] = [
            ["Issued on", format(new Date(), "dd MMM yyyy")],
            ["Appointment", AppointmentStatus.CONFIRMED],
            ["Payment", PaymentStatus.PAID],
        ];

        drawSectionTitle("INVOICE DETAILS", rightColumnX, y);
        invoiceDetails.forEach(([label, value], index) => {
            const rowY = y + 16 + index * 16;
            pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(10)
                .text(label, rightColumnX, rowY);
            pdfDocument.fillColor(value === PaymentStatus.PAID ? "#166534" : textColor).font("Helvetica-Bold").fontSize(10)
                .text(value, rightColumnX, rowY, {width : rightColumnWidth, align : "right"});
        });

        // appointment details
        y = drawSectionTitle("APPOINTMENT DETAILS", contentLeft, 210);
        y = drawDetailsTable([
            ["Doctor", `Dr. ${appoitnment.doctor.name}`],
            ["Specialization", appoitnment.doctor.specialization],
            ["Date", format(appoitnment.schedule.startDateTime, "EEEE, dd MMMM yyyy")],
            ["Joining time", format(joiningTime, "hh:mm a")],
            ["Serial number", `#${serialNumber}`],
        ], y);

        pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(9)
            .text("Meeting link: ", contentLeft, y + 10, {continued : true})
            .fillColor(brandColor)
            .text(appoitnment.schedule.meetingLink, {link : appoitnment.schedule.meetingLink, underline : true});

        // payment summary
        y = drawSectionTitle("PAYMENT SUMMARY", contentLeft, y + 40);

        pdfDocument.rect(contentLeft, y, contentWidth, rowHeight).fill("#f0fdfa");
        pdfDocument.fillColor(brandColor).font("Helvetica-Bold").fontSize(9)
            .text("DESCRIPTION", contentLeft + 14, y + 8, {characterSpacing : 1})
            .text("AMOUNT", contentLeft, y + 8, {width : contentWidth - 14, align : "right", characterSpacing : 1});
        y += rowHeight;

        pdfDocument.fillColor(textColor).font("Helvetica").fontSize(10)
            .text(`Consultation fee - Dr. ${appoitnment.doctor.name}`, contentLeft + 14, y + 9)
            .text(invoiceAmount, contentLeft, y + 9, {width : contentWidth - 14, align : "right"});
        y += 28;

        pdfDocument.rect(contentLeft, y, contentWidth, 30).fill(brandColor);
        pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11)
            .text("Total Paid", contentLeft + 14, y + 10)
            .text(invoiceAmount, contentLeft, y + 10, {width : contentWidth - 14, align : "right"});
        y += 30;

        // payment details
        y = drawSectionTitle("PAYMENT DETAILS", contentLeft, y + 24);
        drawDetailsTable([
            ["Payment method", "bKash"],
            ["Transaction ID", executedPaymentResult.trxID],
            ["Payment ID", paymentId],
            ["Paid at", executedPaymentResult.paymentExecuteTime || "-"],
        ], y);

        // footer
        const footerY = pdfDocument.page.height - 90;
        pdfDocument.lineWidth(1).strokeColor(borderColor)
            .moveTo(contentLeft, footerY).lineTo(contentLeft + contentWidth, footerY).stroke();
        pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(9)
            .text("This is a computer-generated invoice and does not require a signature.", contentLeft, footerY + 12, {width : contentWidth, align : "center"})
            .text(`© ${new Date().getFullYear()} PH Healthcare. All rights reserved.`, {width : contentWidth, align : "center"});

        pdfDocument.end()

        const pdfBuffer = await pdfReadyPromise; 

        const templatePath = path.join(
            process.cwd(),"src/app/templates/appointment-invoice.ejs"
        )

        const templateData = {
            patientName : appoitnment.patient.name,
            doctorName : appoitnment.doctor.name,
            specialization : appoitnment.doctor.specialization,
            invoiceNumber : appoitnment.id,
            serialNumber,
            appointmentDate : format(appoitnment.schedule.startDateTime, "EEEE, dd MMMM yyyy"),
            joiningTime : format(joiningTime, "hh:mm a"),
            meetingLink : appoitnment.schedule.meetingLink,
            amount : executedPaymentResult.amount,
            currency : executedPaymentResult.currency || "BDT",
            trxId : executedPaymentResult.trxID,
            paymentId,
            paidAt : executedPaymentResult.paymentExecuteTime,
            brandName : "PH Healthcare"
        }
        const html = await ejs.renderFile(templatePath,templateData)

        await transporter.sendMail({
            from : config.email_sender,
            to : appoitnment.patient.email,
            subject : "Your Appointment Invoice - PH Healtcare System",
            html,
            attachments : [
                {
                    filename : "invoice.pdf",
                    content : pdfBuffer
                }
            ]
        })

        return {
            redirectUrl : `${config.frontend_url}/dashboard/my-appointments?status=success`
        }
    }
    else if(status==="failure"){
        await tx.payment.update({
            where : {
                bkashPaymentId : paymentId
            },
            data : {
                status : PaymentStatus.FAILED,
                gatewayResponse : executedPaymentResult
            }
        })
        return {
            redirectUrl : `${config.frontend_url}/dashboard/my-appointments?status=failure`
        }
    }
    else if(status==="cancel"){
        await tx.payment.update({
            where : {
                bkashPaymentId : paymentId
            },
            data : {
                status : PaymentStatus.CANCELLED,
                gatewayResponse : executedPaymentResult
            }
        })
        return {
            redirectUrl : `${config.frontend_url}/dashboard/my-appointments?status=cancel`
        }
    } else {
            return {
                redirectUrl : `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`
            }
        }
    },{
        maxWait : 10000,
        timeout : 30000
    });
    return transactionResult;
}

const cancelAppointment = async(payload:ICancelAppointmentPayload,user:RequestUser) => {
    const transactionResult = await prisma.$transaction(async(tx)=>{
        const appointmentId = payload.appointmentId;
        const existingAppointment = await tx.appointment.findUnique({
            where : {
                id : appointmentId,
                patient : {
                    email : user.email
                }
            },
            include : {
                payment : true,
                schedule : true
            }
        });
        if(!existingAppointment){
            throw new AppError(httpStatus.NOT_FOUND, "Appointment does not exist");
        };
        if(existingAppointment.status === "ONGOING" || existingAppointment.status === "COMPLETED"){
            throw new AppError(httpStatus.BAD_REQUEST, "Appointment Ongoing or Completed");
        };
        if(existingAppointment.status==="CANCELLED"){
            throw new AppError(httpStatus.BAD_REQUEST, "Appointment already Cancelled");
        };
        const updateAppointment = await tx.appointment.update({
            where :{
                id: appointmentId
            },
            data :{
                status : AppointmentStatus.CANCELLED
            }
        });

        await tx.schedule.update({
            where : {
                id : existingAppointment.schedule.id
            },
            data :{
                availableSlots : {increment : 1}
            }
        });

        // refund process
        const now = new Date();
        const startDateTime = existingAppointment.schedule.startDateTime;

        // no refund after cancelling before 1h of startTime
        const refundCutOffTime = subHours(startDateTime,1);
        const isEligibleForRefund = isBefore(now,refundCutOffTime);

        if(isEligibleForRefund){
            const bkashIdToken = await getBkashIdToken();

            if(!bkashIdToken){
                throw new AppError(httpStatus.BAD_GATEWAY, "No bkash Id token Found!")
            };

            const bkashRefundPaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/payment/refund`,{
                method: "POST",
                headers : {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization : bkashIdToken,
                    "X-App-Key" : config.bkash_app_key
                },
                body : JSON.stringify({  
                    paymentID: existingAppointment.payment?.bkashPaymentId,
                    trxID: existingAppointment.payment?.bkashTrxId,
                    amount: existingAppointment.payment?.amount.toString(),
                    sku:"test",
                    reason: "Patient cancelled the appointment"
                })
            })   
            
            const bkashRefundPaymentResult = await bkashRefundPaymentResponse.json();

            console.log(bkashRefundPaymentResult);

            await tx.payment.update({
                where : {
                    appointmentId: existingAppointment.id
                },
                data : {
                    refundTrxId : bkashRefundPaymentResult.refundTrxID,
                    refundedAt : bkashRefundPaymentResult.completedTime,
                    refundAmount : bkashRefundPaymentResult.amount,
                    refundReason : "Patient cancelled the appointment",
                    status : PaymentStatus.REFUNDED,
                    gatewayResponse: bkashRefundPaymentResult
                }   
            });
        }
        const newPaymentInfo = await tx.payment.findUnique({
            where:{ appointmentId : existingAppointment.id}
        }) 
        
        return {
            appointment : updateAppointment,
            payment : newPaymentInfo
        }
    })
    return transactionResult;
};

const updateAppointmentStatus = async(appointmentId : string,payload:IUpdateAppointmentStatusPayload,user:RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : { userId : user.userId }
    });
    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found!");
    }

    const appointment = await prisma.appointment.findUnique({
        where: { id  : appointmentId , doctorId : doctor.id}
    })
    if(!appointment){
        throw new AppError(httpStatus.NOT_FOUND,"Appointment not found!");
    };
    if(appointment.status === AppointmentStatus.COMPLETED){
        throw new AppError(httpStatus.FORBIDDEN, "Appointment is already completed")
    };

    if(appointment.status === AppointmentStatus.CANCELLED){
        throw new AppError(httpStatus.FORBIDDEN,"Appointment is already cancelled");
    };
    if(appointment.status===AppointmentStatus.PENDING){
        throw new AppError(httpStatus.FORBIDDEN,"Appointment is Pending. You can change the status after appointment is confirmed")
    }

    if(appointment.status === AppointmentStatus.CONFIRMED){

        if(payload.status !=="ONGOING"){
            throw new AppError(httpStatus.BAD_REQUEST, "Appointment need to be confirmed before update to ongoing");
        };

        await prisma.appointment.update({
            where: {id : appointmentId},
            data : {
                status : AppointmentStatus.ONGOING
            }
        })
    }
    if(appointment.status === AppointmentStatus.ONGOING){

        if(payload.status !=="COMPLETED"){
            throw new AppError(httpStatus.BAD_REQUEST, "Ongoing appointment must have to be completed");
        };

        await prisma.appointment.update({
            where: {id : appointmentId},
            data : {
                status : AppointmentStatus.COMPLETED
            }
        })
    }

    const updateAppointment = await prisma.appointment.findUnique({
        where : { id : appointment.id}
    });

    return updateAppointment
};

//patient appointments
const getMyAppointments = async(query : IQuery,user:RequestUser) => {
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const paitent = await prisma.patient.findUnique({
        where : { userId : user.userId},
    });

    if(!paitent){
        throw new AppError(httpStatus.NOT_FOUND, "PAtient not found!");
    }

    const andConditions : AppointmentWhereInput[] = [
        {
            patientId : paitent.id
        }
    ];

    const appointments = await prisma.appointment.findMany({
        where : { AND : andConditions},
        take : limit,
        skip,
        orderBy : {[sortBy] : sortOrder},
        include :{
            doctor : {select : { id : true, name : true,specialization : true}},
            schedule :true,
            payment : true
        }
    });
    const total = await prisma.appointment.count({
        where : {AND:andConditions}
    });
    return {
        data : appointments,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }

}

// doctor appointments
const getDoctorAppointments = async(query : IQuery,user:RequestUser) => {
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const doctor = await prisma.doctor.findUnique({
        where: {userId : user.userId }
    });

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND,"Doctor Profile not found");
    }

    const andConditions : AppointmentWhereInput[] = [
        {
            doctorId : doctor.id
        }
    ];

    const appointments = await prisma.appointment.findMany({
        where : { AND : andConditions},
        take : limit,
        skip,
        orderBy : {[sortBy] : sortOrder},
        include :{
            doctor : {select : { id : true, name : true,specialization : true}},
            schedule :true,
            payment : true
        }
    });
    const total = await prisma.appointment.count({
        where : {AND:andConditions}
    });
    return {
        data : appointments,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }
 
}

// admin super admin
const getAllAppointments = async(query:IQuery) => {
    const limit = query.limit ? Number(query.limit) : 10;
    const page = query.page ? Number(query.page) : 1;
    const skip = (page -1) * limit;
    const sortBy = query.sortBy ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const andConditions : AppointmentWhereInput[] = [];

    if(query.status){
        andConditions.push({status : query.status});
    }
    if(query.doctorId){
        andConditions.push({doctorId : query.doctorId});
    }
    if(query.patientId){
        andConditions.push({patientId : query.patientId});
    }
    if(query.doctorEmail){
        andConditions.push({
            doctor : {
                email : query.doctorEmail
            }
        });
    }
    if(query.patientEmail){
        andConditions.push({
            patient : {
                email : query.patientEmail
            }
        });
    }

    const appointments = await prisma.appointment.findMany({
        where : { AND : andConditions},
        take : limit,
        skip,
        orderBy : {[sortBy] : sortOrder},
        include :{
            doctor : {select : { id : true, name : true,specialization : true}},
            schedule :true,
            payment : true
        }
    });
    const total = await prisma.appointment.count({
        where : {AND:andConditions}
    });
    return {
        data : appointments,
        meta : {
            page,
            limit,
            total,
            totalPages : Math.ceil(total/limit),
        }
    }
}

// for all logged in user
const getSingleAppointment = async(appointmentId : string,user:RequestUser) => {
    const appointment = await prisma.appointment.findUnique({
        where : { id : appointmentId},
        include : {
            patient : { select : {id: true,name: true,email: true,userId : true}},
            doctor : {select : {id: true,name: true,specialization: true,userId : true}},
            schedule : true,
            payment : true
        }
    });

    if(!appointment){
        throw new AppError(httpStatus.NOT_FOUND,"Appointment not found!!");
    };

    if(user.role === Role.PATIENT){
        if(appointment.patient.userId !== user.userId){
            throw new AppError(httpStatus.FORBIDDEN, "You are not allowed to view this appointment")
        }
    }

    if(user.role === Role.DOCTOR){
        if(appointment.doctor.userId !== user.userId){
            throw new AppError(httpStatus.FORBIDDEN, "You are not allowed to view this appointment")
        }
    }
    return appointment
}

export const AppointmentServices = {
    bookAppointment,
    bookAppointmentCallback,
    payAppointment,
    cancelAppointment,
    updateAppointmentStatus,
    getMyAppointments,
    getDoctorAppointments,
    getAllAppointments,
    getSingleAppointment,
}