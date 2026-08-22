/**
 * Integration Services Index
 * Export all integration-specific services from here
 */

export {
  DentallyService,
  syncDentallyTreatments,
  syncDentallyCategories,
  syncDentallyTreatmentsOnly,
  syncDentallyPractitioners,
  syncDentallyLocations,
  mapTreatmentsToCategories
} from './dentallyService';

export {
  XeroService,
  getXeroCredentials,
  createXeroService,
  // Platform Integration Organizations
  getXeroOrganizations,
  getSelectedXeroOrganization,
  selectXeroOrganization,
  refreshXeroOrganizations,
} from './xeroService';

export type {
  XeroCredentials,
  XeroTokenResponse,
  XeroTenant,
  XeroApiResponse,
  PlatformIntegrationOrganization,
} from './xeroService';

export {
  GA4Service,
  getGA4Credentials,
  createGA4Service,
  getGA4Properties,
  getSelectedGA4Property,
  selectGA4Property,
  disconnectGA4,
} from './ga4Service';

export type {
  GA4Credentials,
  GA4TokenResponse,
  GA4Property,
  GA4ApiResponse,
  GA4Campaign,
  GA4GeographicROI,
  GA4ChannelMix,
  GA4LeadTrend,
} from './ga4Service';

export {
  IplicitService,
} from './iplicitService';

export type {
  IplicitSessionResponse,
  IplicitCredentials,
  IplicitAccount,
} from './iplicitService';
