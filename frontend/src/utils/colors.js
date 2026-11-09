// Shared palette for notes and mind maps. Pastel `bg-*-50` is applied as
// the surface color (note card / mindmap node background). Vibrant
// `bg-*-300` is used inside the color-picker swatches. Tailwind only sees
// the literal strings in COLOR_MAP / VIBRANT_COLOR_MAP, which is enough
// to keep the classes in the output bundle (no safelist needed).

export const COLOR_KEYS = [
  'white', 'red', 'orange', 'yellow', 'lime',
  'green', 'teal', 'blue', 'purple', 'pink',
];

export const COLOR_MAP = {
  white: 'bg-surface',
  red: 'bg-red-50',
  orange: 'bg-orange-50',
  yellow: 'bg-yellow-50',
  lime: 'bg-lime-50',
  green: 'bg-green-50',
  teal: 'bg-teal-50',
  blue: 'bg-blue-50',
  purple: 'bg-purple-50',
  pink: 'bg-pink-50',
};

export const VIBRANT_COLOR_MAP = {
  white: 'bg-surface',
  red: 'bg-red-300',
  orange: 'bg-orange-300',
  yellow: 'bg-yellow-300',
  lime: 'bg-lime-300',
  green: 'bg-green-300',
  teal: 'bg-teal-300',
  blue: 'bg-blue-300',
  purple: 'bg-purple-300',
  pink: 'bg-pink-300',
};

// Soft -100 tint for a colored project folder-square (stronger than the -50
// node surface so it reads on a white card). Literal strings so Tailwind keeps
// the classes; no raw hex (DESIGN_SYSTEM §0).
export const TINT_MAP = {
  white: 'bg-surface', red: 'bg-red-100', orange: 'bg-orange-100',
  yellow: 'bg-yellow-100', lime: 'bg-lime-100', green: 'bg-green-100',
  teal: 'bg-teal-100', blue: 'bg-blue-100', purple: 'bg-purple-100',
  pink: 'bg-pink-100',
};

export const DEFAULT_NODE_COLOR = 'white';
