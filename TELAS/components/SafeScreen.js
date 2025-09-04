import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// SafeArea sem topo e sem bottom por padrão. Fundo transparente (evita “faixa branca”).
export function SafeScreen({ style, children, edges = ['left', 'right'] }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: 'transparent' }, style]}>
      {children}
    </SafeAreaView>
  );
}

// Só o Scroll recebe espaço extra no fim (insets.bottom + extraBottom)
SafeScreen.Scroll = function SafeScroll({ contentContainerStyle, extraBottom = 96, children, ...props }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        { paddingBottom: (insets?.bottom ?? 0) + extraBottom },
        contentContainerStyle,
      ]}
      {...props}
    >
      {children}
    </ScrollView>
  );
};

SafeScreen.BottomSpacer = function BottomSpacer({ extra = 96 }) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: (insets?.bottom ?? 0) + extra }} />;
};