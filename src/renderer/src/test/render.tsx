/** Test helpers: install the mock backend, reset UI state, render inside providers. */
import * as React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { installMockApi, type MockApi, type MockState } from '../api/mock/mock-api';
import { createQueryClient, Providers } from '../app/Providers';
import { useUiStore } from '../store/ui';

export function setupMock(init: Partial<MockState> = {}): MockApi {
  useUiStore.setState({
    theme: 'light',
    sidePanelTab: 'connections',
    sidePanelOpen: true,
    loginConnectionId: null,
    connectionEditor: null,
    workspaceDialogOpen: false,
  });
  window.localStorage.clear();
  return installMockApi(init);
}

export function renderWithProviders(ui: React.ReactElement): RenderResult {
  return render(<Providers client={createQueryClient()}>{ui}</Providers>);
}

type ConnectionProfile = import('@shared/model/connection').ConnectionProfile;
type ConnectionOverrides = { [K in keyof ConnectionProfile]?: ConnectionProfile[K] | undefined };

/** Sample profile; pass `undefined` for a key to remove it (e.g. `{ username: undefined }`). */
export function sampleConnection(over: ConnectionOverrides = {}): ConnectionProfile {
  const merged: Record<string, unknown> = {
    id: 'conn-1',
    name: 'EU10',
    apiUrl: 'https://api.cf.eu10.hana.ondemand.com',
    region: 'eu10',
    authMode: 'password',
    username: 'alice',
    skipSslValidation: false,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as unknown as ConnectionProfile;
}
