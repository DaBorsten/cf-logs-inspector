/** zod request schemas for IPC channels (main-side validation of renderer input). */
import { z } from 'zod';

const id = z.string().min(1);
const connectionId = z.object({ connectionId: id });
const sessionId = z.number().int().positive();

export const connectionInputSchema = z.object({
  id: id.optional(),
  name: z.string().min(1).max(200),
  apiUrl: z.string().min(1).max(2000),
  region: z.string().max(50).optional(),
  authMode: z.enum(['password', 'origin', 'passcode']),
  origin: z.string().max(200).optional(),
  username: z.string().max(500).optional(),
  skipSslValidation: z.boolean(),
  caCertPem: z.string().max(200_000).optional(),
});

export const connectionTestSchema = z.object({
  apiUrl: z.string().min(1).max(2000),
  skipSslValidation: z.boolean(),
  caCertPem: z.string().max(200_000).optional(),
});

export const idSchema = z.object({ id });
export const connectionIdSchema = connectionId;

export const loginPasswordSchema = connectionId.extend({
  username: z.string().min(1).max(500),
  password: z.string().min(1).max(4000),
  origin: z.string().max(200).optional(),
});

export const passcodeLoginSchema = connectionId.extend({
  passcode: z.string().trim().min(1).max(200),
});

export const spacesSchema = connectionId.extend({ orgGuid: id });
export const appsSchema = connectionId.extend({ spaceGuid: id });

export const validateDqlSchema = z.object({ dql: z.string().max(10_000) });

// ---- workspaces ----
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const workspacePathSchema = z.object({ path: z.string().min(1).max(4000) });
export const kvGetSchema = z.object({ key: z.string().min(1).max(200) });
export const kvSetSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(1_000_000).nullable(),
});

// ---- sessions ----
export const sessionCreateSchema = z.object({
  connectionId: id,
  appGuid: id.max(200),
  appName: z.string().min(1).max(500),
  orgGuid: z.string().max(200).optional(),
  orgName: z.string().max(500).optional(),
  spaceGuid: z.string().max(200).optional(),
  spaceName: z.string().max(500).optional(),
  name: z.string().max(200).optional(),
  pollIntervalMs: z.number().int().min(250).max(300_000).optional(),
});
export const sessionIdSchema = z.object({ sessionId });
export const sessionStartSchema = z.object({ sessionId, recent: z.boolean().optional() });
export const sessionIntervalSchema = z.object({
  sessionId,
  pollIntervalMs: z.number().int().min(250).max(300_000),
});
