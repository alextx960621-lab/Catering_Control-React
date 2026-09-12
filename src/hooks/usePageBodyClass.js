import { useEffect } from 'react';

// Este proyecto no usa CSS Modules: todo el CSS de cada página se bundlea
// junto y aplica globalmente (ver comentarios en LoginPage.css/
// ClientePage.css/LegalPage.css). Eso causaba un bug real: varias páginas
// definían su propia regla `body { background: ... }` SIN ámbito, y como
// las tres tienen la misma especificidad, la que quedara última en el
// bundle le terminaba pisando el fondo (con degradado propio del tema) a
// TODAS las demás páginas — visible como "varios temas mezclados a la vez"
// en el login.
//
// Este hook agrega una clase própia de la página actual a <body> mientras
// está montada (y la saca al desmontar), para que cada regla de fondo se
// pueda escribir como `body.page-login { ... }` en vez de `body { ... }` y
// así dejar de pisarse entre páginas.
export function usePageBodyClass(className) {
  useEffect(() => {
    if (!className) return undefined;
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [className]);
}
