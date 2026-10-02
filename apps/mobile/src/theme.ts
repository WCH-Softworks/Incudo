/**
 * Colours for the phone's light and dark schemes, as tokens, so a screen names what a colour is for and never a value.
 * Plain on purpose: no artwork, no brand colour (the logo's tile is an open design decision; see `brand/`).
 */

import { useColorScheme } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  danger: string;
}

const light: Palette = {
  background: '#ffffff',
  surface: '#f3f3f5',
  text: '#1b1b1f',
  muted: '#5d5d66',
  border: '#d9d9de',
  accent: '#2f5fb3',
  danger: '#b3261e',
};

const dark: Palette = {
  background: '#121214',
  surface: '#1e1e22',
  text: '#ececf0',
  muted: '#a3a3ad',
  border: '#34343a',
  accent: '#8fb2ff',
  danger: '#ffb4ab',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
