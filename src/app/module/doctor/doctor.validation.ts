import { z } from "zod";

const createDoctorUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be at most 100 characters"),
  email: z.email("Email is not Valid!!!"),
});

const createDoctorProfileSchema = z.object({
  address: z.string().trim().max(255).optional(),
  specialization: z
    .string()
    .trim()
    .min(2, "Specialization is required")
    .max(100),
  licenseNumber: z
    .string()
    .trim()
    .min(3, "License number is required")
    .max(50),
  qualifications: z
    .string()
    .trim()
    .min(2, "Qualifications are required")
    .max(255),
  experienceYears: z
    .number()
    .int("Experience must be a whole number")
    .min(0, "Experience cannot be negative")
    .max(70, "Experience seems too high"),
  bio: z.string().trim().max(1000).optional(),
  consulationFee: z.coerce
    .number()
    .nonnegative("Fee cannot be negative")
    .max(99999999.99, "Fee is too large") // fits Decimal(10, 2)
    .optional(),
  contactNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid contact number")
    .optional(),
});

export const applyAsDoctorValidationSchema = z.object({
  user: createDoctorUserSchema,
  doctor: createDoctorProfileSchema,
});

export type TApplyAsDoctorPayload = z.infer<typeof applyAsDoctorValidationSchema>;

export const DoctorValidation = {
  applyAsDoctorValidationSchema,
};