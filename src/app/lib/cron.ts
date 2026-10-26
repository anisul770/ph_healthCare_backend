import cron from "node-cron"
import { prisma } from "./prisma";
import { DoctorVerificationStatus, Role } from "../../generated/prisma/enums";

// cron.schedule('*/1 * * * * *', () => {
//     // prisma business => doctors delete
//     console.log(`running a task every second ${a}`);
// });

export const deleteUnverifiedDoctors = async()=> {
    cron.schedule('*/10 * * * *', async() => {
        try {
            // prisma business => doctors delete
            // console.log(`running a task every second`);
            const oneHourAgo = new Date(Date.now() - 60*60*1000);
            const deletedDoctors = await prisma.user.deleteMany({
                where : {
                    role : Role.DOCTOR,
                    emailVerified : false,
                    createdAt : {lt : oneHourAgo },
                    doctor : {
                        verificationStatus : DoctorVerificationStatus.PENDING
                    }
                }
            });

            if(deletedDoctors.count > 0){
                console.log(`
                Cron : Deleted ${deletedDoctors.count} unverified email doctor application older than 1 hour 
                `);
            }
        } catch (error) {
            console.log("Cron failed delete unverified doctor application", error);   
        }
        console.log("Dcotor delete cron schedule (every 10 minutes)");
    });
}
