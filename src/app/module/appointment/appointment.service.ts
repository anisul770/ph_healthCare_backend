import { success } from "zod";
import config from "../../config"
import { getBkashIdToken } from "../../lib/bkash"
import { prisma } from "../../lib/prisma";
import { AppointmentStatus, PaymentStatus } from "../../../generated/prisma/enums";
import { RequestUser } from "../../middleware/checkAuth";

const bookAppointment = async(payload:any,user:RequestUser) => {


    const transactionResult = await prisma.$transaction(async(tx)=>{
        // business logic 

        const appointment = await tx.appointment.create({
            data:{
                status : AppointmentStatus.PENDING
            }
        })

        const bkashIdToken = await getBkashIdToken();

        if(!bkashIdToken){
            throw new Error("No bkash Id token Found!")
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
            amount: "1200",
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
                amount : "1200",
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

const payAppointment = async(payload:any, user:RequestUser) => {
    const appointmentId = payload.appointmentId;
    const existingAppointment = await prisma.appointment.findUnique({
        where : {
            id : appointmentId
        }
    });
    if(!existingAppointment){
        throw new Error("Appointment does not exist");
    }
    if(existingAppointment.status!=="PENDING"){
        throw new Error("Appointment already paid and confirmed");
    }
    // if(existingAppointment.status==="CANCELLED" || existingAppointment.status==="ONGOING" || existingAppointment.status==="COMPLETED"){
    //     throw new Error(`Appointment is already ${String(existingAppointment.status).toLowerCase}`)
    // }
    const bkashIdToken = await getBkashIdToken();

    if(!bkashIdToken){
        throw new Error("No bkash Id token Found!")
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
        amount: "12",
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
        throw new Error("Payment Id Missing");
    }

    const status = query.status
    if(!status){
        throw new Error("Payment status is missing");
    }

    const bkashIdToken = await getBkashIdToken();

    if(!bkashIdToken){
        throw new Error("No bkash Id token Found!")
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
        await tx.appointment.update({
            where : {
                id : executedPaymentResult.merchantInvoiceNumber
            },
            data : {
                status : AppointmentStatus.CONFIRMED
            }
        });

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
        })

        return {
            executedPaymentResult,
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
            executedPaymentResult,
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
            executedPaymentResult,
            redirectUrl : `${config.frontend_url}/dashboard/my-appointments?status=cancel`
        }
    } else {
            return {
                executedPaymentResult,
                redirectUrl : `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`
            }
        }
    });
    return transactionResult;
}

const cancelAppointment = async(payload:any) => {
    const transactionResult = await prisma.$transaction(async(tx)=>{
        const appointmentId = payload.appointmentId;
        const existingAppointment = await tx.appointment.findUnique({
            where : {
                id : appointmentId
            },
            include : {
                payment : true
            }
        });
        if(!existingAppointment){
            throw new Error("Appointment does not exist");
        };
        if(existingAppointment.status === "ONGOING" || existingAppointment.status === "COMPLETED"){
            throw new Error("Appointment Ongoing or Completed");
        };
        if(existingAppointment.status==="CANCELLED"){
            throw new Error("Appointment already Cancelled");
        };
        const updateAppointment = await tx.appointment.update({
            where :{
                id: appointmentId
            },
            data :{
                status : AppointmentStatus.CANCELLED
            }
        });

        const bkashIdToken = await getBkashIdToken();

        if(!bkashIdToken){
            throw new Error("No bkash Id token Found!")
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

        const updatedPayment = await tx.payment.update({
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
        return {
            appointment : updateAppointment,
            payment : updatedPayment
        }
    })
    return transactionResult;
};

export const AppointmentServices = {
    bookAppointment,
    bookAppointmentCallback,
    payAppointment,
    cancelAppointment
}