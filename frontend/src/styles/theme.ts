import { StyleSheet, Platform } from 'react-native';

export interface ThemePalette {
  isDark: boolean;
  bgDark: string;
  cardBg: string;
  cardBgGlass: string;
  borderDark: string;
  borderLight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentPrimary: string;
  accentPrimaryGlow: string;
  accentCyan: string;
  accentGreen: string;
  accentGreenBg: string;
  accentRed: string;
  accentRedDark: string;
  accentRedBg: string;
  accentOrange: string;
  indigoBg: string;
  indigoBorder: string;
  indigoText: string;

  // Map-specific dynamic tokens
  mapStyleUrl: string;
  mapRouteColor: string;
  mapRouteColorEmergency: string;
  mapGeofenceFill: string;
  mapGeofenceOutline: string;
  mapOverlayGlass: string;
  mapControlBtnBg: string;
  mapControlBtnBorder: string;
  mapControlBtnText: string;
  mapMarkerTitleBg: string;
  mapMarkerTitleBorder: string;
  mapMarkerTitleText: string;
}

export const THEME_PALETTES: { dark: ThemePalette; light: ThemePalette } = {
  dark: {
    isDark: true,
    bgDark: '#0F172A',
    cardBg: '#1E293B',
    cardBgGlass: 'rgba(15, 23, 42, 0.92)',
    borderDark: '#334155',
    borderLight: '#475569',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    accentPrimary: '#2563EB',
    accentPrimaryGlow: '#3B82F6',
    accentCyan: '#38BDF8',
    accentGreen: '#10B981',
    accentGreenBg: '#065F46',
    accentRed: '#EF4444',
    accentRedDark: '#991B1B',
    accentRedBg: '#7F1D1D',
    accentOrange: '#F59E0B',
    indigoBg: '#312E81',
    indigoBorder: '#4F46E5',
    indigoText: '#C7D2FE',

    mapStyleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    mapRouteColor: '#38BDF8',
    mapRouteColorEmergency: '#EF4444',
    mapGeofenceFill: 'rgba(16, 185, 129, 0.20)',
    mapGeofenceOutline: '#10B981',
    mapOverlayGlass: 'rgba(15, 23, 42, 0.88)',
    mapControlBtnBg: '#1E293B',
    mapControlBtnBorder: '#334155',
    mapControlBtnText: '#F8FAFC',
    mapMarkerTitleBg: '#0F172A',
    mapMarkerTitleBorder: '#38BDF8',
    mapMarkerTitleText: '#F8FAFC',
  },
  light: {
    isDark: false,
    bgDark: '#F1F5F9',
    cardBg: '#FFFFFF',
    cardBgGlass: 'rgba(255, 255, 255, 0.94)',
    borderDark: '#CBD5E1',
    borderLight: '#E2E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    accentPrimary: '#2563EB',
    accentPrimaryGlow: '#3B82F6',
    accentCyan: '#0284C7',
    accentGreen: '#059669',
    accentGreenBg: '#D1FAE5',
    accentRed: '#DC2626',
    accentRedDark: '#991B1B',
    accentRedBg: '#FEE2E2',
    accentOrange: '#D97706',
    indigoBg: '#E0E7FF',
    indigoBorder: '#6366F1',
    indigoText: '#3730A3',

    mapStyleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    mapRouteColor: '#2563EB',
    mapRouteColorEmergency: '#DC2626',
    mapGeofenceFill: 'rgba(16, 185, 129, 0.22)',
    mapGeofenceOutline: '#059669',
    mapOverlayGlass: 'rgba(255, 255, 255, 0.92)',
    mapControlBtnBg: '#FFFFFF',
    mapControlBtnBorder: '#CBD5E1',
    mapControlBtnText: '#0F172A',
    mapMarkerTitleBg: '#FFFFFF',
    mapMarkerTitleBorder: '#2563EB',
    mapMarkerTitleText: '#0F172A',
  },
};

export const COLORS = THEME_PALETTES.dark;


export const globalStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 60,
  },
  scrollContentCenter: {
    padding: 24,
    paddingBottom: 60,
    flexGrow: 1,
    justifyContent: 'center',
  },
  banner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 20,
    right: 20,
    padding: 16,
    borderRadius: 12,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  bannerError: {
    backgroundColor: COLORS.accentRedDark,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.accentRed,
  },
  bannerSuccess: {
    backgroundColor: COLORS.accentGreenBg,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.accentGreen,
  },
  bannerText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.cardBg,
    marginRight: 16,
  },
  backButtonText: {
    color: COLORS.accentCyan,
    fontWeight: '600',
    fontSize: 14,
  },
  subTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  miniLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 10,
  },
  formCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.bgDark,
    color: COLORS.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  primaryButton: {
    backgroundColor: COLORS.accentPrimary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.accentPrimaryGlow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  primaryButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.borderDark,
    marginBottom: 24,
  },
  secondaryButtonText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    backgroundColor: COLORS.bgDark,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: '#475569',
  },
  tabButtonText: {
    color: COLORS.textMuted,
    fontWeight: '600',
    fontSize: 14,
  },
  tabButtonTextActive: {
    color: COLORS.accentCyan,
  },
});
