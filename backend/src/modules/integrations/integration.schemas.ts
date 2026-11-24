import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { dateOnlySchema, dateRangeSchema } from '../reporting/reporting.schemas';
import { LEAVE_REQUEST_STATUSES } from '../leave/leaveRequest.model';
import { CORRECTION_STATUSES } from '../attendance/attendanceCorrection.model';
import {
  INTEGRATION_EMPLOYEE_MAPPING_STATUSES,
  INTEGRATION_WEBHOOK_DELIVERY_STATUSES,
  INTEGRATION_WEBHOOK_EVENT_TYPES,
  INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES,
} from './integration.constants';

const externalId = z.string().trim().min(1).max(200);
const externalEmail = z.string().trim().email().max(254);
const redirectUri = z.string().trim().min(1).max(2048);
const codeVerifier = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/, 'code_verifier must use RFC 7636 characters');

export const oauthAuthorizeQuerySchema = z
  .object({
    response_type: z.literal('code'),
    client_id: z.string().trim().min(8).max(64),
    redirect_uri: redirectUri,
    scope: z.string().trim().min(1).max(500),
    state: z.string().min(16).max(512),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, 'Invalid PKCE code_challenge'),
    code_challenge_method: z.literal('S256').default('S256'),
    external_organization_id: externalId,
  })
  .strict();

export type OAuthAuthorizeQuery = z.infer<typeof oauthAuthorizeQuerySchema>;

export const oauthLoginBodySchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024),
    authorization_request_id: z.string().uuid(),
    // Login CSRF token, bound to the authorisation request and the binding cookie.
    _csrf: z.string().min(1).max(256),
  })
  .strict();

export const oauthDecisionBodySchema = z
  .object({
    // Hidden field on the server-rendered consent form. The CSRF middleware
    // validates it; it still has to be accepted by the body schema.
    _csrf: z.string().min(1).optional(),
    authorization_request_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    decision: z.enum(['approve', 'deny']),
  })
  .strict();

export const oauthTokenBodySchema = z
  .object({
    grant_type: z.enum(['authorization_code', 'refresh_token']),
    client_id: z.string().trim().min(8).max(64),
    client_secret: z.string().min(16).max(512),
    code: z.string().min(16).max(512).optional(),
    redirect_uri: redirectUri.optional(),
    code_verifier: codeVerifier.optional(),
    refresh_token: z.string().min(16).max(512).optional(),
    external_organization_id: externalId.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.grant_type === 'authorization_code') {
      if (!value.code) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['code'], message: 'code is required' });
      }
      if (!value.redirect_uri) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['redirect_uri'],
          message: 'redirect_uri is required',
        });
      }
      if (!value.code_verifier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['code_verifier'],
          message: 'code_verifier is required',
        });
      }
      if (!value.external_organization_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['external_organization_id'],
          message: 'external_organization_id is required',
        });
      }
    } else if (!value.refresh_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refresh_token'],
        message: 'refresh_token is required',
      });
    }
  });

export type OAuthTokenBody = z.infer<typeof oauthTokenBodySchema>;

export const oauthRevokeBodySchema = z
  .object({
    token: z.string().min(16).max(512),
    client_id: z.string().trim().min(8).max(64),
    client_secret: z.string().min(16).max(512),
    token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  })
  .strict();

export type OAuthRevokeBody = z.infer<typeof oauthRevokeBodySchema>;

export const integrationEmployeeMatchSchema = z
  .object({
    externalEmployeeId: externalId,
    email: externalEmail,
    // Partner assertion only. It is retained for protocol compatibility but is
    // never treated as proof: every link requires owner/admin approval.
    emailVerified: z.boolean(),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type IntegrationEmployeeMatchInput = z.infer<typeof integrationEmployeeMatchSchema>;

export const integrationEmployeeMatchBatchSchema = z
  .object({
    employees: z.array(integrationEmployeeMatchSchema).min(1).max(100),
  })
  .strict();

export type IntegrationEmployeeMatchBatchInput = z.infer<
  typeof integrationEmployeeMatchBatchSchema
>;

export const integrationEmployeeListQuerySchema = paginationSchema.extend({
  externalEmployeeId: externalId.optional(),
});

export type IntegrationEmployeeListQuery = z.infer<typeof integrationEmployeeListQuerySchema>;

export const integrationStatusQuerySchema = z.object({
  externalEmployeeId: externalId,
});

export const integrationSessionHistoryQuerySchema = dateRangeSchema(366).and(
  paginationSchema.extend({
    externalEmployeeId: externalId.optional(),
  }),
);

export const integrationSummaryQuerySchema = dateRangeSchema(366).and(
  z.object({
    externalEmployeeId: externalId.optional(),
    period: z.enum(['daily', 'monthly']).default('daily'),
  }),
);

export const integrationIdleQuerySchema = dateRangeSchema(92).and(
  z.object({
    externalEmployeeId: externalId.optional(),
  }),
);

export type IntegrationStatusQuery = z.infer<typeof integrationStatusQuerySchema>;
export type IntegrationSessionHistoryQuery = z.infer<
  typeof integrationSessionHistoryQuerySchema
>;
export type IntegrationSummaryQuery = z.infer<typeof integrationSummaryQuerySchema>;
export type IntegrationIdleQuery = z.infer<typeof integrationIdleQuerySchema>;

// externalEmployeeId is required (not optional, unlike the attendance queries above): this phase
// only reads one explicitly mapped employee's own leave data, never an organisation-wide listing.
export const integrationLeaveBalanceQuerySchema = z.object({
  externalEmployeeId: externalId,
  leaveTypeId: z.string().uuid().optional(),
});

export const integrationLeaveRequestListQuerySchema = paginationSchema.extend({
  externalEmployeeId: externalId,
  leaveTypeId: z.string().uuid().optional(),
  status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export type IntegrationLeaveBalanceQuery = z.infer<typeof integrationLeaveBalanceQuerySchema>;
export type IntegrationLeaveRequestListQuery = z.infer<
  typeof integrationLeaveRequestListQuerySchema
>;

// Required externalEmployeeId, same reasoning as the leave queries above: this phase only reads one
// explicitly mapped employee's own applicable holiday calendar, never an organisation-wide listing
// that could include holidays scoped to other employees.
export const integrationHolidayListQuerySchema = dateRangeSchema(366).and(
  z.object({
    externalEmployeeId: externalId,
  }),
);

export type IntegrationHolidayListQuery = z.infer<typeof integrationHolidayListQuerySchema>;

// Required externalEmployeeId, same reasoning as the other self-only queries above. from/to are
// optional filters (not a mandatory range) to mirror WorkZen's own attendanceCorrectionListQuerySchema.
export const integrationCorrectionListQuerySchema = paginationSchema
  .extend({
    externalEmployeeId: externalId,
    status: z.enum(CORRECTION_STATUSES).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must be on or after from' });
    }
  });

export type IntegrationCorrectionListQuery = z.infer<typeof integrationCorrectionListQuerySchema>;

export const integrationConnectionListQuerySchema = paginationSchema.extend({
  status: z.enum(['ACTIVE', 'DISCONNECTED', 'REVOKED']).optional(),
});

export const integrationConnectionParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  connectionId: z.string().uuid('Connection ID must be a valid UUID'),
});

export const integrationMappingListQuerySchema = paginationSchema.extend({
  status: z.enum(INTEGRATION_EMPLOYEE_MAPPING_STATUSES).optional(),
  externalEmployeeId: externalId.optional(),
});

export const integrationMappingParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  connectionId: z.string().uuid('Connection ID must be a valid UUID'),
  mappingId: z.string().uuid('Mapping ID must be a valid UUID'),
});

export const createIntegrationMappingSchema = z
  .object({
    externalEmployeeId: externalId,
    externalEmployeeEmail: externalEmail.optional(),
    workzenUserId: z.string().uuid('workzenUserId must be a valid UUID'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateIntegrationMappingInput = z.infer<typeof createIntegrationMappingSchema>;

export const resolveIntegrationMappingSchema = z
  .object({
    action: z.enum(['LINK', 'REJECT', 'REVOKE']),
    workzenUserId: z.string().uuid('workzenUserId must be a valid UUID').optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'LINK' && !value.workzenUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workzenUserId'],
        message: 'workzenUserId is required when linking a mapping',
      });
    }
  });

export type ResolveIntegrationMappingInput = z.infer<typeof resolveIntegrationMappingSchema>;

export const createWebhookSubscriptionSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
    description: z.string().trim().max(200).optional(),
    eventTypes: z.array(z.enum(INTEGRATION_WEBHOOK_EVENT_TYPES)).min(1).max(20),
  })
  .strict();

export type CreateWebhookSubscriptionInput = z.infer<typeof createWebhookSubscriptionSchema>;

export const updateWebhookSubscriptionSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    eventTypes: z.array(z.enum(INTEGRATION_WEBHOOK_EVENT_TYPES)).min(1).max(20).optional(),
    status: z.enum(INTEGRATION_WEBHOOK_SUBSCRIPTION_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export type UpdateWebhookSubscriptionInput = z.infer<typeof updateWebhookSubscriptionSchema>;

export const webhookSubscriptionParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  connectionId: z.string().uuid('Connection ID must be a valid UUID'),
  subscriptionId: z.string().uuid('Subscription ID must be a valid UUID'),
});

export const webhookDeliveryListQuerySchema = paginationSchema.extend({
  status: z.enum(INTEGRATION_WEBHOOK_DELIVERY_STATUSES).optional(),
});

export const webhookDeliveryParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  connectionId: z.string().uuid('Connection ID must be a valid UUID'),
  deliveryId: z.string().uuid('Delivery ID must be a valid UUID'),
});

/** Integration-token variants of webhook management routes. */
export const integrationWebhookParamsSchema = z.object({
  subscriptionId: z.string().uuid('Subscription ID must be a valid UUID'),
});

export const integrationWebhookDeliveryParamsSchema = z.object({
  deliveryId: z.string().uuid('Delivery ID must be a valid UUID'),
});

export const integrationWebhookListQuerySchema = paginationSchema;

// --- Viewer links (live screens) ---------------------------------------------------------------

const viewerLinkText = z.string().trim().min(1).max(200);

/** The external user is identified by the integration's own id. The label is display text only. */
export const integrationViewerLinkRequestBodySchema = z
  .object({
    externalUserId: viewerLinkText,
    externalUserLabel: viewerLinkText,
    externalOrganizationLabel: viewerLinkText,
    // base64url(SHA-256(verifier)): exactly 43 characters.
    codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'code challenge must be a base64url SHA-256'),
  })
  .strict();

export const integrationViewerLinkRequestParamsSchema = z.object({
  requestId: z.string().uuid('Request ID must be a valid UUID'),
});

export const integrationViewerLinkCompleteBodySchema = z
  .object({
    codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'code verifier is not valid'),
  })
  .strict();

export const integrationViewerLinkUserParamsSchema = z.object({
  externalUserId: viewerLinkText,
});

// The approval page URL carries only the request id. The one-time nonce is in the URL fragment and is
// exchanged by POST, so it is never part of a query string.
export const viewerLinkApproveQuerySchema = z.object({ request: z.string().uuid() }).strip();

export const viewerLinkOpenBodySchema = z
  .object({
    request_id: z.string().uuid(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
  })
  .strict();

export const viewerLinkLoginBodySchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024),
    request_id: z.string().uuid(),
    _csrf: z.string().min(1).max(256),
  })
  .strict();

export const viewerLinkDecisionBodySchema = z
  .object({
    _csrf: z.string().min(1).optional(),
    request_id: z.string().uuid(),
    decision: z.enum(['approve', 'deny']),
  })
  .strict();

export const integrationViewerLinkManageParamsSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  linkId: z.string().uuid('Link ID must be a valid UUID'),
});

// --- Live screens (integration API) -------------------------------------------------------------

export const integrationLiveActorQuerySchema = z.object({ externalUserId: viewerLinkText }).strict();

export const integrationLiveActorBodySchema = z.object({ externalUserId: viewerLinkText }).strict();

export const integrationLiveStartBodySchema = z
  .object({ externalUserId: viewerLinkText, externalEmployeeId: viewerLinkText })
  .strict();

export const integrationLiveSessionParamsSchema = z.object({
  sessionId: z.string().uuid('Session ID must be a valid UUID'),
});
