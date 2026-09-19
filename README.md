# Catering Control (React)

Panel de control + portal de clientes para una empresa de catering/reparto a
domicilio: gestión de clientes, planes, rutas, drivers, despacho diario,
inventario, facturación y métricas. Multi-empresa por archivo de
configuración, con Supabase como backend y PWA instalable.

## Cómo correrlo

```
npm install
npm run dev       # desarrollo, con recarga automática
npm run build     # genera dist/, lista para desplegar
npm run lint      # oxlint
```

## Estructura

```
public/
  config.js       ← datos propios de la empresa (nombre, logo, WhatsApp,
                     credenciales de Supabase) -- es lo único que cambia
                     al instalar esto para una empresa nueva
  manifest.json, icons/

src/
  pages/          ← LoginPage, PanelPage, ClientePage (una por ruta)
  components/     ← todo lo demás, organizado por sección del panel
                     (clients, dispatch, plans, drivers, routes, notes,
                     inventory, settings, audit, payroll, metrics...)
  context/        ← OperationsContext: estado y datos compartidos por
                     todo el panel (clientes, planes, rutas, etc.)
  hooks/          ← lógica reutilizable (presencia en línea, tema, PWA...)
  services/       ← acceso a datos (Supabase), helpers de negocio puros

supabase/functions/  ← Edge Functions desplegadas en Supabase
  image-storage        subida de imágenes (logo, fotos de perfil/entrega)
  resolve-maps-link     resuelve links cortos de Google Maps a lat/lng

supabase-setup-final.sql  ← esquema completo de la base (tablas, RLS,
                            funciones RPC) para levantar un proyecto de
                            Supabase nuevo desde cero
```

## Desplegar una Edge Function

```
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy resolve-maps-link --no-verify-jwt
```
