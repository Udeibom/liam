/**
 * LIAN design system colors
 * Dark, premium skin-care aesthetic
 */
export const Colors = {
  // Brand
  primary: '#C8A97E',       // warm gold — main CTA, highlights
  primaryLight: '#E5D4B8',  // lighter gold for subtle accents
  primaryDark: '#9E7C50',   // deeper gold for pressed states

  // Backgrounds
  bg: '#0F1923',            // deep navy-black — main background
  bgCard: '#1A2535',        // card surface
  bgElevated: '#243044',    // modals, sheets
  bgInput: '#1E2C3D',       // input fields

  // Text
  textPrimary: '#F5F0EB',   // near-white warm
  textSecondary: '#9AA5B4', // muted text
  textTertiary: '#5E6E82',  // placeholder, disabled
  textInverse: '#0F1923',   // text on light backgrounds

  // Semantic
  success: '#4CAF7D',
  successBg: '#1A3329',
  warning: '#F0A500',
  warningBg: '#2D2410',
  error: '#E05C5C',
  errorBg: '#2D1A1A',
  info: '#4A9EE0',
  infoBg: '#162535',

  // Skin concern severity
  concernHigh: '#E05C5C',
  concernMedium: '#F0A500',
  concernLow: '#4CAF7D',
  concernNone: '#5E6E82',

  // Verdict badges
  verdictGood: '#4CAF7D',
  verdictCaution: '#F0A500',
  verdictBad: '#E05C5C',

  // Borders
  border: '#243044',
  borderSubtle: '#1A2535',

  // Overlays
  overlay: 'rgba(15, 25, 35, 0.85)',
  overlayLight: 'rgba(15, 25, 35, 0.5)',

  // Gradients (start/end pairs used with LinearGradient)
  gradientGold: ['#C8A97E', '#9E7C50'],
  gradientDark: ['#1A2535', '#0F1923'],
} as const;

export type ColorKey = keyof typeof Colors;
