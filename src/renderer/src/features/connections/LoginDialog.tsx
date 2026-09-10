import * as React from 'react';
import { ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import type { ConnectionProfile } from '@shared/model/connection';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ErrorText, Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/misc';
import { hostOf } from '../../lib/utils';
import {
  useConnections,
  useLoginPassword,
  usePasscodeLogin,
  useSaveConnection,
  useStartPasscode,
} from '../../queries/connections';
import { useUiStore } from '../../store/ui';

export function LoginDialog(): React.JSX.Element {
  const connectionId = useUiStore((s) => s.loginConnectionId);
  const close = useUiStore((s) => s.closeLogin);
  const { data: connections } = useConnections();
  const connection = connections?.find((c) => c.id === connectionId);
  const open = Boolean(connectionId && connection);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent size="sm">
        {connection ? (
          <>
            <DialogHeader>
              <DialogTitle>Log in to {connection.name}</DialogTitle>
              <DialogDescription>{hostOf(connection.apiUrl)}</DialogDescription>
            </DialogHeader>
            {connection.authMode === 'passcode' ? (
              <PasscodeLogin key={connection.id} connection={connection} onDone={close} />
            ) : (
              <PasswordLogin key={connection.id} connection={connection} onDone={close} />
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PasswordLogin({
  connection,
  onDone,
}: {
  connection: ConnectionProfile;
  onDone: () => void;
}): React.JSX.Element {
  const [username, setUsername] = React.useState(connection.username ?? '');
  const [password, setPassword] = React.useState('');
  const [origin, setOrigin] = React.useState(connection.origin ?? '');
  const [fieldError, setFieldError] = React.useState<string>();
  const login = useLoginPassword();
  const save = useSaveConnection();
  const isOrigin = connection.authMode === 'origin';

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setFieldError('Username and password are required');
      return;
    }
    if (isOrigin && !origin.trim()) {
      setFieldError('Origin key is required');
      return;
    }
    setFieldError(undefined);
    login.mutate(
      {
        connectionId: connection.id,
        username: username.trim(),
        password,
        ...(isOrigin ? { origin: origin.trim() } : {}),
      },
      {
        onSuccess: (status) => {
          toast.success(
            `Logged in to ${connection.name}${status.username ? ` as ${status.username}` : ''}`,
          );
          // Remember the user name (never the password) for next time.
          if (
            username.trim() !== (connection.username ?? '') ||
            (isOrigin && origin.trim() !== connection.origin)
          ) {
            save.mutate({
              ...connection,
              username: username.trim(),
              ...(isOrigin ? { origin: origin.trim() } : {}),
            });
          }
          onDone();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field id="login-user" label="Username">
        <Input
          id="login-user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus={!connection.username}
          spellCheck={false}
        />
      </Field>
      <Field id="login-pass" label="Password">
        <Input
          id="login-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={Boolean(connection.username)}
        />
      </Field>
      {isOrigin ? (
        <Field id="login-origin" label="Identity provider origin">
          <Input
            id="login-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            spellCheck={false}
          />
        </Field>
      ) : null}
      {fieldError ? <ErrorText>{fieldError}</ErrorText> : null}
      {login.error ? <ErrorText>{errorMessage(login.error)}</ErrorText> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={login.isPending}>
          Log in
        </Button>
      </DialogFooter>
    </form>
  );
}

type PasscodePhase = 'idle' | 'waiting' | 'manual';

function PasscodeLogin({
  connection,
  onDone,
}: {
  connection: ConnectionProfile;
  onDone: () => void;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<PasscodePhase>('idle');
  const [passcode, setPasscode] = React.useState('');
  const [notice, setNotice] = React.useState<string>();
  const start = useStartPasscode();
  const manual = usePasscodeLogin();

  const openWindow = (): void => {
    setNotice(undefined);
    setPhase('waiting');
    start.mutate(connection.id, {
      onSuccess: (result) => {
        if (result.kind === 'loggedIn') {
          toast.success(
            `Logged in to ${connection.name}${result.status.username ? ` as ${result.status.username}` : ''}`,
          );
          onDone();
        } else {
          setPhase('manual');
          setNotice(
            'The login window was closed before a code was detected. Paste the passcode manually.',
          );
        }
      },
      onError: () => setPhase('manual'),
    });
  };

  const submitManual = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!passcode.trim()) return;
    manual.mutate(
      { connectionId: connection.id, passcode: passcode.trim() },
      {
        onSuccess: (status) => {
          toast.success(
            `Logged in to ${connection.name}${status.username ? ` as ${status.username}` : ''}`,
          );
          onDone();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {phase === 'waiting' ? (
        <div
          className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs"
          role="status"
        >
          <Spinner />
          Waiting for the login window… Sign in with your identity provider; the temporary code is
          picked up automatically.
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Single sign-on opens the Cloud Foundry login page in a separate window. After you
          authenticate, the one-time passcode is read from the page and used to log in.
        </p>
      )}
      {notice ? <p className="text-xs text-warning">{notice}</p> : null}
      {start.error ? <ErrorText>{errorMessage(start.error)}</ErrorText> : null}
      <Button onClick={openWindow} loading={phase === 'waiting'} disabled={phase === 'waiting'}>
        <ExternalLink /> Open SSO login window
      </Button>
      {phase !== 'manual' ? (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setPhase('manual')}
        >
          Enter a passcode manually
        </button>
      ) : (
        <form
          onSubmit={submitManual}
          className="flex flex-col gap-2 rounded-md border p-3"
          noValidate
        >
          <Field
            id="login-passcode"
            label="One-time passcode"
            hint="Copy it from the “Temporary Authentication Code” page (<login URL>/passcode)."
          >
            <Input
              id="login-passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="one-time-code"
            />
          </Field>
          {manual.error ? <ErrorText>{errorMessage(manual.error)}</ErrorText> : null}
          <Button
            type="submit"
            variant="secondary"
            loading={manual.isPending}
            disabled={!passcode.trim()}
          >
            <KeyRound /> Log in with passcode
          </Button>
        </form>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </DialogFooter>
    </div>
  );
}
