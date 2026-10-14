import { z } from "zod";
import { parseMonitorUrl } from "@/lib/security/url-validation";

const acceptedStatusCode = z.number().int().min(100).max(599);

export const monitorInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .trim()
    .max(2048)
    .superRefine((value, context) => {
      try {
        parseMonitorUrl(value);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Invalid URL.",
        });
      }
    }),
  clientId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  intervalSeconds: z.number().int().min(60).max(86_400).default(60),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
  expectedStatusCodes: z
    .array(acceptedStatusCode)
    .min(1)
    .max(100)
    .refine((codes) => new Set(codes).size === codes.length, {
      message: "Expected status codes must be unique.",
    })
    .default([200]),
  failureThreshold: z.number().int().min(1).max(20).default(3),
  recoveryThreshold: z.number().int().min(1).max(20).default(1),
  latencyThresholdMs: z
    .number()
    .int()
    .min(1)
    .max(120_000)
    .nullable()
    .default(null),
});

export type MonitorInput = z.infer<typeof monitorInputSchema>;
