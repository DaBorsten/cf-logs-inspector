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

// ---- entries / query engine ----
const timeFilterSchema = z.union([
  z.object({
    kind: z.literal('relative'),
    amount: z.number().positive(),
    unit: z.enum(['m', 'h', 'd']),
  }),
  z.object({
    kind: z.literal('absolute'),
    fromMs: z.number().optional(),
    toMs: z.number().optional(),
  }),
]);
const sessionIds = z.array(sessionId).max(1000).optional();
const dql = z.string().max(10_000).optional();
const sortSchema = z
  .array(z.object({ key: z.string().min(1).max(200), dir: z.enum(['asc', 'desc']) }))
  .max(5)
  .optional();

export const entryQuerySchema = z.object({
  sessionIds,
  dql,
  time: timeFilterSchema.optional(),
  sort: sortSchema,
  snapshotId: z.number().int().nonnegative().optional(),
  paging: z.object({
    limit: z.number().int().min(1).max(1000),
    offset: z.number().int().nonnegative(),
  }),
});
export const entryCountSchema = z.object({
  sessionIds,
  dql,
  time: timeFilterSchema.optional(),
  snapshotId: z.number().int().nonnegative().optional(),
});
export const entryIdSchema = z.object({ id: z.number().int().positive() });
export const valuesQuerySchema = z.object({
  field: z.string().min(1).max(200),
  prefix: z.string().max(200).optional(),
  sessionIds,
  time: timeFilterSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export const propsListSchema = z.object({ sessionIds });
