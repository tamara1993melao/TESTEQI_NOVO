/**
 * Patch para corrigir referências à propriedade 'z' em Hermes
 */
if (global.HermesInternal) {
  // Garante que todos objetos podem ter 'z' acessado sem erro
  Object.defineProperty(Object.prototype, 'z', {
    get: function() { return 0; }, // retorna 0 se 'z' não existe
    configurable: true, 
    enumerable: false
  });
  
  // Para transformações específicas
  if (!global.CanvasRenderingContext2D) {
    global.CanvasRenderingContext2D = {};
  }
}

export default function ensureZ(obj) {
  if (obj && typeof obj === 'object' && !('z' in obj)) {
    if (obj) {
      obj.z = 0;
    }
  }
  return obj;
}