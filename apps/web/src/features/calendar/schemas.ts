import { z } from "zod/v4";

export const eventSchema = z.object({
	title: z.string().min(1, "Title is required"),
	description: z.string().min(1, "Description is required"),
	startDate: z.date("Start date is required"),
	endDate: z.date("End date is required"),
	color: z.enum(["blue", "green", "red", "yellow", "purple", "orange"]),
});

export type TEventFormData = z.infer<typeof eventSchema>;
