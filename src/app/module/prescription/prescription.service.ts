import httpStatus from "http-status"
import PDFdocument from "pdfkit";
import { prisma } from "../../lib/prisma"
import { RequestUser } from "../../middleware/checkAuth"
import { AppError } from "../../utils/AppError";
import { ICreatePrescriptionPayload } from "./prescription.interface"
import { AppointmentStatus, Role } from "../../../generated/prisma/enums";
import { UploadApiResponse } from "cloudinary";
import { cloudinary } from "../../lib/cloudinary";
import { transporter } from "../../lib/nodemailer";
import config from "../../config";
import { format } from "date-fns";
import path from "path";
import ejs from "ejs";

const createPrescription = async(payload:ICreatePrescriptionPayload,user:RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where : {userId : user.userId}
    });

    if(!doctor){
        throw new AppError(httpStatus.NOT_FOUND, "Doctor profile not found");
    };

    const appointment = await prisma.appointment.findUnique({
        where: {id: payload.appointmentId, doctorId : doctor.id},
        include :{ patient:true}
    });

    if(!appointment){
        throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found!!")
    };

    if(appointment.status !== AppointmentStatus.COMPLETED){
        throw new AppError(httpStatus.BAD_REQUEST, "Prescirption can only be written for a completed appointment")
    };
    if(appointment.prescriptionUrl){
        throw new AppError(httpStatus.CONFLICT,"A prescription is already exists for this appointment")
    };

    const pdfDocument = new PDFdocument({margin : 50});

    const pdfChunks: Buffer[] = [];

    pdfDocument.on('data',(chunk:Buffer)=>{
        pdfChunks.push(chunk)
    });

    const pdfReadyPromise = new Promise<Buffer>((resolve)=>{
        pdfDocument.on("end",()=>{
            resolve(Buffer.concat(pdfChunks))
        })
    });
    // pdf Content
    const pageWidth = pdfDocument.page.width;
    const contentLeft = 50;
    const contentWidth = pageWidth - 100;
    const halfWidth = contentWidth / 2;
    const bottomLimit = pdfDocument.page.height - 100;
    const cellPadding = 8;
    const brandColor = "#0f766e";
    const textColor = "#0f172a";
    const bodyColor = "#334155";
    const mutedColor = "#64748b";
    const borderColor = "#e2e8f0";
    const prescriptionDate = format(new Date(), "dd MMM yyyy");

    const columns = [
        { header : "#", width : 28 },
        { header : "MEDICINE", width : 150 },
        { header : "DOSAGE", width : 100 },
        { header : "DURATION", width : 80 },
        { header : "INSTRUCTION", width : contentWidth - 358 },
    ];

    let y = 0;

    const drawSectionTitle = (title : string, x : number, top : number) => {
        pdfDocument.fillColor(mutedColor).font("Helvetica-Bold").fontSize(9)
            .text(title, x, top, {characterSpacing : 1});
        return top + 16;
    };

    const drawInfoBlock = (title : string, heading : string, lines : string[], x : number, top : number) => {
        drawSectionTitle(title, x, top);
        pdfDocument.fillColor(textColor).font("Helvetica-Bold").fontSize(13)
            .text(heading, x, top + 16, {width : halfWidth - 20});
        lines.forEach((line, index) => {
            pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(10)
                .text(line, x, top + 36 + index * 15, {width : halfWidth - 20});
        });
    };

    const drawFooter = () => {
        const footerY = pdfDocument.page.height - 80;
        pdfDocument.lineWidth(1).strokeColor(borderColor)
            .moveTo(contentLeft, footerY).lineTo(contentLeft + contentWidth, footerY).stroke();
        pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(8)
            .text(
                "This prescription was generated electronically by PH Healthcare. Take medicines only as directed by your doctor.",
                contentLeft, footerY + 10, {width : contentWidth, align : "center"}
            );
    };

    const startNewPage = () => {
        drawFooter();
        pdfDocument.addPage();
        y = 50;
    };

    const drawTableHeader = () => {
        pdfDocument.rect(contentLeft, y, contentWidth, 26).fill(brandColor);
        let cellX = contentLeft;
        columns.forEach((column) => {
            pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9)
                .text(column.header, cellX + cellPadding, y + 9, {width : column.width - cellPadding * 2, characterSpacing : 0.5});
            cellX += column.width;
        });
        y += 26;
    };

    // medicine name is bold, every other cell is regular
    const setCellFont = (index : number) => {
        pdfDocument.font(index === 1 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    };

    // header band
    pdfDocument.rect(0, 0, pageWidth, 100).fill(brandColor);
    pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22)
        .text("PH Healthcare", contentLeft, 32);
    pdfDocument.fillColor("#ccfbf1").font("Helvetica").fontSize(10)
        .text("Medical Prescription", contentLeft, 60);
    pdfDocument.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24)
        .text("PRESCRIPTION", contentLeft, 30, {width : contentWidth, align : "right"});
    pdfDocument.fillColor("#ccfbf1").font("Helvetica").fontSize(9)
        .text(`# ${appointment.id}`, contentLeft, 62, {width : contentWidth, align : "right"});

    // doctor (left) + patient (right)
    y = 125;
    drawInfoBlock("DOCTOR", `Dr. ${doctor.name}`, [
        doctor.qualifications,
        doctor.specialization,
        `License No: ${doctor.licenseNumber}`,
    ], contentLeft, y);

    drawInfoBlock("PATIENT", appointment.patient.name, [
        appointment.patient.email,
        ...(appointment.patient.contactNumber ? [`Phone: ${appointment.patient.contactNumber}`] : []),
        `Date: ${prescriptionDate}`,
    ], contentLeft + halfWidth + 20, y);

    y = 225;
    pdfDocument.lineWidth(1).strokeColor(borderColor)
        .moveTo(contentLeft, y).lineTo(contentLeft + contentWidth, y).stroke();

    // clinical findings
    y = drawSectionTitle("CLINICAL FINDINGS", contentLeft, y + 20);
    pdfDocument.font("Helvetica").fontSize(10);
    const findingsHeight = pdfDocument.heightOfString(payload.findings, {width : contentWidth - 28}) + 24;
    pdfDocument.roundedRect(contentLeft, y, contentWidth, findingsHeight, 6).fill("#f0fdfa");
    pdfDocument.fillColor(bodyColor).font("Helvetica").fontSize(10)
        .text(payload.findings, contentLeft + 14, y + 12, {width : contentWidth - 28});
    y += findingsHeight + 28;

    // medicines
    if(y + 90 > bottomLimit){
        startNewPage();
    }
    pdfDocument.fillColor(brandColor).font("Helvetica-Bold").fontSize(26)
        .text("Rx", contentLeft, y);
    pdfDocument.fillColor(mutedColor).font("Helvetica-Bold").fontSize(9)
        .text("MEDICINES", contentLeft + 44, y + 10, {characterSpacing : 1});
    y += 38;
    drawTableHeader();

    for(let i = 0;i<payload.medicines.length;i++){
        const medicine = payload.medicines[i];
        const cells = [
            `${i + 1}`,
            medicine.name,
            medicine.dosage,
            medicine.duration,
            medicine.instruction || "-",
        ];

        const rowHeight = Math.max(
            ...cells.map((cell, index) => {
                setCellFont(index);
                return pdfDocument.heightOfString(cell, {width : columns[index].width - cellPadding * 2});
            })
        ) + cellPadding * 2;

        if(y + rowHeight > bottomLimit){
            startNewPage();
            drawTableHeader();
        }

        if(i % 2 === 1){
            pdfDocument.rect(contentLeft, y, contentWidth, rowHeight).fill("#f8fafc");
        }

        let cellX = contentLeft;
        cells.forEach((cell, index) => {
            setCellFont(index);
            pdfDocument.fillColor(index === 1 ? textColor : bodyColor)
                .text(cell, cellX + cellPadding, y + cellPadding, {width : columns[index].width - cellPadding * 2});
            cellX += columns[index].width;
        });

        y += rowHeight;
        pdfDocument.lineWidth(1).strokeColor(borderColor)
            .moveTo(contentLeft, y).lineTo(contentLeft + contentWidth, y).stroke();
    }

    // doctor signature
    if(y + 90 > bottomLimit){
        startNewPage();
    }
    y += 60;
    const signatureWidth = 180;
    const signatureX = contentLeft + contentWidth - signatureWidth;
    pdfDocument.lineWidth(1).strokeColor(textColor)
        .moveTo(signatureX, y).lineTo(signatureX + signatureWidth, y).stroke();
    pdfDocument.fillColor(textColor).font("Helvetica-Bold").fontSize(10)
        .text(`Dr. ${doctor.name}`, signatureX, y + 6, {width : signatureWidth, align : "center"});
    pdfDocument.fillColor(mutedColor).font("Helvetica").fontSize(9)
        .text(doctor.specialization, signatureX, y + 20, {width : signatureWidth, align : "center"});

    drawFooter();


    pdfDocument.end();
    
    const pdfBuffer = await pdfReadyPromise;

    const uploadResult = await new Promise<UploadApiResponse>((resolve,reject)=>{
        cloudinary.uploader.upload_stream(
            { resource_type : "raw", format : 'pdf'},
            (error,result) => {
                if(error){
                    return reject(error);
                }
                if(!result){
                    return reject(
                        new AppError(httpStatus.INTERNAL_SERVER_ERROR, "No Result from Cloudinary")
                    )
                }
                resolve(result);
            }
        ).end(pdfBuffer);
    });

    const updatedAppointment = await prisma.appointment.update({
        where : {id:appointment.id},
        data : {
            prescriptionUrl : uploadResult.secure_url,
            prescriptionPublicId : uploadResult.public_id
        }
    });

    const templatePath = path.join(
        process.cwd(),"src/app/templates/patient-prescription.ejs"
    )

    const templateData = {
        patientName : appointment.patient.name,
        doctorName : doctor.name,
        specialization : doctor.specialization,
        prescriptionDate,
        medicineCount : payload.medicines.length,
        prescriptionUrl : uploadResult.secure_url,
        brandName : "PH Healthcare"
    }
    const html = await ejs.renderFile(templatePath,templateData)

    await transporter.sendMail({
        from : config.email_sender,
        to : appointment.patient.email,
        subject : `Your Prescription from Dr. ${doctor.name} - PH Healthcare`,
        html,
        attachments : [
            {
                filename : "Prescription.pdf",
                content : pdfBuffer,
            }
        ]
    });

    return updatedAppointment

}

const getSinglePrescription = async(appointmentId : string,user:RequestUser) => {
    const appointment = await prisma.appointment.findUnique({
        where :{id: appointmentId},
        include : {
            patient : { select : {id:true, name : true,userId : true}},
            doctor : {select : {id: true,name:true,userId:true}},
        }
    });

    if(!appointment){
        throw new AppError(httpStatus.NOT_FOUND,"Appointment not found!");
    }

    if(user.role === Role.PATIENT){
        if(appointment.patient.userId !== user.userId){
            throw new AppError(httpStatus.FORBIDDEN, "You are not allowed to view this appointment")
        }
    };

    if(user.role === Role.DOCTOR){
        if(appointment.doctor.userId !== user.userId){
            throw new AppError(httpStatus.FORBIDDEN, "You are not allowed to view this appointment")
        }
    };

    if(!appointment.prescriptionUrl){
        throw new AppError(httpStatus.NOT_FOUND,"No prescription has been written yet")
    };

    return {
        appointment,
        prescription : appointment.prescriptionUrl
    }
}

export const PrescriptionServices = {
    createPrescription,
    getSinglePrescription
}