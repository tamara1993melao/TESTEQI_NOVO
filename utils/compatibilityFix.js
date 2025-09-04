/**
 * Patch global para compatibilidade com engines JavaScript (Hermes/JSC)
 * Resolve problemas com propriedade 'z' ausente em transformações 3D
 */

// Define 'z' globalmente para todos objetos quando não existe
if (global.HermesInternal) {
  console.log('[CompatibilityFix] Aplicando patch Hermes para propriedade z');
  Object.defineProperty(Object.prototype, 'z', {
    get: function() { return this._z || 0; },
    set: function(value) { this._z = value; },
    configurable: true,
    enumerable: false
  });
}

// Função para garantir que um objeto tem propriedade 'z'
export function ensureZ(obj) {
  if (obj && typeof obj === 'object' && !('z' in obj)) {
    obj.z = 0;
  }
  return obj;
}

// Corrige transformações que usam rotateZ
export function fixTransform(transforms) {
  if (!transforms || !Array.isArray(transforms)) return transforms;
  
  return transforms.map(transform => {
    // Se tem rotateZ mas está em Hermes, substitui por rotate
    if (global.HermesInternal && transform.rotateZ) {
      const fixed = { ...transform };
      fixed.rotate = fixed.rotateZ;
      delete fixed.rotateZ;
      return fixed;
    }
    return transform;
  });
}