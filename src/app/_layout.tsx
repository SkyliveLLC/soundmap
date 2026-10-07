import { ConvexAuthProvider, type TokenStorage } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { Tabs } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';

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
      </Tabs>
    </>
  );
}
