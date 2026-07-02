# Guía de Estilo: Hub.trimm.online

## Identidad Visual

El Hub.trimm.online mantiene la identidad visual de **Trimm.online** para garantizar coherencia y familiaridad en toda la suite de productos.

### Paleta de Colores

| Nombre | Código HEX | Uso |
|--------|-----------|-----|
| **Primario** | `#0f172a` | Textos principales, títulos |
| **Secundario** | `#64748b` | Textos de apoyo, etiquetas |
| **Acento** | `#2563eb` | Botones, enlaces, estados activos |
| **Superficie** | `#f8fafc` | Fondo de la aplicación |
| **Blanco** | `#ffffff` | Fondo de tarjetas y barras |
| **Borde** | `#e2e8f0` | Separadores, bordes |

### Tipografía

- **Fuente Principal:** `Plus Jakarta Sans` (Google Fonts)
- **Pesos:** 300, 400, 500, 600, 700, 800
- **Tamaños Base:**
  - Títulos (H1): 24px, peso 700
  - Subtítulos (H2): 18px, peso 600
  - Cuerpo: 14px, peso 400
  - Pequeño: 12px, peso 500

### Bordes y Espaciado

- **Radio Grande:** `24px` (tarjetas, modales)
- **Radio Medio:** `16px` (componentes secundarios)
- **Radio Pequeño:** `12px` (botones, inputs)

- **Espaciado:** Sistema de 8px
  - `p-8px`, `p-12px`, `p-16px`, `p-24px`, `p-32px`
  - `m-8px`, `m-12px`, `m-16px`, `m-24px`, `m-32px`
  - `gap-8px`, `gap-12px`, `gap-16px`, `gap-24px`, `gap-32px`

### Sombras

- **Sombra Suave:** `0 10px 40px -10px rgba(0, 86, 179, 0.1)`
- **Sombra Brillo:** `0 0 25px rgba(0, 123, 255, 0.4)`

## Componentes

### Tarjetas (Card SaaS)

```tsx
<div className="card-saas">
  {/* Contenido */}
</div>
```

**Propiedades:**
- Fondo blanco
- Borde 1px gris claro
- Radio 24px
- Sombra suave
- Transición hover: translateY(-2px)

### Botones

**Primario:**
```tsx
<button className="bg-accent text-white px-6 py-2.5 rounded-full font-bold hover:bg-blue-600 transition-all">
  Acción
</button>
```

**Secundario:**
```tsx
<button className="bg-white/50 hover:bg-white border border-transparent hover:border-slate-200 px-3 py-1.5 rounded-full text-slate-600 font-bold transition-all">
  Opción
</button>
```

### Sidebar

- Ancho: 264px
- Fondo: Blanco
- Borde derecho: 1px gris claro
- Items activos: Fondo gris claro + texto acento + indicador

### Barra Superior

- Alto: 64px
- Fondo: Blanco
- Borde inferior: 1px gris claro
- Contiene: Título de página, selector de sucursales, idioma, usuario

## Animaciones

- **Fade In:** 0.3s ease-out
- **Fade In Up:** 0.4s ease-out
- **Bounce Sutil:** 2s infinite

## Iconografía

- **Conjunto:** Material Symbols Outlined
- **Tamaño Base:** 24px
- **Variaciones:** 16px (pequeño), 20px (medio), 22px (grande)

## Responsive

- **Breakpoints:**
  - Móvil: < 768px
  - Tablet: 768px - 1024px
  - Desktop: > 1024px

- **Sidebar:** Oculto en móvil, visible en desktop
- **TopBar:** Siempre visible, adaptable

## Ejemplos de Uso

### Página de Dashboard

```tsx
<div className="space-y-6">
  <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
  
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    <div className="card-saas p-6">
      <h2 className="text-sm font-bold text-slate-600 mb-2">KPI</h2>
      <p className="text-3xl font-bold text-slate-900">1,234</p>
    </div>
  </div>
</div>
```

---

*Última actualización: 2025*
