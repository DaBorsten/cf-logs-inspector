import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CfEndpoints } from '@shared/model/cf';
import type { AuthMode, ConnectionInput, ConnectionProfile } from '@shared/model/connection';
import { BTP_REGIONS, btpApiUrl, btpRegionFromApiUrl } from '@shared/regions';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { DialogFooter } from '../../components/ui/dialog';
import { ErrorText, Field, Label } from '../../components/ui/field';
import { Input, NativeSelect, Textarea } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { useSaveConnection, useTestConnection } from '../../queries/connections';

type TargetMode = 'region' | 'custom';

interface FormState {
  name: string;
  targetMode: TargetMode;
  region: string;
  apiUrl: string;
  authMode: AuthMode;
  origin: string;
  username: string;
  skipSslValidation: boolean;
  caCertPem: string;
}

const AUTH_MODES: { value: AuthMode; label: string; hint: string }[] = [
  { value: 'password', label: 'Username and password', hint: 'Default UAA login (cf login).' },
  {
    value: 'origin',
    label: 'Username and password via custom identity provider',
    hint: 'Sends the origin key as login_hint (cf login --origin).',
  },
  {
    value: 'passcode',
    label: 'SSO / one-time passcode',
    hint: 'Opens the login page in a window and reads the temporary code (cf login --sso).',
  },
];

function initialState(initial?: ConnectionProfile): FormState {
  const region = initial ? btpRegionFromApiUrl(initial.apiUrl) : undefined;
  return {
    name: initial?.name ?? '',
    targetMode: initial && !region ? 'custom' : 'region',
    region: region ?? initial?.region ?? 'eu10',
    apiUrl: initial && !region ? initial.apiUrl : '',
    authMode: initial?.authMode ?? 'password',
    origin: initial?.origin ?? '',
    username: initial?.username ?? '',
    skipSslValidation: initial?.skipSslValidation ?? false,
    caCertPem: initial?.caCertPem ?? '',
  };
}

function effectiveApiUrl(s: FormState): string {
  return s.targetMode === 'region' ? btpApiUrl(s.region) : s.apiUrl.trim();
}

export function validate(s: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!s.name.trim()) errors.name = 'Name is required';
  if (s.targetMode === 'custom' && !s.apiUrl.trim()) errors.apiUrl = 'API URL is required';
  if (s.authMode === 'origin' && !s.origin.trim())
    errors.origin = 'Origin key is required for this login mode';
  return errors;
}

export function toInput(s: FormState): ConnectionInput {
  const input: ConnectionInput = {
    name: s.name.trim(),
    apiUrl: effectiveApiUrl(s),
    authMode: s.authMode,
    skipSslValidation: s.skipSslValidation,
  };
  if (s.targetMode === 'region') input.region = s.region;
  if (s.authMode === 'origin') input.origin = s.origin.trim();
  if (s.authMode !== 'passcode' && s.username.trim()) input.username = s.username.trim();
  if (s.caCertPem.trim()) input.caCertPem = s.caCertPem.trim();
  return input;
}

const providers = [...new Set(BTP_REGIONS.map((r) => r.provider))];

export interface ConnectionFormProps {
  initial?: ConnectionProfile;
  onSaved: (profile: ConnectionProfile) => void;
  onCancel: () => void;
}

export function ConnectionForm({
  initial,
  onSaved,
  onCancel,
}: ConnectionFormProps): React.JSX.Element {
  const [state, setState] = React.useState<FormState>(() => initialState(initial));
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [advanced, setAdvanced] = React.useState(
    Boolean(initial?.caCertPem || initial?.skipSslValidation),
  );
  const [testResult, setTestResult] = React.useState<CfEndpoints | null>(null);
  const save = useSaveConnection();
  const test = useTestConnection();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setState((s) => ({ ...s, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setTestResult(null);
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const errs = validate(state);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    save.mutate(
      { ...toInput(state), ...(initial ? { id: initial.id } : {}) },
      { onSuccess: onSaved },
    );
  };

  const runTest = (): void => {
    const errs = validate(state);
    if (errs.apiUrl) {
      setErrors(errs);
      return;
    }
    setTestResult(null);
    test.mutate(
      {
        apiUrl: effectiveApiUrl(state),
        skipSslValidation: state.skipSslValidation,
        ...(state.caCertPem.trim() ? { caCertPem: state.caCertPem.trim() } : {}),
      },
      { onSuccess: setTestResult },
    );
  };

  const authHint = AUTH_MODES.find((m) => m.value === state.authMode)?.hint;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-4" noValidate>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-1">
        <Field id="cn-name" label="Name" error={errors.name}>
          <Input
            id="cn-name"
            value={state.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Prod EU10"
            aria-invalid={Boolean(errors.name)}
            autoFocus
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium">Target</legend>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="target"
                checked={state.targetMode === 'region'}
                onChange={() => set('targetMode', 'region')}
              />
              SAP BTP region
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="target"
                checked={state.targetMode === 'custom'}
                onChange={() => set('targetMode', 'custom')}
              />
              Custom API URL
            </label>
          </div>
          {state.targetMode === 'region' ? (
            <Field id="cn-region" label="Region" hint={btpApiUrl(state.region)}>
              <NativeSelect
                id="cn-region"
                value={state.region}
                onChange={(e) => set('region', e.target.value)}
              >
                {providers.map((provider) => (
                  <optgroup key={provider} label={provider}>
                    {BTP_REGIONS.filter((r) => r.provider === provider).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} – {r.location}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <Field
              id="cn-api-url"
              label="API URL"
              hint="The Cloud Controller endpoint, e.g. https://api.sys.example.com"
              error={errors.apiUrl}
            >
              <Input
                id="cn-api-url"
                value={state.apiUrl}
                onChange={(e) => set('apiUrl', e.target.value)}
                placeholder="https://api.example.com"
                aria-invalid={Boolean(errors.apiUrl)}
                spellCheck={false}
              />
            </Field>
          )}
        </fieldset>

        <Field id="cn-auth" label="Login mode" hint={authHint}>
          <NativeSelect
            id="cn-auth"
            value={state.authMode}
            onChange={(e) => set('authMode', e.target.value as AuthMode)}
          >
            {AUTH_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {state.authMode === 'origin' ? (
          <Field
            id="cn-origin"
            label="Identity provider origin key"
            hint="The origin key of the custom IdP configured in the subaccount (e.g. sap.custom, my-idp)."
            error={errors.origin}
          >
            <Input
              id="cn-origin"
              value={state.origin}
              onChange={(e) => set('origin', e.target.value)}
              aria-invalid={Boolean(errors.origin)}
              spellCheck={false}
            />
          </Field>
        ) : null}

        {state.authMode !== 'passcode' ? (
          <Field
            id="cn-user"
            label="Username (optional)"
            hint="Remembered to prefill the login dialog; the password is never stored."
          >
            <Input
              id="cn-user"
              value={state.username}
              onChange={(e) => set('username', e.target.value)}
              autoComplete="username"
              spellCheck={false}
            />
          </Field>
        ) : null}

        <button
          type="button"
          className="flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          {advanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          TLS options
        </button>
        {advanced ? (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="cn-skip-ssl">Skip SSL certificate validation</Label>
                <p className="text-xs text-muted-foreground">
                  Accept any server certificate (like cf api --skip-ssl-validation). Unsafe on
                  untrusted networks.
                </p>
              </div>
              <Switch
                id="cn-skip-ssl"
                checked={state.skipSslValidation}
                onCheckedChange={(v) => set('skipSslValidation', v)}
              />
            </div>
            <Field
              id="cn-ca"
              label="Additional CA certificate (PEM)"
              hint="Appended to the system trust store for this connection only."
            >
              <Textarea
                id="cn-ca"
                value={state.caCertPem}
                onChange={(e) => set('caCertPem', e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                spellCheck={false}
              />
            </Field>
          </div>
        ) : null}

        {test.error ? <ErrorText>{errorMessage(test.error)}</ErrorText> : null}
        {testResult ? (
          <div
            className="rounded-md border border-success/40 bg-success/10 p-2.5 text-xs"
            role="status"
          >
            <p className="font-medium text-success">Endpoint reachable</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <dt className="text-muted-foreground">login</dt>
              <dd className="truncate">{testResult.login}</dd>
              <dt className="text-muted-foreground">log cache</dt>
              <dd className="truncate">{testResult.logCache}</dd>
              <dt className="text-muted-foreground">cc v3</dt>
              <dd className="truncate">{testResult.cloudControllerV3}</dd>
            </dl>
          </div>
        ) : null}
        {save.error ? <ErrorText>{errorMessage(save.error)}</ErrorText> : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={runTest} loading={test.isPending}>
          Test connection
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {initial ? 'Save changes' : 'Add connection'}
        </Button>
      </DialogFooter>
    </form>
  );
}
