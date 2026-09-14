import { useEffect } from 'react';

// Este proyecto no usa CSS Modules: el CSS de cada página se bundlea
// junto y aplica globalmente. Si dos páginas definen `body { background:
// ... }` sin ámbito, la que quede última en el bundle le pisa el fondo a
// todas las demás (misma especificidad).
//
// Este hook agrega una clase propia de la página actual a <body> mientras
// está montada (y la saca al desmontar), para que cada regla de fondo se
// escriba como `body.page-login { ... }` en vez de `body { ... }` y así
// no se pisen entre páginas.
export function usePageBodyClass(className) {
  useEffect(() => {
    if (!className) return undefined;
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [className]);
}
