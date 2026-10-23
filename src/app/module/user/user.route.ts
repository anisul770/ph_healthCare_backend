import { Router } from "express";
import { userController } from "./user.controller";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.patch("/profile-image",
    auth(Role.ADMIN,Role.SUPER_ADMIN,Role.PATIENT,Role.DOCTOR),
    upload.single("profileImage"),
    userController.uploadProfileImage);

export const userRoutes = router; 