import { z } from 'zod';
import { BILLING_PLAN_TIERS } from '@molly/shared';

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  role: z.string(),
});

export const WorkspaceBillingEntitlementSchema = z.object({
  effectivePlanTier: z.enum(BILLING_PLAN_TIERS),
  checkoutPending: z.boolean(),
});

export const MachineAccessCheckResultSchema = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true) }),
  z.object({
    allowed: z.literal(false),
    reason: z.enum([
      'requester_not_member',
      'machine_not_registered',
      'not_visible',
      'project_not_shared',
    ]),
  }),
]);

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceBillingEntitlement = z.infer<typeof WorkspaceBillingEntitlementSchema>;
export type MachineAccessCheckResult = z.infer<typeof MachineAccessCheckResultSchema>;
