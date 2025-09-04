import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export function Confetti(/* props */) {
  const pieces = useRef(
    Array.from({ length: count }).map(() => ({
      x: Math.random() * width,
      delay: Math.random() * 600,
      rotate: new Animated.Value(0),
      fall: new Animated.Value(0),
      scale: 0.6 + Math.random() * 0.8,
      color: colors[Math.floor(Math.random() * colors.length)],
      wobbleAmp: 12 + Math.random() * 18,
      wobbleFreq: 1 + Math.random() * 2,
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
        // wobble lateral
        const wobble = p.fall.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.wobbleAmp],
        });
        const translateX = Animated.add(
          new Animated.Value(p.x),
          Animated.multiply(
            wobble,
            new Animated.Value(Math.random() > 0.5 ? 1 : -1)
          )
        );

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
                inputRange: [0, 0.85, 1],
                outputRange: [0, 1, 0],
              }),
            }}
          />
        );
      })}
    </View>
  );
}z