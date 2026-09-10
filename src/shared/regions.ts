/**
 * SAP BTP Cloud Foundry region catalogue (source: npm package `btpcflogin` v2.0.0, data/regions-data.json).
 * The app also accepts arbitrary API URLs for non-BTP foundations; this list only powers the region picker.
 */

export interface BtpRegion {
  /** Region key as used in the host name, e.g. `eu10` or `eu10-002`. */
  id: string;
  /** Human readable location. */
  location: string;
  /** Infrastructure provider. */
  provider: string;
}

export const BTP_REGIONS: readonly BtpRegion[] = [
  { id: 'ap12', location: 'Asia Pacific (Seoul)', provider: 'Amazon Web Services' },
  { id: 'ap11', location: 'Asia Pacific (Singapore)', provider: 'Amazon Web Services' },
  { id: 'ap10', location: 'Australia (Sydney)', provider: 'Amazon Web Services' },
  { id: 'ap20', location: 'Australia (Sydney)', provider: 'Microsoft Azure' },
  { id: 'ap30', location: 'Australia (Sydney)', provider: 'Google Cloud' },
  { id: 'ap01', location: 'Australia (Sydney)', provider: 'SAP Cloud Infrastructure' },
  { id: 'br10', location: 'Brazil (São Paulo)', provider: 'Amazon Web Services' },
  { id: 'br20', location: 'Brazil (São Paulo)', provider: 'Microsoft Azure' },
  { id: 'br30', location: 'Brazil (São Paulo)', provider: 'Google Cloud' },
  { id: 'ca10', location: 'Canada (Montreal)', provider: 'Amazon Web Services' },
  { id: 'ca20', location: 'Canada Central (Toronto)', provider: 'Microsoft Azure' },
  { id: 'cn20', location: 'China (North 3)', provider: 'Microsoft Azure' },
  { id: 'cn40', location: 'China (Shanghai)', provider: 'Alibaba Cloud' },
  { id: 'eu10', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu10-002', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu10-003', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu10-004', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu10-005', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu11', location: 'Europe (Frankfurt)', provider: 'Amazon Web Services' },
  { id: 'eu22', location: 'Europe (Frankfurt)', provider: 'Microsoft Azure' },
  { id: 'eu30', location: 'Europe (Frankfurt)', provider: 'Google Cloud' },
  {
    id: 'eu01',
    location: 'Europe (Frankfurt) - EU Access Only',
    provider: 'SAP Cloud Infrastructure',
  },
  { id: 'eu13', location: 'Europe (Milan)', provider: 'Amazon Web Services' },
  { id: 'eu20', location: 'Europe (Netherlands)', provider: 'Microsoft Azure' },
  { id: 'eu20-001', location: 'Europe (Netherlands)', provider: 'Microsoft Azure' },
  { id: 'eu20-002', location: 'Europe (Netherlands)', provider: 'Microsoft Azure' },
  { id: 'eu02', location: 'Europe (Rot) - SAP EU Access', provider: 'SAP Cloud Infrastructure' },
  { id: 'in30', location: 'India (Mumbai)', provider: 'Google Cloud' },
  { id: 'il30', location: 'Israel (Tel Aviv)', provider: 'Google Cloud' },
  { id: 'jp10', location: 'Japan (Tokyo)', provider: 'Amazon Web Services' },
  { id: 'jp20', location: 'Japan (Tokyo)', provider: 'Microsoft Azure' },
  { id: 'jp30', location: 'Japan (Osaka)', provider: 'Google Cloud' },
  { id: 'jp31', location: 'Japan (Tokyo)', provider: 'Google Cloud' },
  { id: 'jp01', location: 'Japan (Tokyo)', provider: 'SAP Cloud Infrastructure' },
  { id: 'sa30', location: 'KSA (Dammam - KSA Regulated Customers)', provider: 'Google Cloud' },
  { id: 'sa31', location: 'KSA (Dammam - KSA Non-Regulated Customers)', provider: 'Google Cloud' },
  { id: 'ap21', location: 'Singapore', provider: 'Microsoft Azure' },
  { id: 'ch20', location: 'Switzerland (Zurich)', provider: 'Microsoft Azure' },
  { id: 'ae01', location: 'UAE (Dubai)', provider: 'SAP Cloud Infrastructure' },
  { id: 'uk20', location: 'UK South (London)', provider: 'Microsoft Azure' },
  { id: 'us01', location: 'US (Sterling)', provider: 'SAP Cloud Infrastructure' },
  { id: 'us30', location: 'US Central (IA)', provider: 'Google Cloud' },
  { id: 'us10', location: 'US East (VA)', provider: 'Amazon Web Services' },
  { id: 'us10-001', location: 'US East (VA)', provider: 'Amazon Web Services' },
  { id: 'us10-002', location: 'US East (VA)', provider: 'Amazon Web Services' },
  { id: 'us21', location: 'US East (VA)', provider: 'Microsoft Azure' },
  { id: 'us02', location: 'US West (Colorado)', provider: 'SAP Cloud Infrastructure' },
  { id: 'us11', location: 'US West (Oregon)', provider: 'Amazon Web Services' },
  { id: 'us20', location: 'US West (WA)', provider: 'Microsoft Azure' },
];

/** Regions hosted in mainland China use a different top-level domain. */
const CHINA_DOMAIN_REGIONS = new Set(['cn40']);

/** Domain suffix for the CF API / login hosts of a BTP region. */
export function btpRegionDomain(regionId: string): string {
  return CHINA_DOMAIN_REGIONS.has(regionId) ? 'platform.sapcloud.cn' : 'hana.ondemand.com';
}

/** `https://api.cf.<region>.<domain>` for a BTP region key. */
export function btpApiUrl(regionId: string): string {
  return `https://api.cf.${regionId}.${btpRegionDomain(regionId)}`;
}

/** Reverse lookup: the BTP region key for an API URL, or undefined for non-BTP foundations. */
export function btpRegionFromApiUrl(apiUrl: string): string | undefined {
  const m =
    /^https?:\/\/api\.cf\.([a-z0-9-]+)\.(?:hana\.ondemand\.com|platform\.sapcloud\.cn)(?::\d+)?(?:\/|$)/i.exec(
      apiUrl.trim(),
    );
  return m?.[1]?.toLowerCase();
}
