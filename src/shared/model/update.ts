export type UpdateState =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** Version discovered on the update feed once a check has completed. */
  version?: string;
  /** 0-100 while `state` is `downloading`. */
  percent?: number;
  message?: string;
  /** Whether the running build can check for updates at all (packaged + a supported platform). */
  supported: boolean;
}

export interface AppInfo {
  version: string;
  packaged: boolean;
  platform: NodeJS.Platform;
}
