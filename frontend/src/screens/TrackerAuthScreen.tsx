import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import { globalStyles, COLORS } from '../styles/theme';

interface TrackerAuthScreenProps {
  /** Stable contact handle, e.g. "SC-A3F2B1C9" — shared once in invitation */
  trackerCode: string;
  setTrackerCode: (code: string) => void;
  /** Rotating 6-digit RFC 6238 TOTP from Google Authenticator / Authy */
  totpToken: string;
  setTotpToken: (token: string) => void;
  loading: boolean;
  onVerifyTrackerCode: (accessCode?: string, totpToken?: string) => void;
  onNavigateWelcome: () => void;
}

export const TrackerAuthScreen: React.FC<TrackerAuthScreenProps> = ({
  trackerCode,
  setTrackerCode,
  totpToken,
  setTotpToken,
  loading,
  onVerifyTrackerCode,
  onNavigateWelcome,
}) => {
  return (
    <ScrollView contentContainerStyle={globalStyles.scrollContentCenter}>
      <View style={globalStyles.subHeader}>
        <TouchableOpacity onPress={onNavigateWelcome} style={globalStyles.backButton}>
          <Text style={globalStyles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Image source={require('../../assets/logo.png')} style={globalStyles.miniLogo} />
        <Text style={globalStyles.subTitle}>Safety Tracker Portal</Text>
      </View>

      <View style={globalStyles.formCard}>
        <Text style={styles.trackerIconBig}>🛡️</Text>
        <Text style={styles.trackerTitle}>Secure Access Portal</Text>
        <Text style={styles.formInstructions}>
          Enter your Contact Handle and the current 6-digit code from your authenticator
          app (Google Authenticator or Authy) to establish a secure tracking connection.
        </Text>

        {/* Field 1 — Stable contact handle */}
        <Text style={globalStyles.inputLabel}>Contact Handle</Text>
        <Text style={styles.fieldHint}>
          Shared once in your invitation message (e.g. SC-A3F2B1C9)
        </Text>
        <TextInput
          placeholder="SC-XXXXXXXX"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="characters"
          maxLength={11}
          style={[
            globalStyles.input,
            { textAlign: 'center', fontSize: 18, letterSpacing: 4, fontWeight: '700' },
          ]}
          value={trackerCode}
          onChangeText={setTrackerCode}
        />

        {/* Field 2 — RFC 6238 rotating TOTP */}
        <Text style={[globalStyles.inputLabel, { marginTop: 16 }]}>Authentication Code</Text>
        <Text style={styles.fieldHint}>
          6-digit rotating code from Google Authenticator / Authy — valid for 30 seconds
        </Text>
        <TextInput
          placeholder="000000"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="numeric"
          maxLength={6}
          style={[
            globalStyles.input,
            { textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: 'bold' },
          ]}
          value={totpToken}
          onChangeText={setTotpToken}
        />

        <TouchableOpacity
          style={[
            globalStyles.primaryButton,
            { backgroundColor: COLORS.accentGreen },
            loading && globalStyles.disabledButton,
          ]}
          onPress={() => onVerifyTrackerCode(trackerCode, totpToken)}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={globalStyles.primaryButtonText}>Establish Tracking Connection</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.securityNote}>
          🔐 RFC 6238 TOTP · 30-second rotating token · Time-window validated
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  trackerIconBig: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  trackerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 10,
  },
  formInstructions: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
    lineHeight: 20,
    textAlign: 'center',
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 6,
    marginTop: -4,
  },
  securityNote: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 16,
    opacity: 0.7,
  },
});
