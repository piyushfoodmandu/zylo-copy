// Hex mirrors of the tokens in global.css. React Native props that take a raw
// colour (icon tint, placeholder, activity indicator) cannot read Tailwind
// classes, so they read from here instead of hardcoding values per call site.
export const color = {
  ink950: '#0b0a12',
  ink800: '#2b2933',
  ink600: '#56545f',
  ink400: '#8b8994',
  fillSoft: '#fafafb',
  fill: '#f4f4f6',
  fillStrong: '#eaeaef',
  line: '#e5e5ea',
  lineStrong: '#cbcad3',
  arro500: '#e2477e',
  arro600: '#cc2963',
  arro700: '#a81c4d',
  positive: '#0a6c3d',
  warning: '#8a5a00',
  danger: '#a81f1f',
  white: '#ffffff'
} as const
