import { extractPasscode } from '../passcode-window';

describe('extractPasscode', () => {
  const uaaPage = [
    'Cloud Foundry',
    'Temporary Authentication Code',
    '',
    'Please copy this code and paste it into the CLI when prompted.',
    '',
    'vVzWZKuFAy',
    '',
    'Sign out',
  ].join('\n');

  const table: [string, string, string | undefined][] = [
    ['UAA passcode page', uaaPage, 'vVzWZKuFAy'],
    ['windows line endings', uaaPage.replace(/\n/g, '\r\n'), 'vVzWZKuFAy'],
    [
      'inline "code is:" form',
      'Temporary Authentication Code\nYour code is: Ab12Cd34\n',
      'Ab12Cd34',
    ],
    ['IdP login page (no heading)', 'Sign in\nUser\nPassword\nABCDEFGH12\n', undefined],
    [
      'heading without a code',
      'Temporary Authentication Code\nPlease wait while we redirect you.\n',
      undefined,
    ],
    ['code with dashes', 'Temporary Authentication Code\n\nab-CD_ef-12\n', 'ab-CD_ef-12'],
    [
      'too short candidate ignored',
      'Temporary Authentication Code\nabc\nlonger-token-1\n',
      'longer-token-1',
    ],
    ['empty text', '', undefined],
  ];

  it.each(table)('%s', (_name, text, expected) => {
    expect(extractPasscode(text)).toBe(expected);
  });
});
