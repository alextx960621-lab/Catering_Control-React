# Catering Control (versión React)

Migración de la PWA original (HTML + JS sueltos) a React + Vite, manteniendo
el mismo comportamiento: multi-empresa por archivo `config.js`, Supabase como
backend, e instalable como PWA.

## Cómo se organiza

```
public/
  config.js       ← ÚNICO archivo que se edita por cada empresa nueva
                     (nombre, logo, WhatsApp, credenciales de Supabase)
  manifest.json   ← igual que antes, apunta a "/" en vez de "index.html"
  icons/          ← mismos íconos de siempre

src/
  pages/          ← LoginPage, PanelPage, ClientePage
                     (reemplazan a login.html, panel.html, cliente.html)
  components/     ← piezas reutilizables entre páginas (se va llenando en
                     las próximas partes de la migración)
  services/
    config.js         ← lee window.APP_CONFIG (de public/config.js)
    supabaseClient.js ← el cliente de Supabase, compartido por toda la app
  context/        ← estado compartido (ej. sesión del usuario logueado)
  App.jsx         ← define las 3 rutas: "/", "/panel", "/cliente"
  main.jsx        ← arranque de React
```

## Cómo correrlo

```
npm install
npm run dev       # desarrollo, con recarga automática
npm run build     # genera la carpeta dist/ lista para subir a Vercel/Hostinger
```

## Qué falta (próximas partes)

1. Migrar la lógica de `app.js` a `src/services/` (funciones puras, sin
   tocar el DOM directamente — eso ya lo hace React).
2. Construir `LoginPage` real (login de equipo + login de cliente).
3. Construir `ClientePage` real (portal de autoservicio).
4. Construir `PanelPage` real — es la más grande, se va a dividir en varios
   componentes por sección (Despacho, Clientes, Usuarios, etc.).
5. Word con el paso a paso actualizado a este flujo en React.
