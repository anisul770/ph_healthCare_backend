export interface IMedicine {
    name: string,
    dosage : string,
    duration : string,
    instruction? : string
}

export interface ICreatePrescriptionPayload {
    appointmentId : string,
    findings : string,
    medicines : IMedicine[];
}