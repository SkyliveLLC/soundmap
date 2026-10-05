import { Tabs } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';

import { createSchema } from '@/lib/measurement-store';
import { usePalette } from '@/theme';

export default function RootLayout() {
  const colors = usePalette();
  return (
    <SQLiteProvider databaseName="soundmap.db" onInit={createSchema}>
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
    </SQLiteProvider>
  );
}
