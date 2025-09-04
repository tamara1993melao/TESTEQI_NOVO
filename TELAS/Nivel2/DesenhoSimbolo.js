import React from 'react';
import Svg, { Line, Circle, Rect, Polyline, Path, Polygon, Ellipse } from 'react-native-svg';

/*
Tipos suportados (39):
- Originais (13): plus, circle, square, ell, angle, tee, wave, circleX, arrow, arc, uArc, zigzag, perp
- Novos (26): diamond, triangle, triangleDown, triangleLeft, triangleRight, pentagon, hexagon, star,
  cross, equal, notEqual, hash, chevronUp, chevronDown, chevronLeft, chevronRight, bracketLeft,
  bracketRight, bolt, heart, moon, infinity, hourglass, bowtie, trapezoid, ellipse
*/

export default function DesenhoSimbolo({ type, size = 60, color = '#fff', stroke = 3 }) {
  const common = { stroke: color, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      {/* Originais */}
      {type === 'plus' && (
        <>
          <Line {...common} x1="30" y1="12" x2="30" y2="48" />
          <Line {...common} x1="12" y1="30" x2="48" y2="30" />
        </>
      )}
      {type === 'circle' && <Circle {...common} cx="30" cy="30" r="18" />}
      {type === 'square' && <Rect {...common} x="14" y="14" width="32" height="32" rx="2" ry="2" />}
      {type === 'ell' && <Polyline {...common} points="18,14 18,46 46,46" />}
      {type === 'angle' && <Polyline {...common} points="42,14 22,30 42,46" />}
      {type === 'tee' && (
        <>
          <Line {...common} x1="16" y1="16" x2="44" y2="16" />
          <Line {...common} x1="30" y1="16" x2="30" y2="46" />
        </>
      )}
      {type === 'wave' && <Path {...common} d="M8 32 C 16 10, 32 54, 40 30 S 58 10, 68 32" />}
      {type === 'circleX' && (
        <>
          <Circle {...common} cx="30" cy="30" r="18" />
          <Line {...common} x1="18" y1="18" x2="42" y2="42" />
          <Line {...common} x1="42" y1="18" x2="18" y2="42" />
        </>
      )}
      {type === 'arrow' && (
        <>
          <Line {...common} x1="14" y1="30" x2="44" y2="30" />
          <Polyline {...common} points="36,22 44,30 36,38" />
        </>
      )}
      {type === 'arc' && <Path {...common} d="M14 38 C 22 18, 38 18, 46 38" />}
      {type === 'uArc' && <Path {...common} d="M14 22 C 22 42, 38 42, 46 22" />}
      {type === 'zigzag' && <Polyline {...common} points="16,18 44,18 16,42 44,42" />}
      {type === 'perp' && (
        <>
          <Line {...common} x1="26" y1="14" x2="26" y2="46" />
          <Line {...common} x1="26" y1="46" x2="46" y2="46" />
        </>
      )}

      {/* Novos */}
      {type === 'diamond' && <Polygon {...common} points="30,12 48,30 30,48 12,30" />}
      {type === 'triangle' && <Polygon {...common} points="30,12 48,46 12,46" />}
      {type === 'triangleDown' && <Polygon {...common} points="12,14 48,14 30,48" />}
      {type === 'triangleLeft' && <Polygon {...common} points="12,30 46,12 46,48" />}
      {type === 'triangleRight' && <Polygon {...common} points="14,12 48,30 14,48" />}
      {type === 'pentagon' && <Polygon {...common} points="30,12 48,24 42,48 18,48 12,24" />}
      {type === 'hexagon' && <Polygon {...common} points="20,12 40,12 50,30 40,48 20,48 10,30" />}
      {type === 'star' && (
        <Polygon
          {...common}
          points="30,12 34,23 46,23 36,30 40,42 30,35 20,42 24,30 14,23 26,23"
        />
      )}
      {type === 'cross' && (
        <>
          <Line {...common} x1="16" y1="16" x2="44" y2="44" />
          <Line {...common} x1="44" y1="16" x2="16" y2="44" />
        </>
      )}
      {type === 'equal' && (
        <>
          <Line {...common} x1="14" y1="22" x2="46" y2="22" />
          <Line {...common} x1="14" y1="38" x2="46" y2="38" />
        </>
      )}
      {type === 'notEqual' && (
        <>
          <Line {...common} x1="14" y1="22" x2="46" y2="22" />
          <Line {...common} x1="14" y1="38" x2="46" y2="38" />
          <Line {...common} x1="18" y1="42" x2="42" y2="18" />
        </>
      )}
      {type === 'hash' && (
        <>
          <Line {...common} x1="22" y1="14" x2="22" y2="46" />
          <Line {...common} x1="38" y1="14" x2="38" y2="46" />
          <Line {...common} x1="14" y1="22" x2="46" y2="22" />
          <Line {...common} x1="14" y1="38" x2="46" y2="38" />
        </>
      )}
      {type === 'chevronUp' && <Polyline {...common} points="16,34 30,20 44,34" />}
      {type === 'chevronDown' && <Polyline {...common} points="16,26 30,40 44,26" />}
      {type === 'chevronLeft' && <Polyline {...common} points="36,16 22,30 36,44" />}
      {type === 'chevronRight' && <Polyline {...common} points="24,16 38,30 24,44" />}
      {type === 'bracketLeft' && <Path {...common} d="M36 14 H24 V46 H36" />}
      {type === 'bracketRight' && <Path {...common} d="M24 14 H36 V46 H24" />}
      {type === 'bolt' && <Polyline {...common} points="26,12 38,28 32,28 36,48 22,32 28,32 26,12" />}
      {type === 'heart' && (
        <Path
          {...common}
          d="M30 46 C 12 34, 14 18, 24 18 C 28 18, 30 21, 30 24 C 30 21, 32 18, 36 18 C 46 18, 48 34, 30 46"
        />
      )}
      {type === 'moon' && (
        <>
          <Path {...common} d="M40 20 A14 14 0 1 1 40 40" />
          <Path {...common} d="M34 22 A10 10 0 1 0 34 38" />
        </>
      )}
      {type === 'infinity' && (
        <Path
          {...common}
          d="M16 30 C 16 20, 28 20, 30 30 C 32 40, 44 40, 44 30 C 44 20, 32 20, 30 30 C 28 40, 16 40, 16 30"
        />
      )}
      {type === 'hourglass' && (
        <>
          <Polyline {...common} points="16,16 44,44" />
          <Polyline {...common} points="44,16 16,44" />
          <Line {...common} x1="16" y1="16" x2="44" y2="16" />
          <Line {...common} x1="16" y1="44" x2="44" y2="44" />
        </>
      )}
      {type === 'bowtie' && (
        <>
          <Polygon {...common} points="16,16 30,30 16,44" />
          <Polygon {...common} points="44,16 30,30 44,44" />
        </>
      )}
      {type === 'trapezoid' && <Polygon {...common} points="18,16 42,16 48,44 12,44" />}
      {type === 'ellipse' && <Ellipse {...common} cx="30" cy="30" rx="20" ry="14" />}
    </Svg>
  );
}