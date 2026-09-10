/** Cloud Foundry v3 resources as exposed to the renderer (trimmed to what the UI needs). */

export interface CfEndpoints {
  /** Normalised API root, e.g. `https://api.cf.eu10.hana.ondemand.com`. */
  api: string;
  uaa: string;
  login: string;
  logCache: string;
  cloudControllerV3: string;
}

export interface CfOrg {
  guid: string;
  name: string;
}

export interface CfSpace {
  guid: string;
  name: string;
  orgGuid: string;
}

export interface CfApp {
  guid: string;
  name: string;
  spaceGuid: string;
  /** `STARTED` | `STOPPED` (kept open for future values). */
  state: string;
}
