import { z } from 'zod';

export const BrowserImportCookieSchema = z
  .object({
    name: z.string().min(1).max(256),
    value: z.string().max(8_192),
    domain: z.string().min(1).max(253),
    path: z.string().min(1).max(1_024),
    hostOnly: z.boolean(),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    session: z.boolean(),
    expirationDate: z.number().positive().optional(),
    sameSite: z.enum(['no_restriction', 'lax', 'strict', 'unspecified']),
  })
  .strict()
  .refine(
    (cookie) => cookie.session || cookie.expirationDate !== undefined,
    'Persistent cookie must retain its Chrome expiration date.'
  );
export type BrowserImportCookie = z.infer<typeof BrowserImportCookieSchema>;
