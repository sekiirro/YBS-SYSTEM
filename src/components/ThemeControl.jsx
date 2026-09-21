import React from 'react';
import { Clock3, Sun, Moon } from 'lucide-react';
import { useYbsTheme } from '@/components/ThemeProvider';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';

export default function ThemeControl() {
  // Temporarily hidden: the app is locked to Night only and exposes no
  // Auto/Day/Night switcher. Kept mounted (renders nothing) at its existing
  // call sites so it can be re-enabled by removing this early return.
  return null;
  const { mode, theme, selectMode } = useYbsTheme();
  const Icon = mode === 'auto' ? Clock3 : theme === 'day' ? Sun : Moon;
  const label = `Theme: ${mode === 'auto' ? `Auto (${theme})` : mode}. Change theme`;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary" aria-label={label} title={label}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-40">
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={selectMode}>
        <DropdownMenuRadioItem value="auto" className="min-h-11 gap-2"><Clock3 size={16} /> Auto</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="day" className="min-h-11 gap-2"><Sun size={16} /> Day</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="night" className="min-h-11 gap-2"><Moon size={16} /> Night</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
