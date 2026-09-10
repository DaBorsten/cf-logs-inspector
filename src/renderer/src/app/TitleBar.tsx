import * as React from 'react';
import { Monitor, Moon, PanelLeft, Settings, Sun } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher';
import { useUiStore, type Theme } from '../store/ui';

export function TitleBar(): React.JSX.Element {
  const toggleSidePanel = useUiStore((s) => s.toggleSidePanel);
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-card px-2">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleSidePanel}
        aria-label="Toggle side panel"
        title="Toggle side panel"
      >
        <PanelLeft />
      </Button>
      <span className="text-sm font-semibold tracking-tight">cf-log-inspector</span>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <WorkspaceSwitcher />
      <div className="flex-1" />
      <ThemeMenu />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        title="Settings (coming later)"
        disabled
      >
        <Settings />
      </Button>
    </header>
  );
}

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> },
  { value: 'system', label: 'System', icon: <Monitor /> },
];

function ThemeMenu(): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[2]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme" title={`Theme: ${current.label}`}>
          {current.icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuCheckboxItem
            key={t.value}
            checked={theme === t.value}
            onCheckedChange={() => setTheme(t.value)}
          >
            {t.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
