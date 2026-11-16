import { ConvexAuthProvider, type TokenStorage } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { Tabs, type ErrorBoundaryProps } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSync } from '@/hooks/use-sync';
import { createSchema } from '@/lib/outbox';
import { usePalette } from '@/theme';

// Written to .env.local by `npx convex dev`.
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) throw new Error('EXPO_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` once to create .env.local.');

const convex = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });

// The anonymous user's tokens live in the keychain / keystore, so the same install keeps the same user.
const secureStorage: TokenStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <SQLiteProvider databaseName="soundmap.db" onInit={createSchema}>
        <Sync />
        <AppTabs />
      </SQLiteProvider>
    </ConvexAuthProvider>
  );
}

/** Shown by Expo Router instead of a blank screen when rendering throws. "Try again" renders the app again. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = usePalette();
  console.warn('[layout] render failed', error);
  return (
    <View style={[styles.error, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorText, { color: colors.ink }]}>Something went wrong.</Text>
      <Pressable onPress={retry} style={({ pressed }) => [styles.retry, { backgroundColor: colors.accent }, pressed && { opacity: 0.7 }]}>
        <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

function Sync() {
  useSync();
  return null;
}

function AppTabs() {
  const colors = usePalette();
  return (
    <>
      <StatusBar style="auto" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.track },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={{ ios: 'map', android: 'map' }} tintColor={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="measure"
          options={{
            title: 'Measure',
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={{ ios: 'waveform', android: 'graphic_eq' }} tintColor={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="about"
          options={{
            title: 'About',
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={{ ios: 'info.circle', android: 'info' }} tintColor={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 28 },
  errorText: { fontSize: 17, fontWeight: '500' },
  retry: { height: 48, borderRadius: 24, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  retryLabel: { fontSize: 16, fontWeight: '600' },
});
