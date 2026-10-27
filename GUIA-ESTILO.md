# Guía de estilo · Catering Control (empresa hermana de POS Control)

Las dos apps comparten **la misma paleta y la misma forma**. Los colores viven en un solo archivo:
`src/styles/marca.css` (mismos valores que `tokens.css` de POS Control). Si cambia un color allá, se cambia aquí igual.
**Las pantallas no definen colores de tema propios**: leen las variables de `marca.css`.

## Paleta (60 % azul · 30 % verde · 10 % naranja)
| Uso | Color | Variable |
|---|---|---|
| Azul primario (foco, enlaces, seleccionado) | `#0B5DA8` | `--logo-blue` / `--m-ac` |
| Azul oscuro (apoyo) | `#083D7C` | `--logo-navy` |
| Azul claro del logo (login: Entrar y el ojito) | `#1E88C8` | `--logo-blue-claro` |
| Verde del logo (logo, avatar, resplandor del fondo) | `#248F3C` | `--logo-green` |
| Verde de botón principal | `#1F8236` | `--btn-green` |
| Naranja / dorado (atención, «Soy nuevo») | `#F68B1F` / `#F8B030` | `--logo-orange` / `--logo-dorado` |
| Rojo (destructivo) | `#E4002B` | `--btn-red` |
| WhatsApp | `#25D366` | `--btn-whatsapp` |

Temas: **claro, nocturno y bosque**, con los mismos fondos, tarjetas y textos que POS (`--m-bg`, `--m-card`, `--m-ink`…).
En bosque el verde es la marca y el azul sigue para foco, enlaces y lo seleccionado.

## Botones
1. **Principal = verde sólido** (`button.primary`, `button.success`): una sola acción clave por pantalla o diálogo.
2. **Secundario = azul sólido** con letra blanca (`button.info`, `button.outline`). **Ningún botón blanco ni transparente.**
3. **Destructivo = rojo** (`danger`). `warning`/`orange` solo marcan atención; `violet` = azul oscuro de apoyo.
4. Todos con degradado `--gloss`, sombra del mismo color y forma de píldora.

## Forma
- Tarjetas: borde de 1.5 px y esquinas de 14 px; campos con borde marcado de 1.5 px y foco azul con aro suave.
- Menú lateral: la página activa es una **píldora azul sólida** (igual que las pestañas de POS).
- Login: tarjeta de 1.5 rem de radio con logo de 84 px arriba, tema y compartir en una fila de píldoras de 46 px.
