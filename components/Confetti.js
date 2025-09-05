import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

// Componente simples de confete (lightweight) para não depender de libs nativas.
// Corrige bug anterior: uso de variáveis não declaradas (count, colors, duration, fallSpeed, style)
// e caractere 'z' solto no final que causava ReferenceError no Hermes.

const { width, height } = Dimensions.get('window');

export function Confetti({
  count = 80,
  duration = 4000,        // ms totais da animação de queda
  fallSpeed = 1,          // multiplicador da velocidade
  colors = ['#e67e22', '#2ecc71', '#3498db', '#ffd166', '#e74c3c', '#9b59b6'],
  style,
}) {
  // Memo simples: só cria peças uma vez
  const pieces = useRef(
    Array.from({ length: count }).map(() => ({
      x: Math.random() * width,
      delay: Math.random() * 600,
      rotate: new Animated.Value(0),
      fall: new Animated.Value(0),
      scale: 0.5 + Math.random() * 0.9,
      color: colors[Math.floor(Math.random() * colors.length)],
      wobbleAmp: 12 + Math.random() * 18,
    }))
  ).current;

  useEffect(() => {
    pieces.forEach(p => {
      Animated.parallel([
        Animated.timing(p.fall, {
          toValue: 1,
          duration: duration * fallSpeed,
          delay: p.delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.timing(p.rotate, {
            toValue: 1,
            duration: 1200 + Math.random() * 1200,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        ),
      ]).start();
    });
  }, [pieces, duration, fallSpeed]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {pieces.map((p, i) => {
        const translateY = p.fall.interpolate({
          inputRange: [0, 1],
            outputRange: [-40, height + 40],
        });
        const rotate = p.rotate.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        });
        // Pequena oscilação lateral usando seno aproximado via interpolação
        const wobble = p.fall.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, p.wobbleAmp, 0],
        });
        // Simples combinação de posições
        const translateX = Animated.add(new Animated.Value(p.x), wobble);

        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: 8,
              height: 14,
              borderRadius: 2,
              backgroundColor: p.color,
              transform: [
                { translateX },
                { translateY },
                { rotate },
                { scale: p.scale },
              ],
              opacity: p.fall.interpolate({
                inputRange: [0, 0.05, 0.85, 1],
                outputRange: [0, 1, 1, 0],
              }),
            }}
          />
        );
      })}
    </View>
  );
}

export default Confetti;